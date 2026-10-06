import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/libs/db";
import { withAuth } from "@/libs/auth-middleware";
import { kbDocuments } from "@/libs/schema";
import { addDocument } from "@/libs/sales/knowledge/store";
import { SAMPLE_DOCUMENTS } from "@/libs/sales/knowledge/sample";
import { knowledgeFail as fail } from "@/libs/sales/knowledge/http";

// POST /api/sales/knowledge/sample — load the sample company profile (once)
export const POST = withAuth(async (request, { user }) => {
  try {
    const existing = await db.select({ id: kbDocuments.id }).from(kbDocuments)
      .where(and(eq(kbDocuments.userId, user.id), eq(kbDocuments.isSample, true))).limit(1);
    if (existing.length) return NextResponse.json({ error: "The sample data is already loaded" }, { status: 409 });
    for (const doc of SAMPLE_DOCUMENTS) await addDocument({ userId: user.id, ...doc, isSample: true });
    return NextResponse.json({ success: true, added: SAMPLE_DOCUMENTS.length });
  } catch (error) {
    return fail(error, "Could not load the sample data");
  }
}, { requireUser: true });

// DELETE /api/sales/knowledge/sample — remove the sample entries you haven't edited
export const DELETE = withAuth(async (request, { user }) => {
  try {
    const removed = await db.delete(kbDocuments).where(and(eq(kbDocuments.userId, user.id), eq(kbDocuments.isSample, true))).returning({ id: kbDocuments.id });
    return NextResponse.json({ success: true, removed: removed.length });
  } catch (error) {
    return fail(error, "Could not remove the sample data");
  }
}, { requireUser: true });
