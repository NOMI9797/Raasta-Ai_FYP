// Recruiter views of interviews (docs/ai-hiring/12-recruiter-ui.md §5–6): the list, the detail
// payload and deleting a recording. Ownership comes from the job: admins see everything, others
// only interviews of their own jobs. Relative imports only — also used from tests under tsx.
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { candidates, interviewResponses, interviewTurns, interviews, jobs } from "../schema";
import { INTERVIEW_STATUS } from "./statuses";
import { getSignedUrl, listKeys, deleteObject } from "./storage";

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const RECORDING_URL_SECONDS = 15 * 60;
export const RECORDING_DELETED = "deleted";

export class ViewError extends Error {
  constructor(message, { status = 400, code } = {}) {
    super(message);
    this.name = "ViewError";
    this.status = status;
    this.code = code;
  }
}

const isAdmin = (user) => user?.role === "admin";
const ownerCondition = (user) => (isAdmin(user) ? undefined : eq(jobs.userId, user.id));
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value, name) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ViewError(`${name} is not a valid date`, { code: "invalid_date" });
  return date;
}

/** Normalise list filters. Throws ViewError on bad input. `to` given as a day includes that whole day. */
export function parseListFilters({ jobId, status, from, to, page, pageSize } = {}) {
  if (status && !Object.values(INTERVIEW_STATUS).includes(status)) {
    throw new ViewError(`status must be one of ${Object.values(INTERVIEW_STATUS).join(", ")}`, { code: "invalid_status" });
  }
  const fromDate = parseDate(from, "from");
  let toDate = parseDate(to, "to");
  if (toDate && DATE_ONLY.test(String(to))) toDate = new Date(toDate.getTime() + 24 * 3600 * 1000);
  const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(pageSize, 10) || DEFAULT_PAGE_SIZE));
  return { jobId: jobId || null, status: status || null, from: fromDate, to: toDate, page: pageNumber, pageSize: size };
}

/** Page of interviews with candidate, job and score columns, newest invite first. */
export async function listInterviews(user, rawFilters = {}, { database = db } = {}) {
  const filters = parseListFilters(rawFilters);
  const conditions = [ownerCondition(user)];
  if (filters.jobId) conditions.push(eq(interviews.jobId, filters.jobId));
  if (filters.status) conditions.push(eq(interviews.status, filters.status));
  if (filters.from) conditions.push(gte(interviews.invitedAt, filters.from));
  if (filters.to) conditions.push(lt(interviews.invitedAt, filters.to));
  const where = and(...conditions.filter(Boolean));

  const [{ total }] = await database
    .select({ total: sql`count(*)::int` })
    .from(interviews)
    .innerJoin(jobs, eq(jobs.id, interviews.jobId))
    .where(where);

  const rows = await database
    .select({
      id: interviews.id,
      status: interviews.status,
      invitedAt: interviews.invitedAt,
      expiresAt: interviews.expiresAt,
      startedAt: interviews.startedAt,
      endedAt: interviews.endedAt,
      durationSec: interviews.durationSec,
      interviewScore: interviews.interviewScore,
      communicationScore: interviews.communicationScore,
      analysisStatus: interviews.analysisStatus,
      recordingStatus: interviews.recordingStatus,
      totalQuestions: interviews.totalQuestions,
      totalAnswers: interviews.totalAnswers,
      jobId: jobs.id,
      jobTitle: jobs.title,
      candidateId: candidates.id,
      candidateName: candidates.name,
      candidateEmail: candidates.email,
      candidateStatus: candidates.status,
      finalScore: candidates.finalScore,
    })
    .from(interviews)
    .innerJoin(jobs, eq(jobs.id, interviews.jobId))
    .innerJoin(candidates, eq(candidates.id, interviews.candidateId))
    .where(where)
    .orderBy(desc(interviews.invitedAt))
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize);

  return { interviews: rows, total, page: filters.page, pageSize: filters.pageSize };
}

// Loads the interview if the user may see it; null otherwise (callers answer 404 for both cases)
async function loadOwned(interviewId, user, database) {
  const [row] = await database
    .select({ interview: interviews, jobTitle: jobs.title, jobOwnerId: jobs.userId, hiringConfig: jobs.hiringConfig })
    .from(interviews)
    .innerJoin(jobs, eq(jobs.id, interviews.jobId))
    .where(and(eq(interviews.id, interviewId), ownerCondition(user)))
    .limit(1);
  return row || null;
}

/** Interview-owner check for routes that only need a yes/no (stream, delete). Returns the interview row or null. */
export async function findOwnedInterview(interviewId, user, { database = db } = {}) {
  const row = await loadOwned(interviewId, user, database);
  return row?.interview || null;
}

export async function signRecording(key, filename, sign) {
  if (!key) return null;
  try {
    return await sign(key, RECORDING_URL_SECONDS, { filename }); // signing is async (S3 presigns over the network)
  } catch {
    return null; // storage not configured: the page shows the recording as unavailable
  }
}

// How many parts of each kind the candidate's browser uploaded: tells "nothing arrived" from "it arrived
// but could not be joined". Storage trouble must never hide the interview, so it counts as unknown.
export async function countRecordingParts(interviewId, list = listKeys) {
  const parts = {};
  for (const kind of ["audio", "video"]) {
    try {
      parts[kind] = (await list(`recordings/${interviewId}/${kind}/`)).filter((k) => /\/\d+\.webm$/.test(k)).length;
    } catch {
      parts[kind] = null;
    }
  }
  return parts;
}

/**
 * Everything the detail page shows: interview (without its invite token hash or engine state),
 * job, candidate, scored answers, transcript turns and short-lived recording links.
 */
export async function getInterviewDetail(interviewId, user, { database = db, sign = getSignedUrl, list = listKeys } = {}) {
  const row = await loadOwned(interviewId, user, database);
  if (!row) return null;
  // eslint-disable-next-line no-unused-vars
  const { tokenHash, state, ...interview } = row.interview;

  const [candidate] = await database
    .select({
      id: candidates.id, name: candidates.name, email: candidates.email, status: candidates.status,
      fitScore: candidates.fitScore, finalScore: candidates.finalScore, finalAnalysis: candidates.finalAnalysis,
      decidedBy: candidates.decidedBy, finalDecidedAt: candidates.finalDecidedAt,
    })
    .from(candidates)
    .where(eq(candidates.id, interview.candidateId))
    .limit(1);

  const responses = await database.select().from(interviewResponses)
    .where(eq(interviewResponses.interviewId, interviewId))
    .orderBy(asc(interviewResponses.answeredAt));
  const turns = await database.select().from(interviewTurns)
    .where(eq(interviewTurns.interviewId, interviewId))
    .orderBy(asc(interviewTurns.seq));

  const deleted = interview.recordingStatus === RECORDING_DELETED;
  const parts = deleted ? { audio: 0, video: 0 } : await countRecordingParts(interviewId, list);
  const [audioUrl, videoUrl] = deleted
    ? [null, null]
    : await Promise.all([
      signRecording(interview.recordingAudioKey, "interview-audio.webm", sign),
      signRecording(interview.recordingVideoKey, "interview-video.webm", sign),
    ]);
  return {
    interview,
    job: { id: interview.jobId, title: row.jobTitle, recordVideo: row.hiringConfig?.recordVideo !== false },
    candidate: candidate || null,
    questions: Array.isArray(interview.questionSnapshot) ? interview.questionSnapshot : [],
    responses,
    turns,
    recording: {
      status: interview.recordingStatus,
      deleted,
      audioUrl,
      videoUrl,
      expiresInSec: RECORDING_URL_SECONDS,
      parts,
      // Why the parts could not be joined (written by the worker); the analysis problems stay in errorMessage
      problem: interview.errorMessage?.startsWith("recording_failed") ? interview.errorMessage.replace(/^recording_failed:\s*/, "") : null,
    },
  };
}

// Interview states in which the recording may still be written or analysed
const RECORDING_LOCKED = [INTERVIEW_STATUS.INVITED, INTERVIEW_STATUS.OPENED, INTERVIEW_STATUS.IN_PROGRESS];

/**
 * Privacy action: delete the recording (assembled files and uploaded parts) and forget its keys.
 * Scores, transcript and analysis stay; they can't be recomputed afterwards.
 * Returns { deleted: n } or { skipped } when there is nothing to delete.
 */
export async function deleteInterviewRecording(interviewId, user, { database = db, list = listKeys, remove = deleteObject, now = () => new Date() } = {}) {
  const interview = await findOwnedInterview(interviewId, user, { database });
  if (!interview) throw new ViewError("Interview not found", { status: 404, code: "not_found" });
  if (RECORDING_LOCKED.includes(interview.status)) {
    throw new ViewError("The interview hasn't finished yet", { status: 409, code: "in_progress" });
  }
  if (interview.analysisStatus === "processing") {
    throw new ViewError("The recording is being analysed right now. Try again in a few minutes.", { status: 409, code: "processing" });
  }
  if (interview.recordingStatus === RECORDING_DELETED) return { skipped: "already deleted", deleted: 0 };

  const keys = await list(`recordings/${interviewId}/`);
  for (const key of keys) await remove(key);
  await database.update(interviews)
    .set({ recordingAudioKey: null, recordingVideoKey: null, recordingStatus: RECORDING_DELETED, updatedAt: now() })
    .where(eq(interviews.id, interviewId));
  return { deleted: keys.length };
}
