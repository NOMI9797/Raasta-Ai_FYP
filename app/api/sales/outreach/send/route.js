import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/libs/db";
import { withAuth } from "@/libs/auth-middleware";
import { campaigns } from "@/libs/schema";
import { sendOutreachEmails } from "@/libs/sales/outreach";

// POST /api/sales/outreach/send { campaignId, messageIds } — send these first emails now (within today's limit)
export const POST = withAuth(async (request, { user }) => {
  try {
    const { campaignId, messageIds } = await request.json();
    if (!campaignId || !Array.isArray(messageIds) || !messageIds.length) return NextResponse.json({ error: "Nothing to send" }, { status: 400 });
    if (messageIds.length > 200) return NextResponse.json({ error: "Send at most 200 at a time" }, { status: 400 });
    const conditions = [eq(campaigns.id, campaignId)];
    if (user.role !== "admin") conditions.push(eq(campaigns.userId, user.id));
    const [campaign] = await db.select({ id: campaigns.id }).from(campaigns).where(and(...conditions)).limit(1);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    const result = await sendOutreachEmails({ user, campaignId, messageIds: messageIds.map(String) });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Outreach send error:", error);
    return NextResponse.json({ error: "Could not send" }, { status: 500 });
  }
}, { requireUser: true });
