// Admin view of the hiring job queue (docs/ai-hiring/13-workers-automation.md, "Admin visibility"):
// how much is waiting, whether a worker is alive, failed jobs, and retrying a failed job.
// Never returns resume text or tokens: dead-letter payloads only hold ids. Relative imports only.
import { getRedisClient } from "../redis";
import { STREAM, DEAD, GROUP, DELAYED, enqueue } from "./queue";

export const DEAD_LIMIT = 50;
// The worker reads with a 5 s block, so a live one is seen far more often than this
export const WORKER_ACTIVE_MS = 30 * 1000;
const STREAM_ID = /^\d+-\d+$/;

export class QueueAdminError extends Error {
  constructor(message, { status = 400, code } = {}) {
    super(message);
    this.name = "QueueAdminError";
    this.status = status;
    this.code = code;
  }
}

/** XINFO replies are flat [name, value, ...] arrays. */
function fromPairs(flat) {
  const out = {};
  for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = flat[i + 1];
  return out;
}

function parseDead([id, fields]) {
  const f = fromPairs(fields);
  let payload = {};
  try {
    payload = JSON.parse(f.payload || "{}");
  } catch {
    payload = {};
  }
  return {
    id,
    type: f.type || "",
    attempt: Number(f.attempt) || 0,
    error: f.error || "",
    failedAt: f.failedAt || null,
    originalId: f.originalId || null,
    payload,
  };
}

async function groupInfo(redis) {
  try {
    const groups = await redis.xinfo("GROUPS", STREAM);
    const group = groups.map(fromPairs).find((g) => g.name === GROUP);
    return group || null;
  } catch (error) {
    if (/no such key/i.test(error?.message || "")) return null; // nothing has ever been queued
    throw error;
  }
}

async function consumersOf(redis) {
  try {
    return (await redis.xinfo("CONSUMERS", STREAM, GROUP)).map(fromPairs);
  } catch {
    return [];
  }
}

/**
 * Queue overview:
 *   waiting   — jobs no worker has picked up yet
 *   inFlight  — picked up, not finished
 *   delayed   — scheduled for later (retries, debounced runs)
 *   dead      — failed jobs (newest first, up to DEAD_LIMIT) and their total
 *   worker    — { seen, active, consumers, lastSeenMs }; "seen" is false when no worker ever connected
 */
export async function getQueueOverview({ redis = getRedisClient() } = {}) {
  const [streamLength, delayed, deadTotal] = await Promise.all([
    redis.xlen(STREAM),
    redis.zcard(DELAYED),
    redis.xlen(DEAD),
  ]);
  const group = await groupInfo(redis);
  const consumers = group ? await consumersOf(redis) : [];
  const lastSeenMs = consumers.length ? Math.min(...consumers.map((c) => Number(c.idle) || 0)) : null;

  // Without a group nobody ever read the stream, so every entry is still waiting
  const waiting = group ? (group.lag != null ? Number(group.lag) : null) : streamLength;
  const dead = (await redis.xrevrange(DEAD, "+", "-", "COUNT", DEAD_LIMIT)).map(parseDead);

  return {
    streamLength,
    // who is reading the queue: worker ids (host name and process number) and how long ago each was last seen
    workers: consumers.map((c) => ({ name: String(c.name || ""), idleMs: Number(c.idle) || 0 })),
    waiting,
    inFlight: group ? Number(group.pending) || 0 : 0,
    delayed,
    worker: {
      seen: Boolean(group),
      active: lastSeenMs != null && lastSeenMs < WORKER_ACTIVE_MS,
      consumers: consumers.length,
      lastSeenMs,
    },
    dead,
    deadTotal,
  };
}

/**
 * Put a failed job back on the queue as a fresh attempt and remove it from the dead-letter list.
 * The entry is removed first, so two admins clicking at once retry it only once.
 */
export async function retryDeadLetter(id, { redis = getRedisClient(), enqueueJob = enqueue } = {}) {
  if (!STREAM_ID.test(String(id || ""))) throw new QueueAdminError("Invalid job id", { code: "invalid_id" });
  const [entry] = await redis.xrange(DEAD, id, id);
  if (!entry) throw new QueueAdminError("That job is no longer in the failed list", { status: 404, code: "not_found" });

  const job = parseDead(entry);
  if (!job.type) throw new QueueAdminError("That entry has no job type", { code: "invalid_entry" });
  const removed = await redis.xdel(DEAD, id);
  if (removed !== 1) throw new QueueAdminError("That job was already retried", { status: 409, code: "already_retried" });

  try {
    await enqueueJob(job.type, job.payload, { attempt: 0 }, redis);
  } catch (error) {
    // Keep it in the failed list rather than lose it
    await redis.xadd(DEAD, "*", ...entry[1]);
    throw error;
  }
  return { retried: true, type: job.type };
}
