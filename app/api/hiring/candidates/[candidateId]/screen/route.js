import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { candidates, jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { queueScreening } from "@/libs/hiring/screening-queue";

// POST /api/hiring/candidates/[candidateId]/screen — (re-)screen one candidate
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const { candidateId } = params;

    const [candidate] = await db
      .select({ id: candidates.id, jobId: candidates.jobId })
      .from(candidates)
      .where(eq(candidates.id, candidateId))
      .limit(1);
    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    const [job] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(user.role === "admin"
        ? eq(jobs.id, candidate.jobId)
        : and(eq(jobs.id, candidate.jobId), eq(jobs.userId, user.id)))
      .limit(1);
    if (!job) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
      await queueScreening([candidate.id]);
      return NextResponse.json({ success: true, queued: 1 });
    } catch (error) {
      console.error("Queue screening error:", error?.message);
      return NextResponse.json({ error: "Screening queue is unavailable. Try again shortly." }, { status: 503 });
    }
  } catch (error) {
    console.error("Screen candidate error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
