import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { reorderQuestions, QuestionBankError } from "@/libs/interview/question-bank";

function ownerFilter(jobId, user) {
  return user.role === "admin"
    ? eq(jobs.id, jobId)
    : and(eq(jobs.id, jobId), eq(jobs.userId, user.id));
}

// POST /api/hiring/jobs/[jobId]/interview-questions/reorder — body { ids: [...] }
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const { jobId } = params;
    const [job] = await db.select({ id: jobs.id }).from(jobs).where(ownerFilter(jobId, user)).limit(1);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const order = await reorderQuestions(jobId, body?.ids);
    return NextResponse.json({ success: true, order });
  } catch (error) {
    if (error instanceof QuestionBankError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Reorder interview questions error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
