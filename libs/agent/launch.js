// Starting, pausing, resuming and stopping supervised recruiter runs (called from API routes).
// Relative imports only.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { agentActions, agentRuns, jobs } from "../schema";
import { normaliseMode } from "./policy";
import { ACTION_STATUS, supersedeActions } from "./actions";
import { ACTIVE_RUN_STATUSES, FINISHED_RUN_STATUSES, RECRUITER_PIPELINE, RUN_STATUS, findActiveRecruiterRun } from "./runs";
import { RECRUITER_STEPS } from "./recruiter-agent";
import { requestAgentTick } from "./triggers";

export class RunError extends Error {
  constructor(message, { status = 400, code } = {}) {
    super(message);
    this.name = "RunError";
    this.status = status;
    this.code = code;
  }
}

// Agent config keys a recruiter run uses (anything else is dropped from the snapshot)
const CONFIG_KEYS = ["jobId", "accountId", "rozeeAccountId", "indeedAccountId", "postTone", "dailyInviteCap", "rozeeApplicantLimit", "appBaseUrl"];

export function sanitiseRecruiterConfig(config = {}) {
  const out = {};
  for (const key of CONFIG_KEYS) if (config[key] !== undefined && config[key] !== "") out[key] = config[key];
  if (out.dailyInviteCap !== undefined) {
    const cap = Number(out.dailyInviteCap);
    if (!Number.isInteger(cap) || cap < 1 || cap > 200) throw new RunError("dailyInviteCap must be a whole number from 1 to 200", { code: "invalid_config" });
    out.dailyInviteCap = cap;
  }
  return out;
}

/** Create a recruiter run for a job the user owns (admins: any job) and queue its first tick. */
export async function startRecruiterRun({ user, agentConfigId = null, mode, config }, { database = db } = {}) {
  const snapshot = sanitiseRecruiterConfig(config);
  if (!snapshot.jobId) throw new RunError("Select a job for the recruiter agent", { code: "job_required" });

  const isAdmin = user.role === "admin";
  const [job] = await database.select({ id: jobs.id, userId: jobs.userId }).from(jobs)
    .where(isAdmin ? eq(jobs.id, snapshot.jobId) : and(eq(jobs.id, snapshot.jobId), eq(jobs.userId, user.id)))
    .limit(1);
  if (!job) throw new RunError("Job not found", { status: 404, code: "job_not_found" });

  if (await findActiveRecruiterRun(job.id, { database })) {
    throw new RunError("An agent is already managing this job. Stop it before starting another.", { status: 409, code: "already_running" });
  }

  const [run] = await database.insert(agentRuns).values({
    agentConfigId,
    userId: job.userId,
    pipelineType: RECRUITER_PIPELINE,
    jobId: job.id,
    mode: normaliseMode(mode),
    status: RUN_STATUS.QUEUED,
    totalSteps: RECRUITER_STEPS.length,
    config: snapshot,
  }).returning();

  await requestAgentTick(run.id, { delayMs: 0 });
  return run;
}

async function loadOwnRun(runId, user, database) {
  const isAdmin = user.role === "admin";
  const [run] = await database.select().from(agentRuns)
    .where(isAdmin ? eq(agentRuns.id, runId) : and(eq(agentRuns.id, runId), eq(agentRuns.userId, user.id)))
    .limit(1);
  if (!run) throw new RunError("Run not found", { status: 404, code: "not_found" });
  return run;
}

/** Pause switch: nothing happens until the recruiter resumes. Pending approvals stay in the inbox. */
export async function pauseRun(runId, user, { database = db } = {}) {
  const run = await loadOwnRun(runId, user, database);
  if (!ACTIVE_RUN_STATUSES.includes(run.status) || run.status === RUN_STATUS.PAUSED) {
    throw new RunError(`A ${run.status.replace(/_/g, " ")} run can't be paused`, { status: 409, code: "invalid_state" });
  }
  const [updated] = await database.update(agentRuns).set({ status: RUN_STATUS.PAUSED })
    .where(eq(agentRuns.id, run.id)).returning();
  return updated;
}

export async function resumeRun(runId, user, { database = db } = {}) {
  const run = await loadOwnRun(runId, user, database);
  if (run.status !== RUN_STATUS.PAUSED) throw new RunError("The run isn't paused", { status: 409, code: "invalid_state" });
  const [updated] = await database.update(agentRuns).set({ status: RUN_STATUS.RUNNING })
    .where(eq(agentRuns.id, run.id)).returning();
  await requestAgentTick(run.id, { delayMs: 0 });
  return updated;
}

/** Stop a run for good. Its open requests are withdrawn from the inbox. */
export async function stopRun(run, { database = db, now = new Date() } = {}) {
  if (FINISHED_RUN_STATUSES.includes(run.status)) {
    throw new RunError(`Run is already ${run.status}`, { status: 400, code: "finished" });
  }
  await database.update(agentRuns).set({ status: RUN_STATUS.CANCELLED, completedAt: now }).where(eq(agentRuns.id, run.id));
  const open = await database.select({ id: agentActions.id }).from(agentActions)
    .where(and(eq(agentActions.agentRunId, run.id), inArray(agentActions.status, [ACTION_STATUS.PENDING, ACTION_STATUS.APPROVED])));
  await supersedeActions(open.map((a) => a.id), "run stopped", { database, now });
}

/** The run's pending blocking approval (the job post), if any. */
export async function findBlockingAction(runId, { database = db } = {}) {
  const [row] = await database.select().from(agentActions)
    .where(and(eq(agentActions.agentRunId, runId), eq(agentActions.blocking, true), eq(agentActions.status, ACTION_STATUS.PENDING)))
    .limit(1);
  return row || null;
}
