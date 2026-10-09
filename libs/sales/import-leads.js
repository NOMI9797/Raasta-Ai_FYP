// Save searched profiles / job posts into a campaign. Shared by Find leads (API route) and the sales
// agent (worker). Job-board results are job posts: they are grouped into one lead per company
// (sourceData.jobs), and a post from a company already in the campaign is added to it.
// Relative imports only.
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { campaigns, leads } from "../schema";
import { detectPlatformFromUrl } from "../platform-urls";
import { PLATFORM_ORDER } from "../platforms/meta";
import { PLATFORM_KIND } from "./stages";
import { groupProfilesByCompany, leadCompanyKey, jobFromProfile, jobsOf, mergeJobs } from "./companies";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * @param {{ userId: string, campaign: object, profiles: object[] }} input
 * @returns {{ inserted: object[], companiesInserted: number, jobsAddedToExisting: number,
 *            skipped: object[], rejected: object[], importedUrls: string[], message: string }}
 */
export async function importLeadProfiles({ userId, campaign, profiles }, { database = db } = {}) {
  const allowedSources = Array.isArray(campaign.sources) && campaign.sources.length ? campaign.sources : ["linkedin"];

  const normalised = [];
  const rejected = [];
  for (const p of profiles) {
    const url = typeof p?.url === "string" ? p.url.trim() : "";
    if (!url) {
      rejected.push({ url: p?.url || null, reason: "Missing URL" });
      continue;
    }
    const source = p?.source && PLATFORM_ORDER.includes(p.source) ? p.source : detectPlatformFromUrl(url);
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

  // Dedupe against every lead (and every grouped job post) in any of the user's campaigns
  const existing = await database.select().from(leads).where(eq(leads.userId, userId));
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
    userId,
    campaignId: campaign.id,
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
  for (const p of fresh.filter((r) => PLATFORM_KIND[r.source] !== "company")) toInsert.push(leadRow(p));

  // Job posts become one lead per company in this campaign
  const companyLeadsHere = existing.filter((l) => l.campaignId === campaign.id && PLATFORM_KIND[l.source] === "company");
  for (const group of groupProfilesByCompany(fresh.filter((r) => PLATFORM_KIND[r.source] === "company"))) {
    const jobs = group.profiles.map((p) => jobFromProfile(p, p.source));
    const match = group.key && companyLeadsHere.find((l) => leadCompanyKey(l) === group.key);
    if (match) {
      const merged = mergeJobs(jobsOf(match), jobs);
      jobsAddedToExisting += merged.length - jobsOf(match).length;
      await database
        .update(leads)
        .set({ sourceData: { ...(match.sourceData || {}), companyKey: group.key, jobs: merged }, updatedAt: new Date() })
        .where(eq(leads.id, match.id));
      continue;
    }
    const first = group.profiles[0];
    const name = group.name || first.name;
    toInsert.push(leadRow(first, { name, company: name, sourceData: { ...first.sourceData, companyKey: group.key, jobs } }));
    companiesInserted++;
  }

  const inserted = toInsert.length ? await database.insert(leads).values(toInsert).returning() : [];

  // Draft campaigns become active once they have leads
  if ((inserted.length || jobsAddedToExisting) && campaign.status === "draft") {
    await database
      .update(campaigns)
      .set({ status: "active", updatedAt: new Date() })
      .where(and(eq(campaigns.id, campaign.id), eq(campaigns.userId, userId)));
  }

  const people = inserted.length - companiesInserted;
  const parts = [
    people ? `Added ${plural(people, "person", "people")}` : null,
    companiesInserted ? `Added ${plural(companiesInserted, "company", "companies")}` : null,
    jobsAddedToExisting ? `${plural(jobsAddedToExisting, "job post", "job posts")} added to companies already in the campaign` : null,
    skipped.length ? `skipped ${plural(skipped.length, "duplicate", "duplicates")}` : null,
    rejected.length ? `rejected ${rejected.length}` : null,
  ].filter(Boolean);

  return {
    inserted,
    companiesInserted,
    jobsAddedToExisting,
    skipped,
    rejected,
    importedUrls: fresh.map((r) => r.url),
    message: `${parts.join(", ") || "Nothing new to add"}.`,
  };
}
