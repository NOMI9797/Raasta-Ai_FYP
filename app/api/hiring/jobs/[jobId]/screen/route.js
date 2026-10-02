import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { candidates, jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { CANDIDATE_STATUS } from "@/libs/hiring/statuses";
import { queueScreening } from "@/libs/hiring/screening-queue";

function ownerFilter(jobId, user) {
  return user.role === "admin"
    ? eq(jobs.id, jobId)
    : and(eq(jobs.id, jobId), eq(jobs.userId, user.id));
}

// POST /api/hiring/jobs/[jobId]/screen — body { rescore?: boolean }
// Queues AI screening for every "new" candidate (or every candidate when rescore).
// The worker re-runs the shortlist once screening settles.
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const { jobId } = params;
    const body = await request.json().catch(() => ({}));
    const rescore = body?.rescore === true;

    const [job] = await db.select({ id: jobs.id }).from(jobs).where(ownerFilter(jobId, user)).limit(1);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const rows = await db
      .select({ id: candidates.id })
      .from(candidates)
      .where(rescore
        ? eq(candidates.jobId, jobId)
        : and(eq(candidates.jobId, jobId), eq(candidates.status, CANDIDATE_STATUS.NEW)));

    try {
      const { queued } = await queueScreening(rows.map((r) => r.id));
      return NextResponse.json({ success: true, queued, rescore });
    } catch (error) {
      console.error("Queue screening error:", error?.message);
      return NextResponse.json({ error: "Screening queue is unavailable. Try again shortly." }, { status: 503 });
    }
  } catch (error) {
    console.error("Screen job error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
