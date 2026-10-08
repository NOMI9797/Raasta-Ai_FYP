// Interview invitations (docs/ai-hiring/08-invitations.md): send / resend, reminders, expiry,
// cancel, extend, and closing interviews whose candidate never came back.
// Only token hashes are stored; the raw token exists only in the email. Never log tokens.
// Relative imports only — runs in Next.js routes and in the hiring worker.
import { and, eq, inArray, isNull, lt, gt, sql } from "drizzle-orm";
import { db } from "../db";
import { candidates, interviewQuestions, interviews, jobs, users } from "../schema";
import { CANDIDATE_STATUS, INTERVIEW_STATUS, ACTIVE_INTERVIEW_STATUSES } from "./statuses";
import { getHiringConfig } from "./config";
import { enqueue } from "./queue";
import { createInviteToken } from "../interview/tokens";
import { deliverEmail, interviewLink, inviteEmail, reminderEmail } from "./emails";
import { getRedisClient } from "../redis";

export const MAX_EXTEND_HOURS = 24 * 30;
const EMAIL_FAILED_PREFIX = "invite_email_failed";

export class InviteError extends Error {
  /** status: HTTP status for API routes; retryable: the worker should try again later */
  constructor(message, { code, status = 400, retryable = false } = {}) {
    super(message);
    this.name = "InviteError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

/** Live UI refresh for the recruiter (channel hiring:{userId}). Never throws. */
export async function publishHiringEvent(userId, event, redis) {
  try {
    await (redis || getRedisClient()).publish(`hiring:${userId}`, JSON.stringify({ ...event, at: new Date().toISOString() }));
  } catch {
    // live refresh is best-effort
  }
}

function defaults(deps = {}) {
  return {
    database: deps.database || db,
    deliver: deps.deliver || deliverEmail,
    enqueueJob: deps.enqueueJob || enqueue,
    publish: deps.publish || publishHiringEvent,
    now: deps.now || (() => new Date()),
  };
}

async function loadCandidateContext(database, candidateId) {
  const [candidate] = await database.select().from(candidates).where(eq(candidates.id, candidateId)).limit(1);
  if (!candidate) throw new InviteError("Candidate not found", { code: "not_found", status: 404 });
  const [job] = await database.select().from(jobs).where(eq(jobs.id, candidate.jobId)).limit(1);
  if (!job) throw new InviteError("Job not found", { code: "not_found", status: 404 });
  const [owner] = await database.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, job.userId)).limit(1);
  return { candidate, job, hiringTeam: owner?.name || null, replyTo: owner?.email || null };
}

async function activeInterview(database, candidateId) {
  const [row] = await database.select().from(interviews)
    .where(and(eq(interviews.candidateId, candidateId), inArray(interviews.status, ACTIVE_INTERVIEW_STATUSES)))
    .orderBy(sql`${interviews.createdAt} desc`)
    .limit(1);
  return row || null;
}

async function hasActiveJobQuestions(database, jobId) {
  const [{ n }] = await database.select({ n: sql`count(*)::int` }).from(interviewQuestions)
    .where(and(eq(interviewQuestions.jobId, jobId), isNull(interviewQuestions.candidateId), eq(interviewQuestions.isActive, true)));
  return n > 0;
}

function emailVars({ candidate, job, hiringTeam, replyTo }, { token, expiresAt }) {
  const config = getHiringConfig(job);
  return {
    candidateName: candidate.name,
    jobTitle: job.title,
    link: interviewLink(token),
    expiresAt,
    maxMinutes: config.interviewMaxMinutes,
    recordVideo: config.recordVideo,
    trackBehavior: Boolean(config.recordVideo && config.trackBehavior),
    hiringTeam,
    canReply: Boolean(replyTo),
  };
}

/**
 * Email an invite (new token on the given interview row). On failure the row keeps an
 * errorMessage and the error is rethrown as retryable; a retry rotates the token again.
 */
async function emailInvite(d, ctx, interview, { token, template = "invite" }) {
  const vars = emailVars(ctx, { token, expiresAt: interview.expiresAt });
  const message = template === "reminder" ? reminderEmail(vars, d.now()) : inviteEmail(vars);
  try {
    // Replies go to the recruiter who owns the job, not to a no-reply address
    const result = await d.deliver({ to: ctx.candidate.email, replyTo: ctx.replyTo || undefined, tags: ["interview-invite", template], ...message });
    await d.database.update(interviews).set({ errorMessage: null, updatedAt: d.now() }).where(eq(interviews.id, interview.id));
    return result;
  } catch (error) {
    // MailError carries a hint ("add the recipient as an authorized recipient…") worth showing the recruiter
    const reason = [error?.message || error, error?.hint].filter(Boolean).join(" — ");
    await d.database.update(interviews)
      .set({ errorMessage: `${EMAIL_FAILED_PREFIX}: ${String(reason).slice(0, 400)}`, updatedAt: d.now() })
      .where(eq(interviews.id, interview.id));
    throw new InviteError("The invite email could not be sent", { code: "email_failed", status: 502, retryable: true });
  }
}

/**
 * Send (or with resend: true, replace) the candidate's interview invite.
 * Returns { interviewId, expiresAt, delivered } or { skipped } when nothing needed doing.
 */
export async function sendInvite(candidateId, { resend = false } = {}, deps) {
  const d = defaults(deps);
  const ctx = await loadCandidateContext(d.database, candidateId);
  const { candidate, job } = ctx;
  const config = getHiringConfig(job);

  const current = await activeInterview(d.database, candidateId);
  // Idempotent: a repeated send-invite does nothing, unless the earlier email failed
  if (current && !resend) {
    if (current.status === INTERVIEW_STATUS.INVITED && current.errorMessage?.startsWith(EMAIL_FAILED_PREFIX)) {
      const { token, tokenHash } = createInviteToken();
      await d.database.update(interviews).set({ tokenHash, updatedAt: d.now() }).where(eq(interviews.id, current.id));
      const delivered = await emailInvite(d, ctx, current, { token });
      return { interviewId: current.id, expiresAt: current.expiresAt, delivered: delivered.delivered, retried: true };
    }
    return { skipped: "already invited", interviewId: current.id };
  }

  const allowed = resend
    ? [CANDIDATE_STATUS.SHORTLISTED, CANDIDATE_STATUS.INTERVIEW_INVITED, CANDIDATE_STATUS.INTERVIEW_EXPIRED]
    : [CANDIDATE_STATUS.SHORTLISTED, CANDIDATE_STATUS.INTERVIEW_EXPIRED];
  if (!allowed.includes(candidate.status)) {
    if (!resend && candidate.status === CANDIDATE_STATUS.INTERVIEW_INVITED) return { skipped: "already invited" };
    throw new InviteError(`Candidate can't be invited from status "${candidate.status}"`, { code: "invalid_status", status: 409 });
  }
  if (current?.status === INTERVIEW_STATUS.IN_PROGRESS) {
    throw new InviteError("The candidate is taking the interview right now", { code: "in_progress", status: 409 });
  }

  if (!(await hasActiveJobQuestions(d.database, job.id))) {
    await d.enqueueJob("ensure-questions", { jobId: job.id });
    throw new InviteError("The job has no interview questions yet; generating them now", { code: "questions_missing", status: 409, retryable: true });
  }

  const { token, tokenHash } = createInviteToken();
  const now = d.now();
  const expiresAt = new Date(now.getTime() + config.inviteExpiryHours * 3600 * 1000);

  const interview = await d.database.transaction(async (tx) => {
    // Serialise invites for the same candidate
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invite:${candidateId}`}))`);
    await tx.update(interviews)
      .set({ status: INTERVIEW_STATUS.CANCELLED, updatedAt: now })
      .where(and(eq(interviews.candidateId, candidateId), inArray(interviews.status, [INTERVIEW_STATUS.INVITED, INTERVIEW_STATUS.OPENED])));
    const [row] = await tx.insert(interviews).values({
      userId: job.userId,
      jobId: job.id,
      candidateId,
      status: INTERVIEW_STATUS.INVITED,
      tokenHash,
      expiresAt,
      invitedAt: now,
    }).returning();
    await tx.update(candidates)
      .set({ status: CANDIDATE_STATUS.INTERVIEW_INVITED, updatedAt: now })
      .where(eq(candidates.id, candidateId));
    return row;
  });

  const delivered = await emailInvite(d, ctx, interview, { token });
  await d.publish(job.userId, { type: "invite_sent", candidateId, interviewId: interview.id });
  return { interviewId: interview.id, expiresAt, delivered: delivered.delivered };
}

/**
 * Reminder for an unopened invite. The raw token isn't stored, so the token is rotated
 * (same row, new hash) and the new link emailed; the old link stops working.
 */
export async function sendReminder(interviewId, deps) {
  const d = defaults(deps);
  const [interview] = await d.database.select().from(interviews).where(eq(interviews.id, interviewId)).limit(1);
  if (!interview) return { skipped: "not found" };
  const now = d.now();
  if (interview.status !== INTERVIEW_STATUS.INVITED || interview.openedAt || interview.reminderSentAt
    || new Date(interview.expiresAt).getTime() <= now.getTime() + 2 * 3600 * 1000) {
    return { skipped: "not due" };
  }
  const ctx = await loadCandidateContext(d.database, interview.candidateId);
  const { token, tokenHash } = createInviteToken();
  // Claim the reminder first so two workers never both send one
  const claimed = await d.database.update(interviews)
    .set({ tokenHash, reminderSentAt: now, updatedAt: now })
    .where(and(eq(interviews.id, interviewId), isNull(interviews.reminderSentAt), eq(interviews.status, INTERVIEW_STATUS.INVITED)))
    .returning({ id: interviews.id });
  if (!claimed.length) return { skipped: "not due" };
  const delivered = await emailInvite(d, ctx, interview, { token, template: "reminder" });
  return { interviewId, delivered: delivered.delivered };
}

/** Interviews due a reminder (status invited, not opened, invited ≥ reminderAfterHours ago, > 2 h left). */
export async function findDueReminders(deps) {
  const d = defaults(deps);
  const now = d.now();
  const rows = await d.database
    .select({ id: interviews.id, invitedAt: interviews.invitedAt, hiringConfig: jobs.hiringConfig })
    .from(interviews)
    .innerJoin(jobs, eq(jobs.id, interviews.jobId))
    .where(and(
      eq(interviews.status, INTERVIEW_STATUS.INVITED),
      isNull(interviews.openedAt),
      isNull(interviews.reminderSentAt),
      gt(interviews.expiresAt, new Date(now.getTime() + 2 * 3600 * 1000)),
    ));
  return rows
    .filter((r) => {
      const hours = getHiringConfig({ hiringConfig: r.hiringConfig }).reminderAfterHours;
      return hours > 0 && new Date(r.invitedAt).getTime() <= now.getTime() - hours * 3600 * 1000;
    })
    .map((r) => r.id);
}

/** Invites past their expiry → interview expired, candidate interview_expired. Returns the count. */
export async function expireStaleInvites(deps) {
  const d = defaults(deps);
  const now = d.now();
  return d.database.transaction(async (tx) => {
    const expired = await tx.update(interviews)
      .set({ status: INTERVIEW_STATUS.EXPIRED, updatedAt: now })
      .where(and(inArray(interviews.status, [INTERVIEW_STATUS.INVITED, INTERVIEW_STATUS.OPENED]), lt(interviews.expiresAt, now)))
      .returning({ candidateId: interviews.candidateId });
    if (expired.length) {
      await tx.update(candidates)
        .set({ status: CANDIDATE_STATUS.INTERVIEW_EXPIRED, updatedAt: now })
        .where(and(inArray(candidates.id, expired.map((e) => e.candidateId)), eq(candidates.status, CANDIDATE_STATUS.INTERVIEW_INVITED)));
    }
    return expired.length;
  });
}

async function loadInterview(database, interviewId) {
  const [interview] = await database.select().from(interviews).where(eq(interviews.id, interviewId)).limit(1);
  if (!interview) throw new InviteError("Interview not found", { code: "not_found", status: 404 });
  return interview;
}

/** Cancel an invite that hasn't started. The candidate goes back to shortlisted. */
export async function cancelInvite(interviewId, deps) {
  const d = defaults(deps);
  const interview = await loadInterview(d.database, interviewId);
  if (![INTERVIEW_STATUS.INVITED, INTERVIEW_STATUS.OPENED, INTERVIEW_STATUS.EXPIRED].includes(interview.status)) {
    throw new InviteError(`An interview that is "${interview.status}" can't be cancelled`, { code: "invalid_status", status: 409 });
  }
  const now = d.now();
  await d.database.transaction(async (tx) => {
    await tx.update(interviews).set({ status: INTERVIEW_STATUS.CANCELLED, updatedAt: now }).where(eq(interviews.id, interviewId));
    await tx.update(candidates)
      .set({ status: CANDIDATE_STATUS.SHORTLISTED, updatedAt: now })
      .where(and(eq(candidates.id, interview.candidateId), inArray(candidates.status, [CANDIDATE_STATUS.INTERVIEW_INVITED, CANDIDATE_STATUS.INTERVIEW_EXPIRED])));
  });
  await d.publish(interview.userId, { type: "invite_cancelled", candidateId: interview.candidateId, interviewId });
  return { interviewId, status: INTERVIEW_STATUS.CANCELLED };
}

/**
 * Give the candidate more time: expires_at = max(now, expires_at) + hours.
 * An expired invite becomes valid again (interview invited or opened, candidate interview_invited).
 */
export async function extendInvite(interviewId, hours, deps) {
  const d = defaults(deps);
  const h = Number(hours);
  if (!Number.isInteger(h) || h < 1 || h > MAX_EXTEND_HOURS) {
    throw new InviteError(`hours must be a whole number between 1 and ${MAX_EXTEND_HOURS}`, { code: "invalid_hours", status: 400 });
  }
  const interview = await loadInterview(d.database, interviewId);
  if (![INTERVIEW_STATUS.INVITED, INTERVIEW_STATUS.OPENED, INTERVIEW_STATUS.EXPIRED].includes(interview.status)) {
    throw new InviteError(`An interview that is "${interview.status}" can't be extended`, { code: "invalid_status", status: 409 });
  }
  const now = d.now();
  const base = Math.max(now.getTime(), new Date(interview.expiresAt).getTime());
  const expiresAt = new Date(base + h * 3600 * 1000);
  const status = interview.status === INTERVIEW_STATUS.EXPIRED
    ? (interview.openedAt ? INTERVIEW_STATUS.OPENED : INTERVIEW_STATUS.INVITED)
    : interview.status;
  await d.database.transaction(async (tx) => {
    await tx.update(interviews).set({ expiresAt, status, updatedAt: now }).where(eq(interviews.id, interviewId));
    if (interview.status === INTERVIEW_STATUS.EXPIRED) {
      await tx.update(candidates)
        .set({ status: CANDIDATE_STATUS.INTERVIEW_INVITED, updatedAt: now })
        .where(and(eq(candidates.id, interview.candidateId), eq(candidates.status, CANDIDATE_STATUS.INTERVIEW_EXPIRED)));
    }
  });
  await d.publish(interview.userId, { type: "invite_extended", candidateId: interview.candidateId, interviewId });
  return { interviewId, expiresAt, status };
}

/**
 * Interviews stuck in_progress with no activity for resumeWindowMinutes + 5 (the engine died or
 * restarted and the candidate never came back). ≥ 50% of base questions answered → completed
 * (analysis queued), otherwise abandoned. Returns { completed, abandoned }.
 */
export async function abandonStaleSessions(deps, { repository } = {}) {
  const d = defaults(deps);
  const repo = repository || (await import("../interview/repository"));
  const now = d.now();
  const rows = await d.database
    .select({ interview: interviews, hiringConfig: jobs.hiringConfig })
    .from(interviews)
    .innerJoin(jobs, eq(jobs.id, interviews.jobId))
    .where(eq(interviews.status, INTERVIEW_STATUS.IN_PROGRESS));
  let completed = 0;
  let abandoned = 0;
  for (const { interview, hiringConfig } of rows) {
    const windowMin = getHiringConfig({ hiringConfig }).resumeWindowMinutes + 5;
    const last = new Date(interview.lastActivityAt || interview.startedAt || interview.updatedAt).getTime();
    if (now.getTime() - last < windowMin * 60 * 1000) continue;
    const questions = Array.isArray(interview.questionSnapshot) ? interview.questionSnapshot : [];
    const answered = await repo.countBaseAnswers(interview.id, { database: d.database });
    if (questions.length && answered >= Math.ceil(questions.length * 0.5)) {
      await repo.completeInterview(interview, { questions, state: interview.state, endedAt: now, database: d.database });
      await d.enqueueJob("analyse-interview", { interviewId: interview.id });
      completed += 1;
    } else {
      await repo.abandonInterview(interview, { state: interview.state, database: d.database });
      abandoned += 1;
    }
  }
  return { completed, abandoned };
}
