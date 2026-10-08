// Final hiring decisions (docs/ai-hiring/11-stage2-evaluation.md §2–3): recruiter or system
// decisions, bulk approval of suggestions, and outcome emails. Never sends scores to candidates.
// Relative imports only — runs in Next.js routes and in the hiring worker.
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { candidates, jobs, users } from "../schema";
import { CANDIDATE_STATUS, canTransition } from "./statuses";
import { getHiringConfig } from "./config";
import { enqueue } from "./queue";
import { deliverEmail, outcomeEmail } from "./emails";
import { finalEscalations } from "../agent/policy";

export const DECISIONS = [
  CANDIDATE_STATUS.FINAL_SHORTLISTED,
  CANDIDATE_STATUS.FINAL_REJECTED,
  CANDIDATE_STATUS.HIRED,
  CANDIDATE_STATUS.REJECTED,
];
// Statuses that warrant an outcome email (when the job enables them)
const OUTCOME_FOR = {
  [CANDIDATE_STATUS.FINAL_SHORTLISTED]: "final_shortlisted",
  [CANDIDATE_STATUS.FINAL_REJECTED]: "final_rejected",
  [CANDIDATE_STATUS.REJECTED]: "final_rejected",
};
export const SYSTEM_DECIDER = "system";

export class DecisionError extends Error {
  constructor(message, { status = 400, code } = {}) {
    super(message);
    this.name = "DecisionError";
    this.status = status;
    this.code = code;
  }
}

function defaults(deps = {}) {
  return {
    database: deps.database || db,
    enqueueJob: deps.enqueueJob || enqueue,
    deliver: deps.deliver || deliverEmail,
    now: deps.now || (() => new Date()),
  };
}

async function loadCandidate(database, candidateId) {
  const [candidate] = await database.select().from(candidates).where(eq(candidates.id, candidateId)).limit(1);
  if (!candidate) throw new DecisionError("Candidate not found", { status: 404, code: "not_found" });
  const [job] = await database.select().from(jobs).where(eq(jobs.id, candidate.jobId)).limit(1);
  if (!job) throw new DecisionError("Job not found", { status: 404, code: "not_found" });
  return { candidate, job };
}

/**
 * Set a final status. decidedBy: a user id, or "system" (autoFinalize). The move must be allowed
 * by MANUAL_TRANSITIONS. Queues the outcome email when the job enables them.
 */
export async function applyDecision({ candidateId, decision, decidedBy, note = null }, deps) {
  const d = defaults(deps);
  if (!DECISIONS.includes(decision)) {
    throw new DecisionError(`decision must be one of ${DECISIONS.join(", ")}`, { status: 400, code: "invalid_decision" });
  }
  const { candidate, job } = await loadCandidate(d.database, candidateId);
  if (candidate.status !== decision && !canTransition(candidate.status, decision)) {
    throw new DecisionError(`Can't move a candidate from "${candidate.status}" to "${decision}"`, { status: 409, code: "invalid_transition" });
  }
  const now = d.now();
  const finalAnalysis = {
    ...(candidate.finalAnalysis || {}),
    decision: { decision, by: decidedBy, at: now.toISOString(), note: note ? String(note).slice(0, 1000) : null },
  };
  const [updated] = await d.database.update(candidates)
    .set({ status: decision, finalDecidedAt: now, decidedBy, finalAnalysis, updatedAt: now })
    // Guard against a concurrent decision: only from the status we validated
    .where(and(eq(candidates.id, candidateId), eq(candidates.status, candidate.status)))
    .returning();
  if (!updated) throw new DecisionError("The candidate changed in the meantime; reload and try again", { status: 409, code: "conflict" });

  if (getHiringConfig(job).sendOutcomeEmails && OUTCOME_FOR[decision]) {
    try {
      await d.enqueueJob("send-outcome-email", { candidateId });
    } catch (error) {
      console.error("Failed to queue outcome email:", error?.message);
    }
  }
  return updated;
}

/**
 * Apply every pending suggestion for a job (interview_completed with a final_* suggestion).
 * needs_review candidates and escalated ones (score close to the threshold) are left for the
 * recruiter to decide one by one. Returns { applied, needsReview, escalated, failed }.
 */
export async function bulkApprove(jobId, decidedBy, deps) {
  const d = defaults(deps);
  const [job] = await d.database.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  const config = getHiringConfig(job);
  const pending = await d.database.select().from(candidates)
    .where(and(eq(candidates.jobId, jobId), eq(candidates.status, CANDIDATE_STATUS.INTERVIEW_COMPLETED)));
  const result = { applied: [], needsReview: 0, escalated: 0, failed: 0 };
  for (const candidate of pending) {
    const suggestion = candidate.finalAnalysis?.suggestedDecision;
    if (suggestion !== CANDIDATE_STATUS.FINAL_SHORTLISTED && suggestion !== CANDIDATE_STATUS.FINAL_REJECTED) {
      if (candidate.finalAnalysis) result.needsReview += 1;
      continue;
    }
    if (finalEscalations(candidate, config).length) {
      result.escalated += 1;
      continue;
    }
    try {
      await applyDecision({ candidateId: candidate.id, decision: suggestion, decidedBy }, deps);
      result.applied.push({ candidateId: candidate.id, decision: suggestion });
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

/**
 * Outcome email for a decided candidate (only if the job enables them). Idempotent: recorded in
 * final_analysis.outcomeEmail. Never includes scores.
 */
export async function sendOutcomeEmail(candidateId, deps) {
  const d = defaults(deps);
  const { candidate, job } = await loadCandidate(d.database, candidateId);
  if (!getHiringConfig(job).sendOutcomeEmails) return { skipped: "outcome emails disabled" };
  const outcome = OUTCOME_FOR[candidate.status];
  if (!outcome) return { skipped: `no outcome email for "${candidate.status}"` };
  if (candidate.finalAnalysis?.outcomeEmail?.outcome === outcome) return { skipped: "already sent" };

  const [owner] = await d.database.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, job.userId)).limit(1);
  const message = outcomeEmail({ outcome, candidateName: candidate.name, jobTitle: job.title, hiringTeam: owner?.name || null, canReply: Boolean(owner?.email) });
  await d.deliver({ to: candidate.email, replyTo: owner?.email || undefined, tags: ["interview-outcome", outcome], ...message });
  await d.database.update(candidates)
    .set({ finalAnalysis: { ...(candidate.finalAnalysis || {}), outcomeEmail: { outcome, sentAt: d.now().toISOString() } }, updatedAt: d.now() })
    .where(eq(candidates.id, candidateId));
  return { candidateId, outcome };
}
