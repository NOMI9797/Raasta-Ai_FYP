import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/libs/db";
import { withAuth } from "@/libs/auth-middleware";
import { campaigns } from "@/libs/schema";
import { loadCampaignResults } from "@/libs/sales/results";

// GET /api/sales/results?campaign= — KPIs, funnel, activity, reply intents, outcomes and fit, per platform
export const GET = withAuth(async (request, { user }) => {
  try {
    const campaignId = new URL(request.url).searchParams.get("campaign");
    if (!campaignId) return NextResponse.json({ error: "Choose a campaign" }, { status: 400 });
    const conditions = [eq(campaigns.id, campaignId)];
    if (user.role !== "admin") conditions.push(eq(campaigns.userId, user.id));
    const [campaign] = await db.select({ id: campaigns.id }).from(campaigns).where(and(...conditions)).limit(1);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    return NextResponse.json({ success: true, ...(await loadCampaignResults(campaignId)) });
  } catch (error) {
    console.error("Results error:", error);
    return NextResponse.json({ error: "Could not load results" }, { status: 500 });
  }
}, { requireUser: true });
