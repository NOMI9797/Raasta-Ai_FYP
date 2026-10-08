import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { POST_PLATFORMS } from "@/libs/hiring/platform-content";
import { getPublishingOverview } from "@/libs/hiring/publishing";

function ownerFilter(jobId, user) {
  return user.role === "admin" ? eq(jobs.id, jobId) : and(eq(jobs.id, jobId), eq(jobs.userId, user.id));
}

// GET /api/hiring/jobs/[jobId]/platforms
// Per platform: is an account connected, the saved post, what happened last, and whether an automatic post is allowed now.
export const GET = withAuth(async (request, { params, user }) => {
  try {
    const [job] = await db.select().from(jobs).where(ownerFilter(params.jobId, user)).limit(1);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    // ?linkedin=<account id>&rozee=<account id>&indeed=<account id> shows the state for the account the recruiter picked
    const accountIds = {};
    const query = new URL(request.url).searchParams;
    for (const platform of POST_PLATFORMS) if (query.get(platform)) accountIds[platform] = query.get(platform);
    const platforms = await getPublishingOverview(job, {}, { accountIds });
    return NextResponse.json({ success: true, jobStatus: job.status, platforms });
  } catch (error) {
    console.error("Platform overview error:", error.message);
    return NextResponse.json({ error: "Couldn't load the platforms" }, { status: 500 });
  }
}, { requireUser: true });
