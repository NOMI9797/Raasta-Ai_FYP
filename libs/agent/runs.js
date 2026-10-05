// Agent run lookups shared by the worker, the hiring modules and API routes.
// Imports only db/schema so libs/hiring can use it without a dependency cycle. Relative imports only.
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { agentRuns } from "../schema";

export const RECRUITER_PIPELINE = "recruiter";

export const RUN_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  WAITING: "waiting",                      // idle until the next event (applications, interviews, approvals)
  PAUSED_AT_CHECKPOINT: "paused_at_checkpoint", // a blocking approval is pending
  PAUSED: "paused",                        // the recruiter paused the agent
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

// Runs that still manage their job (a paused agent still manages it: nothing happens until resumed)
export const ACTIVE_RUN_STATUSES = [
  RUN_STATUS.QUEUED, RUN_STATUS.RUNNING, RUN_STATUS.WAITING, RUN_STATUS.PAUSED_AT_CHECKPOINT, RUN_STATUS.PAUSED,
];
export const FINISHED_RUN_STATUSES = [RUN_STATUS.COMPLETED, RUN_STATUS.FAILED, RUN_STATUS.CANCELLED];

/** The active recruiter agent run for a job, or null. At most one exists (enforced at launch). */
export async function findActiveRecruiterRun(jobId, { database = db } = {}) {
  if (!jobId) return null;
  const [run] = await database
    .select()
    .from(agentRuns)
    .where(and(
      eq(agentRuns.jobId, jobId),
      eq(agentRuns.pipelineType, RECRUITER_PIPELINE),
      inArray(agentRuns.status, ACTIVE_RUN_STATUSES),
    ))
    .orderBy(desc(agentRuns.createdAt))
    .limit(1);
  return run || null;
}

/**
 * When a supervised agent manages a job, the agent alone shortlists, invites and decides:
 * the worker's own automation (auto-shortlist, auto-invite, auto-finalize) stands down.
 * Fails open to "not managed" if the lookup fails, which keeps the job's own settings.
 */
export async function isJobManagedByAgent(jobId, deps = {}) {
  try {
    return Boolean(await findActiveRecruiterRun(jobId, deps));
  } catch {
    return false;
  }
}

/** Active recruiter runs (for the worker's periodic sweep). */
export async function listActiveRecruiterRuns({ database = db } = {}) {
  return database
    .select({ id: agentRuns.id, jobId: agentRuns.jobId, status: agentRuns.status })
    .from(agentRuns)
    .where(and(
      eq(agentRuns.pipelineType, RECRUITER_PIPELINE),
      inArray(agentRuns.status, ACTIVE_RUN_STATUSES),
    ));
}
