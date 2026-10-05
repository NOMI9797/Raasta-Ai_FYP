import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { POST_PLATFORMS } from "@/libs/hiring/platform-content";
import { INITIATED_BY, PUBLISH_MODE, publishToPlatforms } from "@/libs/hiring/publishing";

function ownerFilter(jobId, user) {
  return user.role === "admin" ? eq(jobs.id, jobId) : and(eq(jobs.id, jobId), eq(jobs.userId, user.id));
}

// POST /api/hiring/jobs/[jobId]/publish  { platforms: "all" | ["linkedin", "rozee"], mode?: "auto" | "handoff", accountIds? }
//   auto    - posts through the connected account (within posting limits)
//   handoff - returns the text and the platform's composer link; the recruiter posts it themselves
// Each platform stands alone: the response has one result per platform and the request itself succeeds.
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const platforms = body.platforms === "all" ? "all" : Array.isArray(body.platforms) ? body.platforms : null;
    if (!platforms || (Array.isArray(platforms) && (platforms.length === 0 || platforms.some((p) => !POST_PLATFORMS.includes(p))))) {
      return NextResponse.json({ error: `platforms must be "all" or a list of: ${POST_PLATFORMS.join(", ")}` }, { status: 400 });
    }
    const mode = body.mode === "handoff" ? PUBLISH_MODE.HANDOFF : PUBLISH_MODE.AUTO;

    const [job] = await db.select().from(jobs).where(ownerFilter(params.jobId, user)).limit(1);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const accountIds = {};
    for (const platform of POST_PLATFORMS) {
      if (typeof body.accountIds?.[platform] === "string") accountIds[platform] = body.accountIds[platform];
    }

    const results = await publishToPlatforms({ job, platforms, mode, initiatedBy: INITIATED_BY.USER, accountIds });
    if (results.length === 0) {
      return NextResponse.json({ error: "No connected platform to publish to. Connect LinkedIn or Rozee.pk under Platforms, or use hand-off mode." }, { status: 400 });
    }
    return NextResponse.json({ success: true, ok: results.every((r) => r.ok), results });
  } catch (error) {
    console.error("Publish job error:", error.message);
    return NextResponse.json({ error: "Couldn't publish the job" }, { status: 500 });
  }
}, { requireUser: true });
