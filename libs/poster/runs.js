// Posting runs in the database: the web app creates a run (queued) and asks to cancel it; the posting engine claims it and
// writes its progress as it works; the Publish panel reads it. The engine is the only writer of status, gate, steps and
// outcome while a run is live, so those writes are plain updates; claiming and cancelling are compare-and-set.
// Relative imports only (also used by the engine process).
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "../db";
import { postingRuns } from "../schema";
import { HEARTBEAT_STALE_MS, LIVE_STATUSES, QUEUE_EXPIRY_MS, RUN_STATUS, RunError } from "./run-model";

const isUniqueViolation = (error) => error?.code === "23505" || error?.cause?.code === "23505";
const withDb = (deps) => deps?.database || db;

/**
 * Insert a queued run. Throws RunError("in_progress") when this job already has a live run on the platform.
 * The times are written from here, never left to the column default: the default is the database's clock and the engine's
 * heartbeats are this process's clock, and the two are hours apart where the database does not run on UTC.
 */
export async function createRun({ jobId, userId, platform, mode, kit, now = new Date() }, deps = {}) {
  const database = withDb(deps);
  try {
    const [run] = await database.insert(postingRuns).values({ jobId, userId, platform, mode, kit, steps: [], createdAt: now, updatedAt: now }).returning();
    return run;
  } catch (error) {
    if (isUniqueViolation(error)) throw new RunError("A posting run for this job is already in progress. Open it, or cancel it first.", "in_progress", 409);
    throw error;
  }
}

export async function getRun(id, deps = {}) {
  const [run] = await withDb(deps).select().from(postingRuns).where(eq(postingRuns.id, id)).limit(1);
  return run || null;
}

/** Newest first. */
export async function listRuns({ jobId, platform, limit = 5 }, deps = {}) {
  const database = withDb(deps);
  const where = platform ? and(eq(postingRuns.jobId, jobId), eq(postingRuns.platform, platform)) : eq(postingRuns.jobId, jobId);
  return database.select().from(postingRuns).where(where).orderBy(desc(postingRuns.createdAt)).limit(limit);
}

/** The runs of one person on one platform since a time, for the posting limits. */
export async function recentRuns({ userId, platform, since }, deps = {}) {
  return withDb(deps)
    .select({ id: postingRuns.id, jobId: postingRuns.jobId, mode: postingRuns.mode, status: postingRuns.status, createdAt: postingRuns.createdAt, completedAt: postingRuns.completedAt, outcome: postingRuns.outcome })
    .from(postingRuns)
    .where(and(eq(postingRuns.userId, userId), eq(postingRuns.platform, platform), gte(postingRuns.createdAt, since)));
}

/** The oldest queued run, now owned by this engine, or null. Two engines never get the same run. */
export async function claimNext({ engineId }, deps = {}) {
  const database = withDb(deps);
  const queued = await database.select({ id: postingRuns.id }).from(postingRuns).where(eq(postingRuns.status, RUN_STATUS.QUEUED)).orderBy(postingRuns.createdAt).limit(3);
  for (const { id } of queued) {
    const now = new Date();
    const [claimed] = await database
      .update(postingRuns)
      .set({ status: RUN_STATUS.RUNNING, engineId, startedAt: now, heartbeatAt: now, updatedAt: now })
      .where(and(eq(postingRuns.id, id), eq(postingRuns.status, RUN_STATUS.QUEUED), eq(postingRuns.cancelRequested, false)))
      .returning();
    if (claimed) return claimed;
  }
  return null;
}

/** What the engine writes while a run is live: any of status, gate, steps. */
export async function saveProgress(id, patch, deps = {}) {
  const now = new Date();
  await withDb(deps).update(postingRuns).set({ ...patch, heartbeatAt: now, updatedAt: now }).where(eq(postingRuns.id, id));
}

export async function finishRun(id, { status, outcome }, deps = {}) {
  const now = new Date();
  await withDb(deps)
    .update(postingRuns)
    .set({ status, outcome: outcome || null, gate: null, heartbeatAt: now, updatedAt: now, completedAt: now })
    .where(eq(postingRuns.id, id));
}

export async function isCancelRequested(id, deps = {}) {
  const [row] = await withDb(deps).select({ cancel: postingRuns.cancelRequested, status: postingRuns.status }).from(postingRuns).where(eq(postingRuns.id, id)).limit(1);
  return Boolean(row?.cancel);
}

/**
 * Ask a run to stop. A run nobody has started is cancelled on the spot; a live one is flagged and the engine closes its
 * window and ends it. Returns the run as it is now, or null when there is no such run. A finished run is left alone.
 */
export async function requestCancel(id, deps = {}) {
  const database = withDb(deps);
  const now = new Date();
  const [dropped] = await database
    .update(postingRuns)
    .set({ status: RUN_STATUS.CANCELLED, cancelRequested: true, gate: null, outcome: { code: "cancelled", message: "Cancelled before it started. Nothing was posted." }, completedAt: now, updatedAt: now })
    .where(and(eq(postingRuns.id, id), eq(postingRuns.status, RUN_STATUS.QUEUED)))
    .returning();
  if (dropped) return dropped;
  await database
    .update(postingRuns)
    .set({ cancelRequested: true, updatedAt: now })
    .where(and(eq(postingRuns.id, id), inArray(postingRuns.status, LIVE_STATUSES)));
  return getRun(id, deps);
}

/**
 * Ends runs that can no longer finish: a live run whose engine stopped reporting, and a queued run nobody picked up.
 * Cheap, and safe to call from anywhere (the engine at start, the panel's polling).
 */
export async function reapStale(deps = {}, now = new Date()) {
  const database = withDb(deps);
  await database
    .update(postingRuns)
    .set({
      status: RUN_STATUS.FAILED,
      gate: null,
      outcome: { code: "engine_stopped", message: "The posting engine stopped reporting, so the run ended. If you had already pressed Confirm on the platform, check its jobs list; otherwise nothing was posted." },
      completedAt: now,
      updatedAt: now,
    })
    .where(and(inArray(postingRuns.status, [RUN_STATUS.RUNNING, RUN_STATUS.NEEDS_YOU, RUN_STATUS.AWAITING_CONFIRM]), lt(postingRuns.heartbeatAt, new Date(now.getTime() - HEARTBEAT_STALE_MS))));
  await database
    .update(postingRuns)
    .set({
      status: RUN_STATUS.CANCELLED,
      outcome: { code: "no_engine", message: "No posting engine picked this up, so it was dropped. Start the posting engine and try again. Nothing was posted." },
      completedAt: now,
      updatedAt: now,
    })
    .where(and(eq(postingRuns.status, RUN_STATUS.QUEUED), lt(postingRuns.createdAt, new Date(now.getTime() - QUEUE_EXPIRY_MS))));
}

/**
 * The reporter the runner writes to (libs/poster/runner.js), backed by one run row. Writes are queued so they land in
 * order, and a failed write never stops the run (the next one carries the whole state again).
 */
export function createDbReporter({ run, shots, deps = {}, log = () => {}, cancelCheckMs = 1500, heartbeatMs = 5000 }) {
  const state = { status: run.status, gate: run.gate || null, steps: Array.isArray(run.steps) ? [...run.steps] : [] };
  let chain = Promise.resolve();
  let lastWrite = 0;
  let cancelAt = 0;
  let cancelSeen = false;

  const write = () => {
    lastWrite = Date.now();
    const snapshot = { status: state.status, gate: state.gate, steps: state.steps };
    chain = chain.then(() => saveProgress(run.id, snapshot, deps)).catch((error) => log(`progress write failed: ${error.message}`));
    return chain;
  };

  return {
    state,
    flush: () => chain,
    status: (status) => { state.status = status; write(); },
    gate: (gate) => { state.gate = gate; write(); },
    step: (id, patch) => {
      const index = state.steps.findIndex((s) => s.id === id);
      if (index === -1) state.steps = [...state.steps, { id, label: id, status: "pending", fields: [], shot: null, startedAt: null, finishedAt: null, ...patch }];
      else state.steps = state.steps.map((s) => (s.id === id ? { ...s, ...patch } : s));
      write();
    },
    steps: () => state.steps,
    heartbeat: () => { if (Date.now() - lastWrite > heartbeatMs) write(); },
    log,
    shot: (page, stepId) => (shots ? shots.save(page, stepId) : Promise.resolve(null)),
    cancelled: async () => {
      if (cancelSeen) return true;
      if (Date.now() - cancelAt < cancelCheckMs) return false;
      cancelAt = Date.now();
      try {
        cancelSeen = await isCancelRequested(run.id, deps);
      } catch {
        /* the next check asks again */
      }
      return cancelSeen;
    },
  };
}
