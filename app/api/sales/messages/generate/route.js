import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/libs/db";
import { withAuth } from "@/libs/auth-middleware";
import { leads } from "@/libs/schema";
import { LeadActionError, writeLeadMessage } from "@/libs/sales/lead-actions";

export const maxDuration = 60;

// POST /api/sales/messages/generate { leadId, channel? } — write (or rewrite) the lead's message.
// A draft or approved message is replaced and goes back to draft; a sent one is never touched.
export const POST = withAuth(async (request, { user }) => {
  try {
    const { leadId, channel } = await request.json();
    const [lead] = await db.select().from(leads).where(and(eq(leads.id, leadId || ""), eq(leads.userId, user.id))).limit(1);
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    const { message, recipientName } = await writeLeadMessage({ lead, userId: user.id, channel });
    return NextResponse.json({ success: true, message, recipientName });
  } catch (error) {
    if (error instanceof LeadActionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Generate sales message error:", error);
    const status = error?.code === "rate_limit" ? 429 : 500;
    return NextResponse.json({ error: error?.code === "rate_limit" ? "The AI is busy. Try again in a minute." : error.message || "Could not write the message" }, { status });
  }
}, { requireUser: true });
