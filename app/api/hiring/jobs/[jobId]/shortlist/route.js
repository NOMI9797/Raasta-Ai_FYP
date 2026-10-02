import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { applyShortlist } from "@/libs/hiring/shortlist";

function ownerFilter(jobId, user) {
  return user.role === "admin"
    ? eq(jobs.id, jobId)
    : and(eq(jobs.id, jobId), eq(jobs.userId, user.id));
}

// POST /api/hiring/jobs/[jobId]/shortlist — re-run the stage-1 shortlist now
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const { jobId } = params;
    const [job] = await db.select({ id: jobs.id }).from(jobs).where(ownerFilter(jobId, user)).limit(1);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const result = await applyShortlist(jobId, { triggeredBy: user.id });
    return NextResponse.json({
      success: true,
      shortlisted: result.shortlisted.length,
      notShortlisted: result.notShortlisted.length,
      alreadyShortlisted: result.alreadyShortlisted,
      minFitScore: result.minFitScore,
      maxShortlist: result.maxShortlist,
    });
  } catch (error) {
    console.error("Shortlist error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
