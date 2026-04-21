import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { candidates, jobs } from "@/libs/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";

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

      return NextResponse.json({ success: true, candidates: rows, job });
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

    return NextResponse.json({ success: true, candidates: rows, jobs: ownedJobs });
  } catch (error) {
    console.error("List candidates error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
