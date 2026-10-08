import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { listNotifications, markNotificationsRead } from "@/libs/notifications";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/notifications?limit=&offset=&unread=1 - a page of notifications, newest first, plus the unread count
export const GET = withAuth(async (request, { user }) => {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 20, 1), 50);
    const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);
    const unreadOnly = searchParams.get("unread") === "1";
    const { items, unread, hasMore } = await listNotifications(user.id, { limit, offset, unreadOnly });
    return NextResponse.json({ success: true, notifications: items, unread, hasMore });
  } catch (error) {
    console.error("List notifications error:", error);
    return NextResponse.json({ error: "Failed to load notifications" }, { status: 500 });
  }
}, { requireUser: true });

// PATCH /api/notifications - mark read: { ids: [...] } for some, {} for all
export const PATCH = withAuth(async (request, { user }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids.filter((id) => UUID_RE.test(id)) : [];
    if (Array.isArray(body.ids) && body.ids.length > 0 && ids.length === 0) {
      return NextResponse.json({ error: "Invalid notification ids" }, { status: 400 });
    }
    const updated = await markNotificationsRead(user.id, ids);
    return NextResponse.json({ success: true, updated });
  } catch (error) {
    console.error("Mark notifications read error:", error);
    return NextResponse.json({ error: "Failed to update notifications" }, { status: 500 });
  }
}, { requireUser: true });
