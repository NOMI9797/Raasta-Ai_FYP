// Wake the supervised agent when something it cares about happens (new screening result,
// finished interview, recruiter approval). Several events close together share one tick.
// Never throws: a missed tick is caught up by the worker's periodic sweep. Relative imports only.
import { getRedisClient } from "../redis";
import { enqueue } from "../hiring/queue";
import { findActiveRecruiterRun } from "./runs";

export const AGENT_ADVANCE_JOB = "agent-advance";
const DEFAULT_DELAY_MS = 2000;

/** Queue one agent-advance for the run; repeated calls within the delay coalesce. */
export async function requestAgentTick(runId, { delayMs = DEFAULT_DELAY_MS, redis, enqueueJob = enqueue } = {}) {
  try {
    const client = redis || getRedisClient();
    const fresh = await client.set(`agent:tick:${runId}`, "1", "PX", Math.max(delayMs, 500), "NX");
    if (!fresh) return { coalesced: true };
    await enqueueJob(AGENT_ADVANCE_JOB, { runId }, { delayMs }, client);
    return { queued: true };
  } catch (error) {
    console.error("Failed to queue agent tick:", error?.message);
    return { error: true };
  }
}

/** Wake the agent that manages this job, if any. Returns the run id or null. */
export async function requestAgentTickForJob(jobId, options = {}) {
  try {
    const run = await findActiveRecruiterRun(jobId, options);
    if (!run) return null;
    await requestAgentTick(run.id, options);
    return run.id;
  } catch (error) {
    console.error("Failed to find the job's agent:", error?.message);
    return null;
  }
}
