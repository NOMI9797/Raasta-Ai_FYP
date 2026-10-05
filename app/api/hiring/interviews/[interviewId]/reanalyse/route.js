import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { interviews, jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { enqueue } from "@/libs/hiring/queue";
import { INTERVIEW_STATUS } from "@/libs/hiring/statuses";

function ownerFilter(jobId, user) {
  return user.role === "admin"
    ? eq(jobs.id, jobId)
    : and(eq(jobs.id, jobId), eq(jobs.userId, user.id));
}

// POST /api/hiring/interviews/[interviewId]/reanalyse — re-run the analysis and the final evaluation.
// A decision already made is kept; only the scores and summary are refreshed.
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const { interviewId } = params;
    const [interview] = await db
      .select({ id: interviews.id, jobId: interviews.jobId, status: interviews.status, analysisStatus: interviews.analysisStatus, recordingStatus: interviews.recordingStatus })
      .from(interviews)
      .where(eq(interviews.id, interviewId))
      .limit(1);
    if (!interview) return NextResponse.json({ error: "Interview not found" }, { status: 404 });
    const [job] = await db.select({ id: jobs.id }).from(jobs).where(ownerFilter(interview.jobId, user)).limit(1);
    if (!job) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (interview.status !== INTERVIEW_STATUS.COMPLETED) {
      return NextResponse.json({ error: "Only completed interviews can be analysed" }, { status: 409 });
    }

    if (interview.recordingStatus === "deleted") {
      return NextResponse.json({ error: "The recording was deleted, so this interview can't be analysed again" }, { status: 409 });
    }

    // Mark pending before queueing, so a fast worker's "processing" is never overwritten
    await db.update(interviews).set({ analysisStatus: "pending", updatedAt: new Date() }).where(eq(interviews.id, interviewId));
    try {
      await enqueue("analyse-interview", { interviewId, force: true });
    } catch (error) {
      console.error("Queue reanalysis error:", error?.message);
      await db.update(interviews).set({ analysisStatus: interview.analysisStatus, updatedAt: new Date() }).where(eq(interviews.id, interviewId));
      return NextResponse.json({ error: "The analysis queue is unavailable. Try again shortly." }, { status: 503 });
    }
    return NextResponse.json({ success: true, queued: true });
  } catch (error) {
    console.error("Reanalyse error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
