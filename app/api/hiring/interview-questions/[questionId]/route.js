import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { interviewQuestions, jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { validateQuestionInput, deleteQuestion } from "@/libs/interview/question-bank";

// Load a question and check the user owns its job. Returns { question } or { response }.
async function loadOwnedQuestion(questionId, user) {
  const [question] = await db
    .select()
    .from(interviewQuestions)
    .where(eq(interviewQuestions.id, questionId))
    .limit(1);
  if (!question) {
    return { response: NextResponse.json({ error: "Question not found" }, { status: 404 }) };
  }
  const [job] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(user.role === "admin"
      ? eq(jobs.id, question.jobId)
      : and(eq(jobs.id, question.jobId), eq(jobs.userId, user.id)))
    .limit(1);
  if (!job) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { question };
}

// PATCH /api/hiring/interview-questions/[questionId] — edit fields, isActive, orderIndex
export const PATCH = withAuth(async (request, { params, user }) => {
  try {
    const { question, response } = await loadOwnedQuestion(params.questionId, user);
    if (response) return response;

    const body = await request.json().catch(() => null);
    const { value, errors } = validateQuestionInput(body, { partial: true });
    if (errors.length) {
      return NextResponse.json({ error: "Invalid question", details: errors }, { status: 400 });
    }
    if (Object.keys(value).length === 0) {
      return NextResponse.json({ success: true, question });
    }

    const [updated] = await db
      .update(interviewQuestions)
      .set({ ...value, updatedAt: new Date() })
      .where(eq(interviewQuestions.id, question.id))
      .returning();
    return NextResponse.json({ success: true, question: updated });
  } catch (error) {
    console.error("Update interview question error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });

// DELETE /api/hiring/interview-questions/[questionId] — soft if used in an interview, else hard
export const DELETE = withAuth(async (request, { params, user }) => {
  try {
    const { question, response } = await loadOwnedQuestion(params.questionId, user);
    if (response) return response;

    const result = await deleteQuestion(question);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Delete interview question error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
