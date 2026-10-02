import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { listQuestions, addManualQuestion, QuestionBankError } from "@/libs/interview/question-bank";

function ownerFilter(jobId, user) {
  return user.role === "admin"
    ? eq(jobs.id, jobId)
    : and(eq(jobs.id, jobId), eq(jobs.userId, user.id));
}

// GET /api/hiring/jobs/[jobId]/interview-questions[?candidateId=] — job-wide (+ personalised) questions
export const GET = withAuth(async (request, { params, user }) => {
  try {
    const { jobId } = params;
    const [job] = await db
      .select({ id: jobs.id, title: jobs.title, hiringConfig: jobs.hiringConfig })
      .from(jobs)
      .where(ownerFilter(jobId, user))
      .limit(1);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const candidateId = new URL(request.url).searchParams.get("candidateId");
    const questions = await listQuestions(jobId, { candidateId });
    return NextResponse.json({ success: true, job, questions });
  } catch (error) {
    console.error("List interview questions error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });

// POST /api/hiring/jobs/[jobId]/interview-questions — add a manual question
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const { jobId } = params;
    const [job] = await db.select().from(jobs).where(ownerFilter(jobId, user)).limit(1);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const question = await addManualQuestion(job, body);
    return NextResponse.json({ success: true, question }, { status: 201 });
  } catch (error) {
    if (error instanceof QuestionBankError) {
      return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
    }
    console.error("Add interview question error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
