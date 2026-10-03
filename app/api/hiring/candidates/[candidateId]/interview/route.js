import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { candidates, interviews, jobs } from "@/libs/schema";
import { eq, and, desc } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";

function ownerFilter(jobId, user) {
  return user.role === "admin"
    ? eq(jobs.id, jobId)
    : and(eq(jobs.id, jobId), eq(jobs.userId, user.id));
}

// GET /api/hiring/candidates/[candidateId]/interview — the candidate's latest interview (invite status)
export const GET = withAuth(async (request, { params, user }) => {
  try {
    const { candidateId } = params;
    const [candidate] = await db
      .select({ id: candidates.id, jobId: candidates.jobId })
      .from(candidates)
      .where(eq(candidates.id, candidateId))
      .limit(1);
    if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

    const [job] = await db.select({ id: jobs.id }).from(jobs).where(ownerFilter(candidate.jobId, user)).limit(1);
    if (!job) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const [interview] = await db
      .select({
        id: interviews.id,
        status: interviews.status,
        invitedAt: interviews.invitedAt,
        expiresAt: interviews.expiresAt,
        reminderSentAt: interviews.reminderSentAt,
        openedAt: interviews.openedAt,
        consentAt: interviews.consentAt,
        startedAt: interviews.startedAt,
        endedAt: interviews.endedAt,
        durationSec: interviews.durationSec,
        totalQuestions: interviews.totalQuestions,
        totalAnswers: interviews.totalAnswers,
        recordingStatus: interviews.recordingStatus,
        errorMessage: interviews.errorMessage,
      })
      .from(interviews)
      .where(eq(interviews.candidateId, candidateId))
      .orderBy(desc(interviews.createdAt))
      .limit(1);

    return NextResponse.json({ success: true, interview: interview || null });
  } catch (error) {
    console.error("Get candidate interview error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
