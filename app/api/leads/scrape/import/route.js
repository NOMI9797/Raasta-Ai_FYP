import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { db } from "@/libs/db";
import { campaigns, leads, rozeeAccounts } from "@/libs/schema";
import { detectPlatformFromUrl } from "@/libs/platform-urls";
import { PLATFORM_IDS } from "@/libs/platforms";
import { enrichRozeeLeadInDb } from "@/libs/lead-rozee-enrichment";
import { PLATFORM_KIND } from "@/libs/sales/stages";
import { companyKey, companyNameOf, groupProfilesByCompany, jobFromProfile, jobsOf, mergeJobs } from "@/libs/sales/companies";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Import pre-scraped profiles from Find leads into a campaign.
 *
 * Unlike POST /api/campaigns/[id]/leads (which only takes URLs and creates
 * pending leads to be scraped later), this endpoint trusts that the caller
 * already has usable data, so leads are saved with `status='completed'`.
 *
 * Job-board results (Rozee.pk, Indeed) are job posts; they are grouped into
 * one lead per company (sourceData.jobs lists its posts). A post from a company
 * already in the campaign is added to that company instead of creating a lead.
 *
 * Body:
 *   {
 *     campaignId: string,
 *     profiles: Array<{
 *       url: string,
 *       name?: string,
 *       title?: string,
 *       company?: string,
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
        ...p,
        url,
        name: p?.name?.trim() || null,
        title: p?.title?.trim() || null,
        company: p?.company?.trim() || null,
        source,
        sourceData: p?.sourceData && typeof p.sourceData === "object" ? p.sourceData : {},
      });
    }

    if (!normalised.length) {
      return NextResponse.json(
        { error: "No importable profiles after validation", rejected },
        { status: 400 }
      );
    }

    // Dedupe against every lead (and every grouped job post) in any of the user's campaigns
    const existing = await db.select().from(leads).where(eq(leads.userId, user.id));
    const existingUrls = new Set();
    for (const lead of existing) {
      existingUrls.add(lead.url);
      for (const job of jobsOf(lead)) existingUrls.add(job.url);
    }

    const skipped = [];
    const fresh = [];
    for (const row of normalised) {
      if (existingUrls.has(row.url)) {
        skipped.push({ url: row.url, reason: "Already exists" });
      } else {
        fresh.push(row);
        existingUrls.add(row.url); // guard against dupes inside this batch too
      }
    }

    const leadRow = (p, extra = {}) => ({
      userId: user.id,
      campaignId,
      url: p.url,
      name: p.name,
      title: p.title,
      company: p.company,
      source: p.source,
      sourceData: p.sourceData,
      status: "completed",
      ...extra,
    });

    const toInsert = [];
    let jobsAddedToExisting = 0;
    let companiesInserted = 0;

    // People are one lead each
    for (const p of fresh.filter((r) => PLATFORM_KIND[r.source] !== "company")) {
      toInsert.push(leadRow(p));
    }

    // Job posts become one lead per company in this campaign
    const companyLeadsHere = existing.filter((l) => l.campaignId === campaignId && PLATFORM_KIND[l.source] === "company");
    const companyProfiles = fresh.filter((r) => PLATFORM_KIND[r.source] === "company");
    for (const group of groupProfilesByCompany(companyProfiles)) {
      const jobs = group.profiles.map((p) => jobFromProfile(p, p.source));
      const match = group.key && companyLeadsHere.find((l) => (l.sourceData?.companyKey || companyKey(companyNameOf(l))) === group.key);
      if (match) {
        const merged = mergeJobs(jobsOf(match), jobs);
        jobsAddedToExisting += merged.length - jobsOf(match).length;
        await db
          .update(leads)
          .set({ sourceData: { ...(match.sourceData || {}), companyKey: group.key, jobs: merged }, updatedAt: new Date() })
          .where(eq(leads.id, match.id));
        continue;
      }
      const first = group.profiles[0];
      const name = group.name || first.name;
      toInsert.push(
        leadRow(first, {
          name,
          company: name,
          sourceData: { ...first.sourceData, companyKey: group.key, jobs },
        })
      );
      companiesInserted++;
    }

    let inserted = [];
    if (toInsert.length) {
      inserted = await db.insert(leads).values(toInsert).returning();
    }

    // Flip draft campaigns to active now that they have leads.
    if ((inserted.length || jobsAddedToExisting) && campaign.status === "draft") {
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

    const people = inserted.length - companiesInserted;
    const parts = [
      people ? `Added ${plural(people, "person", "people")}` : null,
      companiesInserted ? `Added ${plural(companiesInserted, "company", "companies")}` : null,
      jobsAddedToExisting ? `${plural(jobsAddedToExisting, "job post", "job posts")} added to companies already in the campaign` : null,
      skipped.length ? `skipped ${plural(skipped.length, "duplicate", "duplicates")}` : null,
      rejected.length ? `rejected ${rejected.length}` : null,
      enrichmentErrors.length ? `${plural(enrichmentErrors.length, "enrichment error", "enrichment errors")}` : null,
    ].filter(Boolean);

    return NextResponse.json({
      success: true,
      message: `${parts.join(", ") || "Nothing new to add"}.`,
      stats: {
        imported: inserted.length,
        companies: companiesInserted,
        jobsAddedToExisting,
        skipped: skipped.length,
        rejected: rejected.length,
        total: profiles.length,
        enrichmentErrors: enrichmentErrors.length,
      },
      leads: inserted,
      // Every URL that is now in the campaign, so the caller can clear them from its list
      importedUrls: fresh.map((r) => r.url),
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
