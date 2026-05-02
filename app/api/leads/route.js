import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { leads, campaigns } from "@/libs/schema";
import { eq, desc } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";

// GET /api/leads — list all leads owned by the authenticated user, joined with campaign meta.
export const GET = withAuth(async (request, { user }) => {
  try {
    const rows = await db
      .select({
        id: leads.id,
        name: leads.name,
        url: leads.url,
        title: leads.title,
        company: leads.company,
        source: leads.source,
        sourceData: leads.sourceData,
        campaignId: leads.campaignId,
        campaignName: campaigns.name,
        inviteSent: leads.inviteSent,
        inviteStatus: leads.inviteStatus,
        inviteSentAt: leads.inviteSentAt,
        createdAt: leads.createdAt,
      })
      .from(leads)
      .leftJoin(campaigns, eq(leads.campaignId, campaigns.id))
      .where(eq(leads.userId, user.id))
      .orderBy(desc(leads.createdAt));

    const leadsOut = rows.map(({ sourceData, ...r }) => {
      const conv = sourceData?.conversion;
      return {
        ...r,
        conversion: conv
          ? {
              tier: conv.tier,
              score: conv.score,
              primaryChannel: conv.outreach?.primaryChannel,
              enrichedAt: conv.enrichment?.enrichedAt,
              personalizationMode: conv.personalizationMode,
            }
          : null,
      };
    });

    return NextResponse.json({ success: true, leads: leadsOut });
  } catch (error) {
    console.error("List leads error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
