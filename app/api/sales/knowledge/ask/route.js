import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { answerQuestion } from "@/libs/sales/knowledge/answer";
import { knowledgeFail as fail } from "@/libs/sales/knowledge/http";

// POST /api/sales/knowledge/ask { question } — what the agent would answer, and the passages it used
export const POST = withAuth(async (request, { user }) => {
  try {
    const { question } = await request.json();
    if (!String(question || "").trim()) return NextResponse.json({ error: "Type a question" }, { status: 400 });
    const result = await answerQuestion({ userId: user.id, question: String(question).slice(0, 1000) });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error?.code === "rate_limit") return NextResponse.json({ error: "The AI is busy (rate limit). Try again in a minute." }, { status: 429 });
    return fail(error, "Could not answer that");
  }
}, { requireUser: true });
