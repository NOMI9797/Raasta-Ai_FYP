// Postgres reads/writes for live interviews (interviews, interview_turns, interview_responses).
// Replaces the earlier Mongo-based interview service. Relative imports only — runs in the engine.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { candidates, interviewResponses, interviewTurns, interviews, jobs } from "../schema";
import { CANDIDATE_STATUS, INTERVIEW_STATUS } from "../hiring/statuses";
import { listQuestions } from "./question-bank";
import { buildCandidateQuestionList, snapshotQuestions } from "./question-generator";

/**
 * Interview + job + candidate, or null if any is missing.
 */
export async function loadSessionContext(interviewId, { database = db } = {}) {
  const [interview] = await database.select().from(interviews).where(eq(interviews.id, interviewId)).limit(1);
  if (!interview) return null;
  const [job] = await database.select().from(jobs).where(eq(jobs.id, interview.jobId)).limit(1);
  const [candidate] = await database.select().from(candidates).where(eq(candidates.id, interview.candidateId)).limit(1);
  if (!job || !candidate) return null;
  return { interview, job, candidate };
}

/**
 * The interview's frozen question list. On first start it is built from the active job-wide
 * questions plus the candidate's personalised ones and stored in interviews.question_snapshot,
 * so later edits to the bank never change a started interview.
 */
export async function ensureQuestionSnapshot(interview, { database = db } = {}) {
  if (Array.isArray(interview.questionSnapshot) && interview.questionSnapshot.length) {
    return interview.questionSnapshot;
  }
  const rows = (await listQuestions(interview.jobId, { candidateId: interview.candidateId, database }))
    .filter((q) => q.isActive);
  const ordered = buildCandidateQuestionList(
    rows.filter((q) => q.candidateId == null),
    rows.filter((q) => q.candidateId === interview.candidateId)
  );
  const snapshot = snapshotQuestions(ordered);
  await database.update(interviews)
    .set({ questionSnapshot: snapshot, totalQuestions: snapshot.length, updatedAt: new Date() })
    .where(and(eq(interviews.id, interview.id), sql`${interviews.questionSnapshot} is null`));
  // Another connection may have frozen it first: read back what was stored
  const [stored] = await database.select({ questionSnapshot: interviews.questionSnapshot })
    .from(interviews).where(eq(interviews.id, interview.id)).limit(1);
  return stored?.questionSnapshot || snapshot;
}

/**
 * First "ready": interview in_progress, candidate interview_in_progress. Idempotent on resume.
 */
export async function markStarted(interview, { clientInfo = null, database = db } = {}) {
  const now = new Date();
  await database.transaction(async (tx) => {
    await tx.update(interviews).set({
      status: INTERVIEW_STATUS.IN_PROGRESS,
      startedAt: interview.startedAt || now,
      lastActivityAt: now,
      ...(clientInfo ? { clientInfo } : {}),
      updatedAt: now,
    }).where(eq(interviews.id, interview.id));
    await tx.update(candidates)
      .set({ status: CANDIDATE_STATUS.INTERVIEW_IN_PROGRESS, updatedAt: now })
      .where(and(
        eq(candidates.id, interview.candidateId),
        inArray(candidates.status, [CANDIDATE_STATUS.INTERVIEW_INVITED, CANDIDATE_STATUS.INTERVIEW_EXPIRED]),
      ));
  });
}

export async function appendTurn(interviewId, turn, { database = db } = {}) {
  await database.insert(interviewTurns).values({
    interviewId,
    seq: turn.seq,
    speaker: turn.speaker,
    kind: turn.kind,
    questionId: turn.questionId ?? null,
    text: turn.text,
    startedAt: turn.startedAt,
    endedAt: turn.endedAt ?? null,
    offsetMs: turn.offsetMs ?? null,
  }).onConflictDoNothing(); // a resumed session may replay a seq
}

/** Returns the new response id. questionId is always the base question (follow-ups included). */
export async function createResponse(interviewId, response, { database = db } = {}) {
  const [row] = await database.insert(interviewResponses).values({
    interviewId,
    questionId: response.questionId ?? null,
    questionText: response.questionText,
    answer: response.answer,
    isFollowUp: response.isFollowUp,
    followUpDepth: response.followUpDepth,
    followUpReason: response.followUpReason ?? null,
    answeredAt: response.answeredAt,
  }).returning({ id: interviewResponses.id });
  return row.id;
}

export async function updateResponseScore(responseId, result, { database = db } = {}) {
  await database.update(interviewResponses).set({
    score: result.score,
    scoreReasoning: result.reasoning,
    keywordsCovered: result.keywordsCovered,
    keywordsMissed: result.keywordsMissed,
    scoredAt: new Date(),
  }).where(eq(interviewResponses.id, responseId));
}

export async function saveState(interviewId, state, { database = db } = {}) {
  await database.update(interviews)
    .set({ state, lastActivityAt: new Date(), updatedAt: new Date() })
    .where(eq(interviews.id, interviewId));
}

export async function recordIntegrityEvent(interviewId, event, { database = db } = {}) {
  await database.update(interviews).set({
    integrityEvents: sql`(coalesce(${interviews.integrityEvents}::jsonb, '[]'::jsonb) || ${JSON.stringify([event])}::jsonb)::json`,
  }).where(eq(interviews.id, interviewId));
}

/**
 * Interview score: average score per base question (follow-ups count toward their base
 * question), weighted by the base question's scoreWeight. null if nothing was scored.
 */
export function computeInterviewScore(responses, questions) {
  const weightOf = new Map(questions.map((q) => [q.id, q.scoreWeight || 1]));
  const byQuestion = new Map();
  for (const r of responses) {
    if (r.score == null || !r.questionId) continue;
    const list = byQuestion.get(r.questionId) || [];
    list.push(r.score);
    byQuestion.set(r.questionId, list);
  }
  let weighted = 0;
  let totalWeight = 0;
  for (const [questionId, scores] of byQuestion) {
    const weight = weightOf.get(questionId) || 1;
    weighted += (scores.reduce((a, b) => a + b, 0) / scores.length) * weight;
    totalWeight += weight;
  }
  return totalWeight ? Math.round(weighted / totalWeight) : null;
}

/**
 * Finish the interview: statistics + interview score; candidate → interview_completed.
 * status is "completed" for a normal or ≥50%-answered partial interview.
 */
export async function completeInterview(interview, { questions, state, totalQuestions = null, endedAt = new Date(), database = db } = {}) {
  const responses = await database.select().from(interviewResponses).where(eq(interviewResponses.interviewId, interview.id));
  const startedAt = interview.startedAt || (state?.startedAt ? new Date(state.startedAt) : null);
  const stats = {
    // The questions the interviewer planned to ask, which fewer than the bank holds when the interview is short
    totalQuestions: totalQuestions ?? state?.totalQuestions ?? questions.length,
    totalAnswers: responses.filter((r) => !r.isFollowUp).length,
    followUpCount: responses.filter((r) => r.isFollowUp).length,
    interviewScore: computeInterviewScore(responses, questions),
    durationSec: startedAt ? Math.max(0, Math.round((endedAt - startedAt) / 1000)) : null,
  };
  await database.transaction(async (tx) => {
    await tx.update(interviews).set({
      status: INTERVIEW_STATUS.COMPLETED,
      endedAt,
      state,
      ...stats,
      updatedAt: new Date(),
    }).where(eq(interviews.id, interview.id));
    await tx.update(candidates)
      .set({ status: CANDIDATE_STATUS.INTERVIEW_COMPLETED, updatedAt: new Date() })
      .where(eq(candidates.id, interview.candidateId));
  });
  return stats;
}

/**
 * Candidate never came back: interview abandoned; candidate back to interview_invited while the
 * link is still valid (they may retry), otherwise interview_expired.
 */
export async function abandonInterview(interview, { state, database = db } = {}) {
  const expired = new Date(interview.expiresAt) <= new Date();
  await database.transaction(async (tx) => {
    await tx.update(interviews).set({
      status: INTERVIEW_STATUS.ABANDONED,
      endedAt: new Date(),
      state,
      updatedAt: new Date(),
    }).where(eq(interviews.id, interview.id));
    await tx.update(candidates)
      .set({ status: expired ? CANDIDATE_STATUS.INTERVIEW_EXPIRED : CANDIDATE_STATUS.INTERVIEW_INVITED, updatedAt: new Date() })
      .where(eq(candidates.id, interview.candidateId));
  });
}

export async function countBaseAnswers(interviewId, { database = db } = {}) {
  const [{ n }] = await database.select({ n: sql`count(*)::int` })
    .from(interviewResponses)
    .where(and(eq(interviewResponses.interviewId, interviewId), eq(interviewResponses.isFollowUp, false)));
  return n;
}
