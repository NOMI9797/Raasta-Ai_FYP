// Fixed-window rate limits on Redis counters (docs/ai-hiring/10-interview-room.md: rl:interview:{tokenHash}:{route}).
// Fails open: if Redis is down, requests are allowed rather than locking candidates out.
// Relative imports only.
import { getRedisClient } from "../redis";

/**
 * Count one request against `key`. Returns { allowed, remaining, retryAfterSec }.
 */
export async function rateLimit(key, { limit, windowSec }, redis) {
  try {
    const client = redis || getRedisClient();
    const count = await client.incr(key);
    if (count === 1) await client.expire(key, windowSec);
    if (count <= limit) return { allowed: true, remaining: limit - count, retryAfterSec: 0 };
    const ttl = await client.ttl(key);
    if (ttl < 0) await client.expire(key, windowSec); // a key that lost its expiry must not block forever
    return { allowed: false, remaining: 0, retryAfterSec: ttl > 0 ? ttl : windowSec };
  } catch {
    return { allowed: true, remaining: limit, retryAfterSec: 0 };
  }
}
