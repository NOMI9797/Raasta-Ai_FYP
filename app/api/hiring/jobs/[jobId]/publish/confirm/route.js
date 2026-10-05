import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { POST_PLATFORMS } from "@/libs/hiring/platform-content";
import { confirmHandoff } from "@/libs/hiring/publishing";

function ownerFilter(jobId, user) {
  return user.role === "admin" ? eq(jobs.id, jobId) : and(eq(jobs.id, jobId), eq(jobs.userId, user.id));
}

// POST /api/hiring/jobs/[jobId]/publish/confirm  { platform, postUrl? }
// The recruiter posted by hand and says so; optionally saves the link to the post.
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const body = await request.json().catch(() => ({}));
    if (!POST_PLATFORMS.includes(body.platform)) {
      return NextResponse.json({ error: `platform must be one of: ${POST_PLATFORMS.join(", ")}` }, { status: 400 });
    }
    const [job] = await db.select().from(jobs).where(ownerFilter(params.jobId, user)).limit(1);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const result = await confirmHandoff({ job, platform: body.platform, postUrl: body.postUrl });
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: 400 });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("Confirm hand-off error:", error.message);
    return NextResponse.json({ error: "Couldn't save that" }, { status: 500 });
  }
}, { requireUser: true });
