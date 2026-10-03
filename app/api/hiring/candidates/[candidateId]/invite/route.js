import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { candidates, jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { InviteError, sendInvite } from "@/libs/hiring/invitations";

function ownerFilter(jobId, user) {
  return user.role === "admin"
    ? eq(jobs.id, jobId)
    : and(eq(jobs.id, jobId), eq(jobs.userId, user.id));
}

// POST /api/hiring/candidates/[candidateId]/invite — send the interview invite now, or { resend: true }
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const { candidateId } = params;
    const body = await request.json().catch(() => ({}));

    const [candidate] = await db
      .select({ id: candidates.id, jobId: candidates.jobId })
      .from(candidates)
      .where(eq(candidates.id, candidateId))
      .limit(1);
    if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

    const [job] = await db.select({ id: jobs.id }).from(jobs).where(ownerFilter(candidate.jobId, user)).limit(1);
    if (!job) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const result = await sendInvite(candidateId, { resend: body?.resend === true });
    if (result.skipped) {
      return NextResponse.json({ success: true, skipped: result.skipped, interviewId: result.interviewId || null });
    }
    // The link itself is never returned: it only goes to the candidate's email
    return NextResponse.json({ success: true, interviewId: result.interviewId, expiresAt: result.expiresAt });
  } catch (error) {
    if (error instanceof InviteError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Send invite error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
