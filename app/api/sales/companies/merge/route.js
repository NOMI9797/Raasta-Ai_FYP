import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/libs/db";
import { withAuth } from "@/libs/auth-middleware";
import { campaigns, leads } from "@/libs/schema";
import { PLATFORM_KIND } from "@/libs/sales/stages";
import { companyKey, companyNameOf, findDuplicateCompanies, jobsOf, mergeJobs } from "@/libs/sales/companies";

// POST /api/sales/companies/merge { campaignId } — combine job posts of the same company into one lead.
// For campaigns filled before job posts were grouped at import. The oldest lead of each company is kept.
export const POST = withAuth(async (request, { user }) => {
  try {
    const { campaignId } = await request.json();
    const [campaign] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId || ""), eq(campaigns.userId, user.id)))
      .limit(1);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const rows = await db.select().from(leads).where(and(eq(leads.campaignId, campaign.id), eq(leads.userId, user.id)));
    const companyLeads = rows.filter((l) => PLATFORM_KIND[l.source] === "company");

    let merged = 0;
    for (const { keep, merge } of findDuplicateCompanies(companyLeads)) {
      // Keep the research of whichever copy has it
      const research = keep.sourceData?.research || merge.find((l) => l.sourceData?.research)?.sourceData.research;
      const jobs = merge.reduce((all, lead) => mergeJobs(all, jobsOf(lead)), jobsOf(keep));
      await db
        .update(leads)
        .set({
          sourceData: { ...(keep.sourceData || {}), companyKey: companyKey(companyNameOf(keep)), jobs, ...(research ? { research } : {}) },
          updatedAt: new Date(),
        })
        .where(eq(leads.id, keep.id));
      await db.delete(leads).where(inArray(leads.id, merge.map((l) => l.id)));
      merged += merge.length;
    }

    return NextResponse.json({ success: true, merged });
  } catch (error) {
    console.error("Merge companies error:", error);
    return NextResponse.json({ error: "Could not combine companies" }, { status: 500 });
  }
}, { requireUser: true });
