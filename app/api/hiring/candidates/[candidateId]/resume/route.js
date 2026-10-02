import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { candidates, jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { getSignedUrl } from "@/libs/hiring/storage";

const RESUME_LINK_SECONDS = 300;

function ownerFilter(jobId, user) {
  return user.role === "admin"
    ? eq(jobs.id, jobId)
    : and(eq(jobs.id, jobId), eq(jobs.userId, user.id));
}

// GET /api/hiring/candidates/[candidateId]/resume — redirect to a short-lived download link
export const GET = withAuth(async (request, { params, user }) => {
  try {
    const { candidateId } = params;

    const [candidate] = await db
      .select({ jobId: candidates.jobId, resumeKey: candidates.resumeKey, resumeUrl: candidates.resumeUrl })
      .from(candidates)
      .where(eq(candidates.id, candidateId))
      .limit(1);

    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    const [job] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(ownerFilter(candidate.jobId, user))
      .limit(1);

    if (!job) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!candidate.resumeKey) {
      return NextResponse.json({ error: "No stored resume for this candidate" }, { status: 404 });
    }

    const url = await getSignedUrl(candidate.resumeKey, RESUME_LINK_SECONDS, {
      filename: candidate.resumeUrl || "resume",
    });
    // Local driver returns a relative /api/files/... URL; S3 returns an absolute presigned URL
    return NextResponse.redirect(new URL(url, request.url), 302);
  } catch (error) {
    console.error("Resume download error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
