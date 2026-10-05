// A plain-words answer to "what is my agent doing, and does it need me?" for each hiring agent run,
// so the screens never show a bare "queued" or point at Decisions when there is nothing to decide.
// Relative imports only.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { agentActions, candidates, jobs } from "../schema";
import { CANDIDATE_STATUS } from "../hiring/statuses";
import { RUN_STATUS } from "./runs";

export const STUCK_QUEUED_MS = 30 * 1000; // a run the worker has not picked up after this long needs a look

const STAGES = {
  applied: [CANDIDATE_STATUS.NEW, CANDIDATE_STATUS.SCREENED, CANDIDATE_STATUS.REVIEWED],
  shortlisted: [CANDIDATE_STATUS.SHORTLISTED],
  invited: [CANDIDATE_STATUS.INTERVIEW_INVITED, CANDIDATE_STATUS.INTERVIEW_EXPIRED],
  interviewing: [CANDIDATE_STATUS.INTERVIEW_IN_PROGRESS],
  interviewed: [CANDIDATE_STATUS.INTERVIEW_COMPLETED],
  final: [CANDIDATE_STATUS.FINAL_SHORTLISTED, CANDIDATE_STATUS.HIRED],
};
const STAGE_PHRASE = {
  applied: (n) => `${n} being screened`,
  shortlisted: (n) => `${n} shortlisted`,
  invited: (n) => `${n} invited to interview`,
  interviewing: (n) => `${n} interviewing now`,
  interviewed: (n) => `${n} interviewed`,
  final: (n) => `${n} on the final shortlist`,
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Folds candidate counts by status into the stages above. */
export function stageCounts(byStatus = {}) {
  const counts = { total: 0, applied: 0, shortlisted: 0, invited: 0, interviewing: 0, interviewed: 0, final: 0 };
  for (const [status, n] of Object.entries(byStatus)) {
    counts.total += n;
    for (const [stage, statuses] of Object.entries(STAGES)) if (statuses.includes(status)) counts[stage] += n;
  }
  return counts;
}

/**
 * What to tell the person about one run. Pure.
 *   run: { id, status, currentStep, createdAt, errorMessage, jobId }
 *   { pending, counts (stageCounts), now (ms), stepLabel }
 * Returns { tone: info | warning | success | error, headline, detail, needsYou, counts, applyPath, stuck }.
 */
export function describeRun({ run, pending = 0, counts, now = Date.now(), stepLabel = "" }) {
  const base = { needsYou: pending, counts, applyPath: run.jobId ? `/apply/${run.jobId}` : null, stuck: false };
  switch (run.status) {
    case RUN_STATUS.FAILED:
      return { ...base, tone: "error", headline: "The agent stopped because of a problem", detail: run.errorMessage || "Open the run for details." };
    case RUN_STATUS.COMPLETED:
      return { ...base, tone: "success", headline: "Finished", detail: "The agent has done everything it was asked to." };
    case RUN_STATUS.CANCELLED:
      return { ...base, tone: "info", headline: "Stopped", detail: "You stopped this agent. Start it again from the list above." };
    case RUN_STATUS.PAUSED:
      return { ...base, tone: "warning", headline: "Paused", detail: "Nothing happens until you resume it." };
    default:
  }

  if (pending > 0) {
    const post = run.currentStep === "approve_post";
    return {
      ...base,
      tone: "warning",
      headline: `${plural(pending, "request is", "requests are")} waiting for you`,
      detail: post ? "It wrote the job post and will not publish it until you approve. Review it in Decisions." : "It will not go further on these until you decide. Review them in Decisions.",
    };
  }

  if (run.status === RUN_STATUS.QUEUED) {
    const age = now - new Date(run.createdAt).getTime();
    if (age > STUCK_QUEUED_MS) {
      return { ...base, tone: "warning", stuck: true, headline: "Still waiting for the hiring worker", detail: "The worker has not picked this up yet. The Setup guide shows whether it is running." };
    }
    return { ...base, tone: "info", headline: "Starting", detail: "The hiring worker picks it up in a few seconds. It writes the job post first and then asks you to approve it." };
  }

  if (run.status === RUN_STATUS.RUNNING) {
    return { ...base, tone: "info", headline: "Working", detail: stepLabel ? `Now: ${stepLabel.toLowerCase()}.` : "It is working on the next step." };
  }

  // waiting (idle until something happens) or paused at a checkpoint that has no request left
  if (counts.total === 0) {
    return { ...base, tone: "info", headline: "Waiting for applicants", detail: "Nothing needs your decision yet. Share the apply link; the agent screens each application as it arrives and asks you before it shortlists." };
  }
  const parts = Object.keys(STAGE_PHRASE).filter((stage) => counts[stage] > 0).map((stage) => STAGE_PHRASE[stage](counts[stage]));
  return { ...base, tone: "info", headline: `Managing ${plural(counts.total, "applicant", "applicants")}`, detail: `${parts.join(", ")}. Nothing needs your decision right now.` };
}

/**
 * describeRun for a list of recruiter runs, with the counts read from the database.
 * Returns a Map of run id to the description (plus jobTitle). Never throws: a failed lookup means no description.
 */
export async function getRunActivity(runs, { database = db, now = Date.now(), stepLabels = {} } = {}) {
  const out = new Map();
  if (!runs.length) return out;
  try {
    const runIds = runs.map((r) => r.id);
    const jobIds = [...new Set(runs.map((r) => r.jobId).filter(Boolean))];
    const [pendingRows, statusRows, jobRows] = await Promise.all([
      database.select({ runId: agentActions.agentRunId, n: sql`count(*)::int` }).from(agentActions)
        .where(and(inArray(agentActions.agentRunId, runIds), eq(agentActions.status, "pending"))).groupBy(agentActions.agentRunId),
      jobIds.length
        ? database.select({ jobId: candidates.jobId, status: candidates.status, n: sql`count(*)::int` }).from(candidates)
          .where(inArray(candidates.jobId, jobIds)).groupBy(candidates.jobId, candidates.status)
        : [],
      jobIds.length ? database.select({ id: jobs.id, title: jobs.title }).from(jobs).where(inArray(jobs.id, jobIds)) : [],
    ]);
    const pending = new Map(pendingRows.map((r) => [r.runId, r.n]));
    const byJob = new Map();
    for (const row of statusRows) byJob.set(row.jobId, { ...(byJob.get(row.jobId) || {}), [row.status]: row.n });
    const titles = new Map(jobRows.map((j) => [j.id, j.title]));
    for (const run of runs) {
      out.set(run.id, {
        ...describeRun({ run, pending: pending.get(run.id) || 0, counts: stageCounts(byJob.get(run.jobId)), now, stepLabel: stepLabels[run.currentStep] || "" }),
        jobTitle: titles.get(run.jobId) || null,
      });
    }
  } catch (error) {
    console.error("Run activity error:", error?.message);
  }
  return out;
}
