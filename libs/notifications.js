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
      })
      .returning();
    return row;
  } catch (error) {
    console.error("notify failed:", error.message);
    return null;
  }
}

export async function listNotifications(userId, { limit = 20 } = {}) {
  const [items, [{ unread }]] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit),
    db
      .select({ unread: sql`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);
  return { items, unread };
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
