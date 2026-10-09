// Stage 2, part 2: final score, LLM summary and suggested decision for one candidate
// (docs/ai-hiring/11-stage2-evaluation.md §2). Rejections need the recruiter unless autoFinalize.
// Relative imports only — runs in the hiring worker.
import { eq } from "drizzle-orm";
import { db } from "../db";
import { candidates, interviewResponses, interviews, jobs } from "../schema";
import { CANDIDATE_STATUS } from "./statuses";
import { getHiringConfig } from "./config";
import { chatJSON } from "../ai/llm";
import { FINAL_SCHEMA_HINT, FINAL_SYSTEM, buildFinalUser } from "../ai/prompts/final";
import { scrubName } from "./fit-scorer";
import { computeInterviewScore } from "../interview/repository";
import { notify, NOTIFICATION_TYPES } from "../notifications";
import { NEEDS_REVIEW, communicationScore, fallbackSummary, finalScore, normaliseSummary, suggestDecision } from "./final-evaluator";
import { SYSTEM_DECIDER, applyDecision } from "./decisions";
import { isJobManagedByAgent } from "../agent/runs";

export const FINAL_ANALYSIS_VERSION = 1;
const DECISION_LABELS = {
  [CANDIDATE_STATUS.FINAL_SHORTLISTED]: "final shortlist",
  [CANDIDATE_STATUS.FINAL_REJECTED]: "not selected",
  [NEEDS_REVIEW]: "needs your review",
};

function defaults(deps = {}) {
  return {
    database: deps.database || db,
    llm: deps.llm || chatJSON,
    notifyFn: deps.notifyFn || notify,
    now: deps.now || (() => new Date()),
    decisionDeps: deps.decisionDeps,
    isManaged: deps.isManaged || isJobManagedByAgent,
  };
}

/** Strongest and weakest scored answers (top 3 + bottom 3, no duplicates). */
export function selectEvidence(responses) {
  const scored = responses.filter((r) => r.score != null && String(r.answer || "").trim()).sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3);
  const bottom = scored.slice(-3).reverse().filter((r) => !top.includes(r));
  return { top, bottom, all: [...top, ...bottom] };
}

/** Base questions with a non-empty answer. */
export function countAnswered(responses) {
  return new Set(responses.filter((r) => !r.isFollowUp && String(r.answer || "").trim()).map((r) => r.questionId)).size;
}

function scrubAll(summary, names) {
  const scrub = (text) => names.reduce((t, n) => scrubName(t, n), text);
  return {
    ...summary,
    summary: summary.summary ? scrub(summary.summary) : summary.summary,
    strengths: summary.strengths.map(scrub),
    risks: summary.risks.map(scrub),
    suggestedNextSteps: summary.suggestedNextSteps.map(scrub),
  };
}

/**
 * Compute and store the final evaluation. With autoFinalize (and a clear suggestion) the status
 * is applied by the system; otherwise the candidate waits in the recruiter's decisions queue.
 * A job managed by the supervised agent never auto-finalizes: the agent asks the recruiter.
 */
export async function finalizeCandidate({ candidateId, interviewId }, deps) {
  const d = defaults(deps);
  const [candidate] = await d.database.select().from(candidates).where(eq(candidates.id, candidateId)).limit(1);
  if (!candidate) return { skipped: "candidate not found" };
  const [interview] = await d.database.select().from(interviews).where(eq(interviews.id, interviewId)).limit(1);
  if (!interview || interview.candidateId !== candidateId) return { skipped: "interview not found" };
  if (interview.status !== "completed") return { skipped: `interview is ${interview.status}` };
  const [job] = await d.database.select().from(jobs).where(eq(jobs.id, candidate.jobId)).limit(1);
  const config = getHiringConfig(job);

  const responses = await d.database.select().from(interviewResponses).where(eq(interviewResponses.interviewId, interviewId));
  const questions = Array.isArray(interview.questionSnapshot) ? interview.questionSnapshot : [];
  const interviewScore = interview.interviewScore ?? computeInterviewScore(responses, questions);
  const communication = communicationScore(interview.analysis);
  const final = finalScore({ fitScore: candidate.fitScore, interviewScore, communicationScore: communication.score }, config.finalWeights);
  // Questions the interview planned to ask (fewer than the snapshot when the interview was short)
  const totalQuestions = interview.state?.totalQuestions || interview.totalQuestions || questions.length || 0;
  const answered = countAnswered(responses);
  const suggestedDecision = suggestDecision({ score: final.score, threshold: config.finalThreshold, totalAnswers: answered, totalQuestions });
  const evidence = selectEvidence(responses);

  let summary;
  try {
    const raw = await d.llm({
      system: FINAL_SYSTEM,
      user: buildFinalUser({
        job, fitScore: candidate.fitScore, fitAnalysis: candidate.fitAnalysis, interviewScore, communication,
        analysis: interview.analysis, answers: evidence.all, answered, totalQuestions,
        finalScore: final.score, threshold: config.finalThreshold,
      }),
      schemaHint: FINAL_SCHEMA_HINT,
      temperature: 0.2,
      maxTokens: 900,
    });
    summary = normaliseSummary(raw, { score: final.score, threshold: config.finalThreshold });
    if (!summary.summary) throw new Error("summary missing");
    summary = scrubAll(summary, [candidate.name, candidate.parsedData?.name].filter(Boolean));
  } catch {
    summary = fallbackSummary({
      score: final.score, threshold: config.finalThreshold, breakdown: final.breakdown, fitAnalysis: candidate.fitAnalysis,
      answered, totalQuestions, topAnswers: evidence.top, weakAnswers: evidence.bottom,
    });
  }

  const now = d.now();
  const previous = candidate.finalAnalysis || {};
  const finalAnalysis = {
    ...summary,
    suggestedDecision,
    breakdown: { ...final.breakdown, finalWeights: config.finalWeights, threshold: config.finalThreshold },
    communication,
    answered,
    totalQuestions,
    interviewId,
    computedAt: now.toISOString(),
    version: FINAL_ANALYSIS_VERSION,
    // Keep the record of an earlier decision / outcome email when re-analysing
    ...(previous.decision ? { decision: previous.decision } : {}),
    ...(previous.outcomeEmail ? { outcomeEmail: previous.outcomeEmail } : {}),
  };

  await d.database.update(interviews).set({ communicationScore: communication.score, updatedAt: now }).where(eq(interviews.id, interviewId));
  await d.database.update(candidates).set({ finalScore: final.score, finalAnalysis, updatedAt: now }).where(eq(candidates.id, candidateId));

  let applied = null;
  if (config.autoFinalize && suggestedDecision !== NEEDS_REVIEW && candidate.status === CANDIDATE_STATUS.INTERVIEW_COMPLETED
    && !(await d.isManaged(job.id))) {
    await applyDecision({ candidateId, decision: suggestedDecision, decidedBy: SYSTEM_DECIDER }, d.decisionDeps);
    applied = suggestedDecision;
  }

  await d.notifyFn({
    userId: job.userId,
    type: NOTIFICATION_TYPES.INTERVIEW_COMPLETED,
    title: `Interview evaluated: ${candidate.name} for ${job.title}`,
    body: applied
      ? `Final score ${final.score ?? "n/a"}. Automatically moved to ${DECISION_LABELS[applied]}.`
      : `Final score ${final.score ?? "n/a"}. Suggested: ${DECISION_LABELS[suggestedDecision]}. Waiting for your decision.`,
    link: `/dashboard/recruiter/jobs/${job.id}/candidates`,
  });

  return { candidateId, interviewId, jobId: job.id, finalScore: final.score, suggestedDecision, applied, fallbackSummary: Boolean(summary.fallback) };
}
