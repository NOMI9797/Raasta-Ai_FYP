import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { candidates, jobs } from "@/libs/schema";
import { eq, and, desc } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";

// GET /api/hiring/candidates?jobId=xxx — list candidates for a job (recruiter/admin)
export const GET = withAuth(async (request, { user }) => {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");

    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    const isAdmin = user.role === "admin";
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
  } catch (error) {
    console.error("List candidates error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
