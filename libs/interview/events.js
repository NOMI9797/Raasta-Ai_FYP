// Live interview events for the recruiter monitor: Redis pub/sub channel interview:{id}.
// The web app relays them to the browser as SSE (docs/ai-hiring/12-recruiter-ui.md).
// Relative imports only.
import { getRedisClient } from "../redis";

export function interviewChannel(interviewId) {
  return `interview:${interviewId}`;
}

/**
 * Publish an event; never throws (the live view is best-effort).
 */
export async function publishInterviewEvent(interviewId, event, redis = getRedisClient()) {
  try {
    await redis.publish(interviewChannel(interviewId), JSON.stringify({ ...event, at: new Date().toISOString() }));
  } catch {
    // Redis unavailable: the interview continues without the live view
  }
}
