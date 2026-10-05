import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { getQueueOverview } from "@/libs/hiring/queue-admin";

// GET /api/admin/hiring-queue — job queue health for admins: waiting, in flight, delayed,
// whether a worker is alive, and the failed jobs (last 50)
export const GET = withAuth(async (request, { user }) => {
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json({ success: true, queue: await getQueueOverview() });
  } catch (error) {
    console.error("Hiring queue overview error:", error?.message);
    return NextResponse.json({ error: "The queue is unavailable. Is Redis running?" }, { status: 503 });
  }
}, { requireUser: true });
