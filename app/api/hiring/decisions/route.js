import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { candidates, interviews, jobs } from "@/libs/schema";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { CANDIDATE_STATUS } from "@/libs/hiring/statuses";

// GET /api/hiring/decisions?jobId= — evaluated candidates waiting for a final decision, best first
export const GET = withAuth(async (request, { user }) => {
  try {
    const jobId = new URL(request.url).searchParams.get("jobId");
    const conditions = [
      eq(candidates.status, CANDIDATE_STATUS.INTERVIEW_COMPLETED),
      isNotNull(candidates.finalAnalysis),
    ];
    if (jobId) conditions.push(eq(candidates.jobId, jobId));
    if (user.role !== "admin") conditions.push(eq(jobs.userId, user.id));

    const rows = await db
      .select({
        id: candidates.id,
        name: candidates.name,
        email: candidates.email,
        jobId: candidates.jobId,
        jobTitle: jobs.title,
        fitScore: candidates.fitScore,
        finalScore: candidates.finalScore,
        finalAnalysis: candidates.finalAnalysis,
        interviewId: interviews.id,
        interviewScore: interviews.interviewScore,
        communicationScore: interviews.communicationScore,
        durationSec: interviews.durationSec,
        endedAt: interviews.endedAt,
      })
      .from(candidates)
      .innerJoin(jobs, eq(jobs.id, candidates.jobId))
      // The interview the evaluation was computed from
      .leftJoin(interviews, sql`${interviews.id}::text = ${candidates.finalAnalysis}->>'interviewId'`)
      .where(and(...conditions))
      .orderBy(sql`${candidates.finalScore} desc nulls last`, desc(candidates.updatedAt));

    return NextResponse.json({ success: true, decisions: rows });
  } catch (error) {
    console.error("List decisions error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
