import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { QueueAdminError, retryDeadLetter } from "@/libs/hiring/queue-admin";

// POST /api/admin/hiring-queue/retry { id } — put one failed job back on the queue (admin only)
export const POST = withAuth(async (request, { user }) => {
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    const result = await retryDeadLetter(body?.id);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof QueueAdminError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("Retry failed job error:", error?.message);
    return NextResponse.json({ error: "The queue is unavailable. Try again shortly." }, { status: 503 });
  }
}, { requireUser: true });
