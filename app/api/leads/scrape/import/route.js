import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { db } from "@/libs/db";
import { campaigns, leads, rozeeAccounts } from "@/libs/schema";
import { detectPlatformFromUrl } from "@/libs/platform-urls";
import { PLATFORM_IDS } from "@/libs/platforms";
import { enrichRozeeLeadInDb } from "@/libs/lead-rozee-enrichment";

/**
 * Import pre-scraped profiles from the Lead Scraper module into a campaign.
 *
 * Unlike POST /api/campaigns/[id]/leads (which only takes URLs and creates
 * pending leads to be scraped later), this endpoint trusts that the caller
 * already has usable profile data, so the resulting leads are saved with
 * `status='completed'` and their name/title/sourceData pre-filled.
 *
 * Body:
 *   {
 *     campaignId: string,
 *     profiles: Array<{
 *       url: string,
 *       name?: string,
 *       title?: string,
 *       source?: "linkedin" | "rozee" | "indeed",
 *       sourceData?: object
 *     }>
 *     enrichInserted?: boolean  — if true, scrape Rozee job pages for imported rows (slower)
 *   }
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const body = await request.json();
    const campaignId = body?.campaignId;
    const profiles = Array.isArray(body?.profiles) ? body.profiles : [];
    const enrichInserted = Boolean(body?.enrichInserted);

    if (!campaignId) {
      return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
    }
    if (!profiles.length) {
      return NextResponse.json({ error: "profiles array is empty" }, { status: 400 });
    }

    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, user.id)))
      .limit(1);

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const allowedSources = Array.isArray(campaign.sources) && campaign.sources.length
      ? campaign.sources
      : ["linkedin"];

    // Normalise + validate each incoming profile.
    const normalised = [];
    const rejected = [];
    for (const p of profiles) {
      const url = typeof p?.url === "string" ? p.url.trim() : "";
      if (!url) {
        rejected.push({ url: p?.url || null, reason: "Missing URL" });
        continue;
      }
      const inferredSource = detectPlatformFromUrl(url);
      const source = p?.source && PLATFORM_IDS.includes(p.source) ? p.source : inferredSource;
      if (!source) {
        rejected.push({ url, reason: "Unsupported URL" });
        continue;
      }
      if (!allowedSources.includes(source)) {
        rejected.push({ url, reason: `Campaign doesn't allow ${source}` });
        continue;
      }
      normalised.push({
        userId: user.id,
        campaignId,
        url,
        name: p?.name?.trim() || null,
        title: p?.title?.trim() || null,
        source,
        sourceData: p?.sourceData && typeof p.sourceData === "object" ? p.sourceData : {},
        status: "completed",
      });
    }

    if (!normalised.length) {
      return NextResponse.json(
        { error: "No importable profiles after validation", rejected },
        { status: 400 }
      );
    }

    // Dedupe against existing leads in any of the user's campaigns (matches
    // the behaviour of POST /api/campaigns/[id]/leads).
    const existing = await db
      .select({ url: leads.url, campaignId: leads.campaignId })
      .from(leads)
      .where(eq(leads.userId, user.id));
    const existingUrls = new Set(existing.map((l) => l.url));

    const toInsert = [];
    const skipped = [];
    for (const row of normalised) {
      if (existingUrls.has(row.url)) {
        skipped.push({ url: row.url, reason: "Already exists" });
      } else {
        toInsert.push(row);
        existingUrls.add(row.url); // guard against dupes inside this batch too
      }
    }

    let inserted = [];
    if (toInsert.length) {
      inserted = await db.insert(leads).values(toInsert).returning();
    }

    // Flip draft campaigns to active now that they have leads.
    if (inserted.length && campaign.status === "draft") {
      await db
        .update(campaigns)
        .set({ status: "active", updatedAt: new Date() })
        .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, user.id)));
    }

    const enrichmentErrors = [];
    if (enrichInserted && inserted.length) {
      const [rozeeAcc] = await db
        .select()
        .from(rozeeAccounts)
        .where(and(eq(rozeeAccounts.userId, user.id), eq(rozeeAccounts.isActive, true)))
        .limit(1);
      const sessionData = rozeeAcc || {};
      for (const row of inserted) {
        if (row.source !== "rozee") continue;
        try {
          await enrichRozeeLeadInDb(row, sessionData);
        } catch (err) {
          enrichmentErrors.push({
            leadId: row.id,
            error: err instanceof Error ? err.message : "Enrichment failed",
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Imported ${inserted.length} lead${inserted.length === 1 ? "" : "s"}${
        skipped.length ? `, skipped ${skipped.length} duplicate${skipped.length === 1 ? "" : "s"}` : ""
      }${rejected.length ? `, rejected ${rejected.length}` : ""}${
        enrichmentErrors.length
          ? `, ${enrichmentErrors.length} enrichment error${enrichmentErrors.length === 1 ? "" : "s"}`
          : ""
      }.`,
      stats: {
        imported: inserted.length,
        skipped: skipped.length,
        rejected: rejected.length,
        total: profiles.length,
        enrichmentErrors: enrichmentErrors.length,
      },
      leads: inserted,
      skipped,
      rejected,
      enrichmentErrors,
    });
  } catch (error) {
    console.error("Lead scraper import error:", error);
    return NextResponse.json(
      { error: error.message || "Import failed" },
      { status: 500 }
    );
  }
});
