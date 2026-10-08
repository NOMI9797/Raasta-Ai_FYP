// In-app notifications (top bar bell). Relative imports only — also runs in the
// hiring worker and agent runner outside Next.js.
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { notifications } from "./schema";

export const NOTIFICATION_TYPES = {
  NEW_APPLICATION: "new_application",
  SCREENING_COMPLETE: "screening_complete",
  INTERVIEW_COMPLETED: "interview_completed",
  AGENT_RUN_FINISHED: "agent_run_finished",
  AGENT_RUN_FAILED: "agent_run_failed",
  AGENT_NEEDS_APPROVAL: "agent_needs_approval",
};

const MAX_TITLE = 200;
const MAX_BODY = 500;

/**
 * Create a notification. Never throws: a failed notification must not break the
 * action that triggered it (an application, a screening run, an agent step).
 */
export async function notify({ userId, type, title, body = null, link = null }) {
  if (!userId || !type || !title) return null;
  try {
    const [row] = await db
      .insert(notifications)
      .values({
        userId,
        type,
        title: String(title).slice(0, MAX_TITLE),
        body: body ? String(body).slice(0, MAX_BODY) : null,
        link,
        // From JS, not the column default: the default uses the database's clock, which can be hours off UTC
        createdAt: new Date(),
      })
      .returning();
    return row;
  } catch (error) {
    console.error("notify failed:", error.message);
    return null;
  }
}

/**
 * A page of the user's notifications, newest first, plus the unread count (always across all of them).
 * unreadOnly narrows the page to unread ones; hasMore says there is another page after this one.
 */
export async function listNotifications(userId, { limit = 20, offset = 0, unreadOnly = false } = {}) {
  const mine = eq(notifications.userId, userId);
  const [rows, [{ unread }]] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(unreadOnly ? and(mine, isNull(notifications.readAt)) : mine)
      .orderBy(desc(notifications.createdAt))
      .limit(limit + 1) // one extra row tells us whether there is a next page
      .offset(offset),
    db
      .select({ unread: sql`count(*)::int` })
      .from(notifications)
      .where(and(mine, isNull(notifications.readAt))),
  ]);
  return { items: rows.slice(0, limit), unread, hasMore: rows.length > limit };
}

// Mark the given ids (or all, when ids is empty) as read for this user
export async function markNotificationsRead(userId, ids = []) {
  const conditions = [eq(notifications.userId, userId), isNull(notifications.readAt)];
  if (ids.length) conditions.push(inArray(notifications.id, ids));
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(...conditions))
    .returning({ id: notifications.id });
  return rows.length;
}
