// Live interview events for the recruiter monitor: Redis pub/sub channel interview:{id}.
// The web app relays them to the browser as SSE (docs/ai-hiring/12-recruiter-ui.md).
// Relative imports only.
import { getRedisClient } from "../redis";

export function interviewChannel(interviewId) {
  return `interview:${interviewId}`;
}

/**
 * Listen to one interview's events on a dedicated subscriber connection (a connection in
 * subscribe mode can't run other commands). Returns an async function that stops listening.
 * Malformed messages are ignored; a lost connection simply ends the live view.
 */
export async function subscribeToInterview(interviewId, onEvent, { redis = getRedisClient() } = {}) {
  const subscriber = redis.duplicate();
  const channel = interviewChannel(interviewId);
  subscriber.on("error", () => {});
  subscriber.on("message", (from, message) => {
    if (from !== channel) return;
    try {
      onEvent(JSON.parse(message));
    } catch {
      // ignore malformed frames
    }
  });
  try {
    await subscriber.subscribe(channel);
  } catch (error) {
    subscriber.disconnect();
    throw error;
  }
  return async () => {
    try {
      await subscriber.quit();
    } catch {
      subscriber.disconnect();
    }
  };
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
