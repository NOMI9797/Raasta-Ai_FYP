// Token-authenticated access for the public interview room (docs/ai-hiring/10-interview-room.md).
// The token in the URL is the credential: it is hashed, never stored or logged.
// Relative imports only.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { candidates, interviewQuestions, interviews, jobs, users } from "../schema";
import { CANDIDATE_STATUS, INTERVIEW_STATUS } from "../hiring/statuses";
import { getHiringConfig } from "../hiring/config";
import { hashToken } from "./tokens";
import { clampMinutes, planInterview } from "./time-plan";
import { rateLimit } from "../hiring/rate-limit";
import { listKeys } from "../hiring/storage";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,100}$/;

// Per-token request budgets (per hour)
export const ROUTE_LIMITS = {
  get: { limit: 120, windowSec: 3600 },
  consent: { limit: 20, windowSec: 3600 },
  session: { limit: 60, windowSec: 3600 }, // each page load can use up to 6 (connect + 5 reconnects)
  upload: { limit: 900, windowSec: 3600 },
  event: { limit: 300, windowSec: 3600 },
};

// Uploads may still arrive this long after the interview ends (final parts, slow networks)
export const UPLOAD_GRACE_MS = 2 * 60 * 60 * 1000;
export const MAX_PART_BYTES = 10 * 1024 * 1024;

/** recordings/{interviewId}/{kind}/{part:05}.webm (camera behaviour batches are .json, see libs/interview/behavior.js) */
export function recordingPartKey(interviewId, kind, part) {
  return `recordings/${interviewId}/${kind}/${String(part).padStart(5, "0")}.webm`;
}

export const ACCESS_ERRORS = {
  not_found: { status: 404, message: "This link is no longer valid. Please use the link in your most recent email, or contact the recruiter." },
  cancelled: { status: 410, message: "This link is no longer valid. Please use the link in your most recent email, or contact the recruiter." },
  expired: { status: 410, message: "This interview link has expired. Contact the recruiter to request a new one." },
  unavailable: { status: 410, message: "This interview is no longer available. Please contact the recruiter." },
  completed: { status: 409, message: "You've already completed this interview. Thank you!" },
  rate_limited: { status: 429, message: "Too many requests. Please wait a moment and try again." },
};

export class AccessError extends Error {
  constructor(code, { retryAfterSec } = {}) {
    super(ACCESS_ERRORS[code]?.message || "Unavailable");
    this.name = "AccessError";
    this.code = code;
    this.status = ACCESS_ERRORS[code]?.status || 400;
    this.retryAfterSec = retryAfterSec;
  }
}

export function isWellFormedToken(token) {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

/**
 * Resolve a token to { interview, job, candidate, tokenHash }, or throw AccessError.
 * options.route: rate-limit bucket; options.allowCompleted: uploads after the interview ended.
 * An invite past its expiry is marked expired on the spot.
 */
export async function resolveInterviewToken(token, { route = "get", allowCompleted = false, database = db, redis, now = new Date() } = {}) {
  if (!isWellFormedToken(token)) throw new AccessError("not_found");
  const tokenHash = hashToken(token);

  const budget = ROUTE_LIMITS[route] || ROUTE_LIMITS.get;
  const rl = await rateLimit(`rl:interview:${tokenHash}:${route}`, budget, redis);
  if (!rl.allowed) throw new AccessError("rate_limited", { retryAfterSec: rl.retryAfterSec });

  const [interview] = await database.select().from(interviews).where(eq(interviews.tokenHash, tokenHash)).limit(1);
  if (!interview) throw new AccessError("not_found");

  switch (interview.status) {
    case INTERVIEW_STATUS.CANCELLED:
      throw new AccessError("cancelled");
    case INTERVIEW_STATUS.EXPIRED:
      throw new AccessError("expired");
    case INTERVIEW_STATUS.ABANDONED:
    case INTERVIEW_STATUS.FAILED:
      throw new AccessError("unavailable");
    case INTERVIEW_STATUS.COMPLETED: {
      const endedAt = new Date(interview.endedAt || interview.updatedAt).getTime();
      if (!allowCompleted || now.getTime() - endedAt > UPLOAD_GRACE_MS) throw new AccessError("completed");
      break;
    }
    case INTERVIEW_STATUS.INVITED:
    case INTERVIEW_STATUS.OPENED:
      if (new Date(interview.expiresAt).getTime() <= now.getTime()) {
        await expireNow(database, interview, now);
        throw new AccessError("expired");
      }
      break;
    default:
  }

  const [job] = await database.select().from(jobs).where(eq(jobs.id, interview.jobId)).limit(1);
  const [candidate] = await database.select().from(candidates).where(eq(candidates.id, interview.candidateId)).limit(1);
  if (!job || !candidate) throw new AccessError("not_found");
  return { interview, job, candidate, tokenHash };
}

async function expireNow(database, interview, now) {
  await database.transaction(async (tx) => {
    await tx.update(interviews).set({ status: INTERVIEW_STATUS.EXPIRED, updatedAt: now })
      .where(and(eq(interviews.id, interview.id), inArray(interviews.status, [INTERVIEW_STATUS.INVITED, INTERVIEW_STATUS.OPENED])));
    await tx.update(candidates).set({ status: CANDIDATE_STATUS.INTERVIEW_EXPIRED, updatedAt: now })
      .where(and(eq(candidates.id, interview.candidateId), eq(candidates.status, CANDIDATE_STATUS.INTERVIEW_INVITED)));
  });
}

/** First visit: opened_at and status opened. */
export async function markOpened(interview, { database = db, now = new Date() } = {}) {
  if (interview.openedAt && interview.status !== INTERVIEW_STATUS.INVITED) return interview;
  const [row] = await database.update(interviews)
    .set({
      openedAt: interview.openedAt || now,
      ...(interview.status === INTERVIEW_STATUS.INVITED ? { status: INTERVIEW_STATUS.OPENED } : {}),
      updatedAt: now,
    })
    .where(eq(interviews.id, interview.id))
    .returning();
  return row || interview;
}

/**
 * How many questions this interview will ask: what the interview length allows out of the question
 * bank (libs/interview/time-plan.js), or the plan an interview already under way is following.
 */
async function questionCount(database, interview, config) {
  if (Number.isInteger(interview.state?.totalQuestions)) return interview.state.totalQuestions;
  const pool = Array.isArray(interview.questionSnapshot) && interview.questionSnapshot.length
    ? interview.questionSnapshot
    : await database.select({ id: interviewQuestions.id, category: interviewQuestions.category, scoreWeight: interviewQuestions.scoreWeight })
      .from(interviewQuestions)
      .where(and(
        eq(interviewQuestions.jobId, interview.jobId),
        eq(interviewQuestions.isActive, true),
        sql`(${interviewQuestions.candidateId} is null or ${interviewQuestions.candidateId} = ${interview.candidateId})`,
      ));
  return planInterview({ minutes: config.interviewMaxMinutes, questions: pool, maxFollowUps: config.maxFollowUps }).questionCount;
}

/**
 * Next free recording part per kind, so a page reload continues the numbering instead of
 * overwriting the parts uploaded before it.
 */
export async function nextRecordingParts(interviewId, { list = listKeys } = {}) {
  const next = { audio: 0, video: 0, behavior: 0 };
  for (const kind of Object.keys(next)) {
    try {
      for (const key of await list(`recordings/${interviewId}/${kind}/`)) {
        const match = /\/(\d+)\.(?:webm|json)$/.exec(key);
        if (match) next[kind] = Math.max(next[kind], Number(match[1]) + 1);
      }
    } catch {
      // storage unavailable: start at 0 (only matters after a reload)
    }
  }
  return next;
}

/**
 * What the candidate page may know. Never scores, analysis or question text.
 */
export async function publicInterviewView({ interview, job, candidate }, { database = db, list } = {}) {
  const config = getHiringConfig(job);
  const [owner] = await database.select({ name: users.name }).from(users).where(eq(users.id, job.userId)).limit(1);
  const state = interview.state && typeof interview.state === "object" ? interview.state : null;
  const started = interview.status === INTERVIEW_STATUS.IN_PROGRESS || interview.recordingStatus !== "none";
  return {
    nextRecordingPart: started ? await nextRecordingParts(interview.id, { list }) : { audio: 0, video: 0, behavior: 0 },
    status: interview.status,
    candidateFirstName: (candidate.name || "").trim().split(/\s+/)[0] || "there",
    jobTitle: job.title,
    companyName: owner?.name || null,
    maxMinutes: clampMinutes(config.interviewMaxMinutes),
    questionCount: await questionCount(database, interview, config),
    maxFollowUps: config.maxFollowUps,
    expiresAt: interview.expiresAt,
    recordVideo: config.recordVideo,
    trackBehavior: Boolean(config.recordVideo && config.trackBehavior),
    consentGiven: Boolean(interview.consentAt),
    canResume: interview.status === INTERVIEW_STATUS.IN_PROGRESS || Boolean(state?.hasGreeted),
    interviewerName: process.env.INTERVIEWER_NAME || "Raasta AI Interviewer",
  };
}
