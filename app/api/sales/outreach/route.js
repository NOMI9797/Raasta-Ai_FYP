import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/libs/db";
import { withAuth } from "@/libs/auth-middleware";
import { campaigns } from "@/libs/schema";
import { outreachBoard } from "@/libs/sales/outreach";

// GET /api/sales/outreach?campaign=&platform=indeed|rozee — every company of the campaign, where it stands, today's email limit
export const GET = withAuth(async (request, { user }) => {
  try {
    const params = new URL(request.url).searchParams;
    const campaignId = params.get("campaign");
    const platform = params.get("platform");
    if (!campaignId || !["indeed", "rozee"].includes(platform)) return NextResponse.json({ error: "Choose a campaign and a job board" }, { status: 400 });
    const conditions = [eq(campaigns.id, campaignId)];
    if (user.role !== "admin") conditions.push(eq(campaigns.userId, user.id));
    const [campaign] = await db.select({ id: campaigns.id }).from(campaigns).where(and(...conditions)).limit(1);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    return NextResponse.json({ success: true, ...(await outreachBoard({ campaignId, platform })) });
  } catch (error) {
    console.error("Outreach board error:", error);
    return NextResponse.json({ error: "Could not load outreach" }, { status: 500 });
  }
}, { requireUser: true });
