import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { knowledgeFail as fail } from "@/libs/sales/knowledge/http";
import { addDocument, knowledgeStats, listDocuments } from "@/libs/sales/knowledge/store";

// GET /api/sales/knowledge — this user's knowledge base documents and totals
export const GET = withAuth(async (request, { user }) => {
  try {
    const [documents, stats] = await Promise.all([listDocuments(user.id), knowledgeStats(user.id)]);
    return NextResponse.json({ success: true, documents, stats });
  } catch (error) {
    return fail(error, "Could not load the knowledge base");
  }
}, { requireUser: true });

// POST /api/sales/knowledge { title, category, content } — add a written entry
export const POST = withAuth(async (request, { user }) => {
  try {
    const body = await request.json();
    const document = await addDocument({ userId: user.id, title: body.title, category: body.category, content: body.content, kind: "note" });
    return NextResponse.json({ success: true, document });
  } catch (error) {
    return fail(error, "Could not add it to the knowledge base");
  }
}, { requireUser: true });
