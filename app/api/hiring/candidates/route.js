import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { candidates, jobs, interviews } from "@/libs/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";

// Adds `latestInterview` (summary of the most recent interview, or null) to each candidate
async function withLatestInterview(rows) {
  if (rows.length === 0) return rows;
  const latest = await db
    .selectDistinctOn([interviews.candidateId], {
      candidateId: interviews.candidateId,
      id: interviews.id,
      status: interviews.status,
      invitedAt: interviews.invitedAt,
      expiresAt: interviews.expiresAt,
      startedAt: interviews.startedAt,
      endedAt: interviews.endedAt,
      interviewScore: interviews.interviewScore,
      communicationScore: interviews.communicationScore,
      analysisStatus: interviews.analysisStatus,
    })
    .from(interviews)
    .where(inArray(interviews.candidateId, rows.map((r) => r.id)))
    .orderBy(interviews.candidateId, desc(interviews.createdAt));
  const byCandidate = new Map(latest.map(({ candidateId, ...summary }) => [candidateId, summary]));
  return rows.map((r) => ({ ...r, latestInterview: byCandidate.get(r.id) || null }));
}

// GET /api/hiring/candidates
//   ?jobId=xxx  — list candidates for one job (with job details)
//   no jobId    — list all candidates across all jobs owned by the user
export const GET = withAuth(async (request, { user }) => {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");
    const isAdmin = user.role === "admin";

    if (jobId) {
      const [job] = await db
        .select()
        .from(jobs)
        .where(
          isAdmin
            ? eq(jobs.id, jobId)
            : and(eq(jobs.id, jobId), eq(jobs.userId, user.id))
        )
        .limit(1);

      if (!job) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }

      const rows = await db
        .select()
        .from(candidates)
        .where(eq(candidates.jobId, jobId))
        .orderBy(desc(candidates.appliedAt));

      return NextResponse.json({ success: true, candidates: await withLatestInterview(rows), job });
    }

    // Unified candidate view — all candidates across the user's jobs.
    const ownedJobs = isAdmin
      ? await db.select().from(jobs)
      : await db.select().from(jobs).where(eq(jobs.userId, user.id));

    if (ownedJobs.length === 0) {
      return NextResponse.json({ success: true, candidates: [], jobs: [] });
    }

    const rows = await db
      .select()
      .from(candidates)
      .where(inArray(candidates.jobId, ownedJobs.map((j) => j.id)))
      .orderBy(desc(candidates.appliedAt));

    return NextResponse.json({ success: true, candidates: await withLatestInterview(rows), jobs: ownedJobs });
  } catch (error) {
    console.error("List candidates error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
