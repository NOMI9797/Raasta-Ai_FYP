import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { jobs, candidates } from "@/libs/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { buildHiringAnalytics } from "@/libs/hiring/analytics";

// GET /api/hiring/analytics - funnel, stages, sources and per-job stats for the user's jobs
export const GET = withAuth(async (request, { user }) => {
  try {
    const isAdmin = user.role === "admin";
    const jobColumns = { id: jobs.id, title: jobs.title, status: jobs.status };

    const jobRows = isAdmin
      ? await db.select(jobColumns).from(jobs).orderBy(desc(jobs.createdAt))
      : await db.select(jobColumns).from(jobs).where(eq(jobs.userId, user.id)).orderBy(desc(jobs.createdAt));

    const candidateRows = jobRows.length
      ? await db
          .select({
            jobId: candidates.jobId,
            status: candidates.status,
            source: candidates.source,
            fitScore: candidates.fitScore,
            appliedAt: candidates.appliedAt,
          })
          .from(candidates)
          .where(inArray(candidates.jobId, jobRows.map((j) => j.id)))
      : [];

    return NextResponse.json({
      success: true,
      analytics: buildHiringAnalytics({ jobs: jobRows, candidates: candidateRows }),
    });
  } catch (error) {
    console.error("Hiring analytics error:", error);
    return NextResponse.json({ error: "Failed to load hiring analytics" }, { status: 500 });
  }
}, { requireUser: true });
