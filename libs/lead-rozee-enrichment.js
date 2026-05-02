import { eq } from "drizzle-orm";
import { db } from "./db";
import { leads } from "./schema";
import { scrapeRozeeJobDetail } from "./rozee-job-scraper";
import { buildRozeeConversionFromDetail } from "./lead-conversion";
import { enrichLead as enrichLeadAdvanced } from "./rozee-enrichment";
import { DEFAULT_BROWSER_ARGS } from "./playwright-utils";

async function runAdvancedCompanyEnrichment(lead, detail) {
  const companyName = detail.company || lead.company || lead.name || "";
  if (!companyName) return null;

  const googleApiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;
  const serpApiKey = process.env.SERP_API_KEY;

  if (!googleApiKey && !serpApiKey) {
    console.log("[ROZEE_ENRICH_ADV] skip: no Google/SERP key configured");
    return null;
  }

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: DEFAULT_BROWSER_ARGS,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    console.log(`[ROZEE_ENRICH_ADV] start company="${companyName}"`);
    const enriched = await enrichLeadAdvanced(
      page,
      {
        company: companyName,
        companyName,
        location: detail.location || lead.sourceData?.location || null,
        title: detail.title || lead.title || null,
        linkedinCompanyUrl:
          detail.companyResearch?.linkedinCompanyUrl ||
          detail.socialLinks?.find((u) => /linkedin\.com\/company\//i.test(u)) ||
          null,
      },
      {
        googleApiKey,
        searchEngineId,
        serpApiKey,
      }
    );

    const profile = {
      companyWebsite: enriched.companyWebsite || null,
      primaryEmail: enriched.primaryEmail || null,
      companyEmails: Array.isArray(enriched.companyEmails) ? enriched.companyEmails : [],
      primaryPhone: enriched.primaryPhone || null,
      companyPhones: Array.isArray(enriched.companyPhones) ? enriched.companyPhones : [],
      linkedinCompanyUrl: enriched.linkedinCompanyUrl || null,
      twitterUrl: enriched.twitterUrl || null,
      facebookUrl: enriched.facebookUrl || null,
      instagramUrl: enriched.instagramUrl || null,
      youtubeUrl: enriched.youtubeUrl || null,
      companyDescription: enriched.companyDescription || null,
      companyIndustry: enriched.companyIndustry || null,
      companySize: enriched.companySize || null,
      companyHeadquarters: enriched.companyHeadquarters || null,
      companyFounded: enriched.companyFounded || null,
      companySpecialties: enriched.companySpecialties || null,
      linkedinFollowers: enriched.linkedinFollowers || null,
      linkedinWebsite: enriched.linkedinWebsite || null,
      enrichedAt: enriched.enrichedAt || new Date().toISOString(),
      enrichmentSource: Array.isArray(enriched.enrichmentSource) ? enriched.enrichmentSource : [],
    };

    console.log(
      `[ROZEE_ENRICH_ADV] done company="${companyName}" website=${profile.companyWebsite ? "yes" : "no"} emails=${profile.companyEmails.length} linkedin=${profile.linkedinCompanyUrl ? "yes" : "no"}`
    );
    return profile;
  } catch (error) {
    console.warn(
      `[ROZEE_ENRICH_ADV] failed company="${companyName}" reason=${error instanceof Error ? error.message : "unknown"}`
    );
    return null;
  } finally {
    await browser.close();
  }
}

/**
 * Scrape Rozee job detail + merge conversion block into lead.sourceData.
 * Optionally fills `company` / `title` when empty.
 */
export async function computeRozeeLeadEnrichmentUpdates(lead, sessionData = {}) {
  console.log(`[ROZEE_ENRICH] compute start lead=${lead.id}`);
  const detail = await scrapeRozeeJobDetail({ url: lead.url, sessionData });
  console.log(
    `[ROZEE_ENRICH] detail fetched lead=${lead.id} title=${Boolean(detail.title)} descLen=${(detail.description || "").length} emails=${(detail.emails || []).length}`
  );
  const conversionBlock = buildRozeeConversionFromDetail(lead, detail);
  const advancedProfile = await runAdvancedCompanyEnrichment(lead, detail);

  const prev =
    lead.sourceData && typeof lead.sourceData === "object" && !Array.isArray(lead.sourceData)
      ? { ...lead.sourceData }
      : {};

  const sourceData = { ...prev, ...conversionBlock };
  if (advancedProfile) {
    if (!sourceData.conversion) sourceData.conversion = {};
    if (!sourceData.conversion.enrichment) sourceData.conversion.enrichment = {};
    sourceData.conversion.enrichment.companyProfile = advancedProfile;
    if (!sourceData.conversion.outreach) sourceData.conversion.outreach = {};
    const existingEmails = Array.isArray(sourceData.conversion.outreach.emailsFound)
      ? sourceData.conversion.outreach.emailsFound
      : [];
    const mergedEmails = [
      ...new Set([...existingEmails, ...(advancedProfile.companyEmails || [])]),
    ];
    sourceData.conversion.outreach.emailsFound = mergedEmails.slice(0, 10);
    if (!sourceData.conversion.outreach.canEmail && mergedEmails.length > 0) {
      sourceData.conversion.outreach.canEmail = true;
      sourceData.conversion.outreach.primaryChannel = "email";
      sourceData.conversion.outreach.note =
        "Company contact email found during company-site enrichment.";
    }
  }

  const updates = {
    sourceData,
    updatedAt: new Date(),
  };

  const co = (detail.company || "").trim();
  if (co && !(lead.company || "").trim()) updates.company = co;
  if (!(lead.name || "").trim() && co) updates.name = co;

  const ti = (detail.title || "").trim();
  if (ti && !(lead.title || "").trim()) updates.title = ti;

  const conv = conversionBlock?.conversion || {};
  console.log(
    `[ROZEE_ENRICH] compute done lead=${lead.id} tier=${conv.tier || "-"} score=${typeof conv.score === "number" ? conv.score : "-"} channel=${conv.outreach?.primaryChannel || "-"}`
  );
  return updates;
}

export async function enrichRozeeLeadInDb(lead, sessionData = {}) {
  console.log(`[ROZEE_ENRICH] db update start lead=${lead.id}`);
  const updates = await computeRozeeLeadEnrichmentUpdates(lead, sessionData);
  await db.update(leads).set(updates).where(eq(leads.id, lead.id));
  console.log(`[ROZEE_ENRICH] db update done lead=${lead.id}`);
  return updates;
}
