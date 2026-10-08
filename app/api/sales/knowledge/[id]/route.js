import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { deleteDocument, updateDocument } from "@/libs/sales/knowledge/store";
import { knowledgeFail as fail } from "@/libs/sales/knowledge/http";

// PATCH /api/sales/knowledge/[id] { title?, category?, content? } — edit; the text is re-indexed when it changed
export const PATCH = withAuth(async (request, { user, params }) => {
  try {
    const body = await request.json();
    const document = await updateDocument(params.id, user.id, { title: body.title, category: body.category, content: body.content });
    return NextResponse.json({ success: true, document });
  } catch (error) {
    return fail(error, "Could not save the change");
  }
}, { requireUser: true });

export const DELETE = withAuth(async (request, { user, params }) => {
  try {
    await deleteDocument(params.id, user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error, "Could not remove it");
  }
}, { requireUser: true });
