import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/libs/db";
import { withAuth } from "@/libs/auth-middleware";
import { campaigns, leads, messages } from "@/libs/schema";

// GET /api/sales/messages?campaignId=&platform= — the campaign's leads on one platform, each with its latest message
export const GET = withAuth(async (request, { user }) => {
  try {
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get("campaignId") || "";
    const platform = searchParams.get("platform") || "linkedin";

    const [campaign] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, user.id)))
      .limit(1);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const [rows, msgs] = await Promise.all([
      db.select().from(leads).where(and(eq(leads.campaignId, campaign.id), eq(leads.userId, user.id))).orderBy(leads.createdAt),
      db.select().from(messages).where(and(eq(messages.campaignId, campaign.id), eq(messages.userId, user.id))).orderBy(desc(messages.updatedAt)),
    ]);

    const latest = new Map();
    for (const m of msgs) if (!latest.has(m.leadId)) latest.set(m.leadId, m);

    const items = rows
      .filter((l) => (l.source || "linkedin") === platform)
      .map((lead) => ({ lead, message: latest.get(lead.id) || null }));
    return NextResponse.json({ success: true, items });
  } catch (error) {
    console.error("List sales messages error:", error);
    return NextResponse.json({ error: "Could not load messages" }, { status: 500 });
  }
}, { requireUser: true });
