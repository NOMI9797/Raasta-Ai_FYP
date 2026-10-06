import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/libs/db";
import { withAuth } from "@/libs/auth-middleware";
import { campaigns, leads } from "@/libs/schema";
import { listMeetings } from "@/libs/sales/meetings/store";
import { getSalesSettings } from "@/libs/sales/meetings/settings";

// GET /api/sales/meetings — every meeting (offered, booked, held), with its lead and campaign, and the meeting settings
export const GET = withAuth(async (request, { user }) => {
  try {
    const rows = await listMeetings({ userId: user.id, isAdmin: user.role === "admin" });
    const leadIds = [...new Set(rows.map((m) => m.leadId))];
    const leadRows = leadIds.length
      ? await db.select({ id: leads.id, name: leads.name, company: leads.company, title: leads.title, source: leads.source, sourceData: leads.sourceData, campaignName: campaigns.name })
          .from(leads).leftJoin(campaigns, eq(campaigns.id, leads.campaignId)).where(inArray(leads.id, leadIds))
      : [];
    const byId = new Map(leadRows.map((l) => [l.id, l]));
    const meetings = rows.map((m) => {
      const l = byId.get(m.leadId);
      return {
        ...m,
        lead: l ? { id: l.id, name: l.name, company: l.company || l.sourceData?.company?.name || null, title: l.title, source: l.source, website: l.sourceData?.research?.website || null } : null,
        campaignName: l?.campaignName || null,
      };
    });
    return NextResponse.json({ success: true, meetings, settings: await getSalesSettings(user.id) });
  } catch (error) {
    console.error("Meetings error:", error);
    return NextResponse.json({ error: "Could not load meetings" }, { status: 500 });
  }
}, { requireUser: true });
