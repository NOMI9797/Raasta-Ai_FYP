import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { loadCampaignOverview } from "@/libs/sales/campaign-overview";

// GET /api/sales/campaigns/overview — per campaign: leads by platform, contacted, replied, meetings, agent
export const GET = withAuth(async (request, { user }) => {
  try {
    const overview = await loadCampaignOverview({ userId: user.id, isAdmin: user.role === "admin" });
    return NextResponse.json({ success: true, overview });
  } catch (error) {
    console.error("Campaign overview error:", error);
    return NextResponse.json({ error: "Could not load campaign numbers" }, { status: 500 });
  }
}, { requireUser: true });
