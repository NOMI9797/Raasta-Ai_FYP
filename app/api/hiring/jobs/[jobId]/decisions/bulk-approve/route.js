import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { bulkApprove } from "@/libs/hiring/decisions";

function ownerFilter(jobId, user) {
  return user.role === "admin"
    ? eq(jobs.id, jobId)
    : and(eq(jobs.id, jobId), eq(jobs.userId, user.id));
}

// POST /api/hiring/jobs/[jobId]/decisions/bulk-approve — apply every pending suggestion (not needs_review)
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const { jobId } = params;
    const [job] = await db.select({ id: jobs.id }).from(jobs).where(ownerFilter(jobId, user)).limit(1);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const result = await bulkApprove(jobId, user.id);
    return NextResponse.json({
      success: true,
      applied: result.applied.length,
      decisions: result.applied,
      needsReview: result.needsReview,
      escalated: result.escalated,
      failed: result.failed,
    });
  } catch (error) {
    console.error("Bulk approve error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
