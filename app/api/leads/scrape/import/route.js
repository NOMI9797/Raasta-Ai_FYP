import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { db } from "@/libs/db";
import { campaigns, rozeeAccounts } from "@/libs/schema";
import { enrichRozeeLeadInDb } from "@/libs/lead-rozee-enrichment";
import { importLeadProfiles } from "@/libs/sales/import-leads";

/**
 * Import searched profiles / job posts from Find leads into a campaign (libs/sales/import-leads.js:
 * job posts are grouped into one lead per company).
 *
 * Body:
 *   {
 *     campaignId: string,
 *     profiles: Array<{ url, name?, title?, company?, source?: "linkedin" | "rozee" | "indeed", sourceData? }>,
 *     enrichInserted?: boolean  — if true, scrape Rozee job pages for imported rows (slower)
 *   }
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const body = await request.json();
    const campaignId = body?.campaignId;
    const profiles = Array.isArray(body?.profiles) ? body.profiles : [];

    if (!campaignId) return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
    if (!profiles.length) return NextResponse.json({ error: "profiles array is empty" }, { status: 400 });

    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, user.id)))
      .limit(1);
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const result = await importLeadProfiles({ userId: user.id, campaign, profiles });
    if (!result.inserted.length && !result.jobsAddedToExisting && !result.skipped.length && result.rejected.length) {
      return NextResponse.json({ error: "No importable profiles after validation", rejected: result.rejected }, { status: 400 });
    }

    const enrichmentErrors = [];
    if (body?.enrichInserted && result.inserted.length) {
      const [rozeeAcc] = await db
        .select()
        .from(rozeeAccounts)
        .where(and(eq(rozeeAccounts.userId, user.id), eq(rozeeAccounts.isActive, true)))
        .limit(1);
      for (const row of result.inserted) {
        if (row.source !== "rozee") continue;
        try {
          await enrichRozeeLeadInDb(row, rozeeAcc || {});
        } catch (err) {
          enrichmentErrors.push({ leadId: row.id, error: err instanceof Error ? err.message : "Enrichment failed" });
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: enrichmentErrors.length
        ? `${result.message.replace(/\.$/, "")}, ${enrichmentErrors.length} enrichment error${enrichmentErrors.length === 1 ? "" : "s"}.`
        : result.message,
      stats: {
        imported: result.inserted.length,
        companies: result.companiesInserted,
        jobsAddedToExisting: result.jobsAddedToExisting,
        skipped: result.skipped.length,
        rejected: result.rejected.length,
        total: profiles.length,
        enrichmentErrors: enrichmentErrors.length,
      },
      leads: result.inserted,
      importedUrls: result.importedUrls,
      skipped: result.skipped,
      rejected: result.rejected,
      enrichmentErrors,
    });
  } catch (error) {
    console.error("Lead scraper import error:", error);
    return NextResponse.json({ error: error.message || "Import failed" }, { status: 500 });
  }
});
