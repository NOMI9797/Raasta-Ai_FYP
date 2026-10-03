import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { interviews, jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { InviteError, extendInvite } from "@/libs/hiring/invitations";

function ownerFilter(jobId, user) {
  return user.role === "admin"
    ? eq(jobs.id, jobId)
    : and(eq(jobs.id, jobId), eq(jobs.userId, user.id));
}

// POST /api/hiring/interviews/[interviewId]/extend — body { hours }; an expired invite becomes valid again
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const { interviewId } = params;
    const body = await request.json().catch(() => ({}));

    const [interview] = await db
      .select({ id: interviews.id, jobId: interviews.jobId })
      .from(interviews)
      .where(eq(interviews.id, interviewId))
      .limit(1);
    if (!interview) return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    const [job] = await db.select({ id: jobs.id }).from(jobs).where(ownerFilter(interview.jobId, user)).limit(1);
    if (!job) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const result = await extendInvite(interviewId, body?.hours);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof InviteError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Extend invite error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
