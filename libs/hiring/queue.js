// Hiring job queue on Redis Streams (docs/ai-hiring/13-workers-automation.md).
// Relative imports only — used by Next.js routes and by workers/hiring-worker.js.
import crypto from "crypto";
import { getRedisClient } from "../redis";

export const STREAM = "hiring:jobs";
export const DEAD = "hiring:jobs:dead";
export const GROUP = "hiring-workers";
export const DELAYED = "hiring:delayed";

// Keep the stream bounded; acknowledged entries are not needed after processing
const STREAM_MAX_LEN = 10000;

function streamFields({ type, payload, attempt }) {
  return [
    "type", type,
    "payload", JSON.stringify(payload ?? {}),
    "attempt", String(attempt),
    "enqueuedAt", new Date().toISOString(),
  ];
}

/**
 * Queue a job. With delayMs > 0 it waits in a sorted set until the worker moves it into the stream.
 * Returns { id } for immediate jobs or { delayed: true, runAt } for delayed ones.
 */
export async function enqueue(type, payload, { delayMs = 0, attempt = 0 } = {}, redis = getRedisClient()) {
  if (!type) throw new Error("enqueue needs a job type");

  if (delayMs > 0) {
    const runAt = Date.now() + delayMs;
    // The random id keeps identical jobs from collapsing into one sorted-set member
    const member = JSON.stringify({ id: crypto.randomUUID(), type, payload: payload ?? {}, attempt });
    await redis.zadd(DELAYED, runAt, member);
    return { delayed: true, runAt: new Date(runAt) };
  }

  const id = await redis.xadd(STREAM, "MAXLEN", "~", STREAM_MAX_LEN, "*", ...streamFields({ type, payload, attempt }));
  return { id };
}

/**
 * Move delayed jobs that are due into the stream. Safe with several workers:
 * only the worker whose ZREM succeeds re-queues the job.
 */
export async function moveDueDelayed(redis = getRedisClient(), { limit = 100 } = {}) {
  const due = await redis.zrangebyscore(DELAYED, 0, Date.now(), "LIMIT", 0, limit);
  let moved = 0;
  for (const member of due) {
    const removed = await redis.zrem(DELAYED, member);
    if (removed !== 1) continue;
    let job;
    try {
      job = JSON.parse(member);
    } catch {
      continue;
    }
    await redis.xadd(STREAM, "MAXLEN", "~", STREAM_MAX_LEN, "*", ...streamFields(job));
    moved += 1;
  }
  return moved;
}

/**
 * Convert a stream entry's flat [field, value, ...] array into a job object.
 */
export function parseStreamEntry(id, fields) {
  const data = {};
  for (let i = 0; i < fields.length; i += 2) data[fields[i]] = fields[i + 1];
  let payload = {};
  try {
    payload = JSON.parse(data.payload || "{}");
  } catch {
    payload = {};
  }
  return {
    id,
    type: data.type,
    payload,
    attempt: Number(data.attempt) || 0,
    enqueuedAt: data.enqueuedAt || null,
  };
}
