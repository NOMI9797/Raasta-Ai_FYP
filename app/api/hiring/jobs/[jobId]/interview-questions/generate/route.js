import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { acquireQuestionLock, generateAndStore, QuestionBankError } from "@/libs/interview/question-bank";

function ownerFilter(jobId, user) {
  return user.role === "admin"
    ? eq(jobs.id, jobId)
    : and(eq(jobs.id, jobId), eq(jobs.userId, user.id));
}

// POST /api/hiring/jobs/[jobId]/interview-questions/generate — body { mode: "append" | "replace", count? }
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const { jobId } = params;
    const [job] = await db.select({ id: jobs.id }).from(jobs).where(ownerFilter(jobId, user)).limit(1);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const mode = body?.mode ?? "append";
    const count = body?.count === undefined || body?.count === null ? undefined : Number(body.count);

    const release = await acquireQuestionLock(jobId);
    if (!release) {
      return NextResponse.json({ error: "Questions are already being generated for this job" }, { status: 409 });
    }
    try {
      const created = await generateAndStore(jobId, { mode, count });
      return NextResponse.json({ success: true, mode, created: created.length, questions: created });
    } finally {
      await release();
    }
  } catch (error) {
    if (error instanceof QuestionBankError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Generate interview questions error:", error?.code || error?.message);
    const status = error?.code === "rate_limit" ? 429 : 502;
    return NextResponse.json({ error: "AI question generation failed. Try again." }, { status });
  }
}, { requireUser: true });
