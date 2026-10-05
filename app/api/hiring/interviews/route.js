import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { jobs } from "@/libs/schema";
import { eq } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { ViewError, listInterviews } from "@/libs/hiring/interview-views";

// GET /api/hiring/interviews?jobId=&status=&from=&to=&page=&pageSize=
// Interviews of the recruiter's jobs (all jobs for admins), newest invite first.
export const GET = withAuth(async (request, { user }) => {
  try {
    const params = new URL(request.url).searchParams;
    const result = await listInterviews(user, {
      jobId: params.get("jobId"),
      status: params.get("status"),
      from: params.get("from"),
      to: params.get("to"),
      page: params.get("page"),
      pageSize: params.get("pageSize"),
    });
    // For the job filter
    const ownJobs = await db.select({ id: jobs.id, title: jobs.title }).from(jobs)
      .where(user.role === "admin" ? undefined : eq(jobs.userId, user.id))
      .orderBy(jobs.title);
    return NextResponse.json({ success: true, ...result, jobs: ownJobs });
  } catch (error) {
    if (error instanceof ViewError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("List interviews error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
