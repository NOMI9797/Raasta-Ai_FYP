/**
 * Indeed job listings search — hosted runner integration.
 * Country/site: opts.country (ISO2) or INDEED_JOBS_COUNTRY env — not inferred from free-text location.
 */

import { ApifyClient as JobRunnerClient } from "apify-client";
import { getScraperServiceTokenFromEnv, isScraperServiceConfigured } from "./scraper-credentials";

const INDEED_JOB_RUNNER_ID = "misceres/indeed-scraper";

/** Normalise env/UI country tokens (pk → PK). Hostname uses generic xx.indeed.com except US → www. */
const COUNTRY_CODES = {
  us: "US",
  pk: "PK",
  uk: "UK",
  ca: "CA",
  au: "AU",
  in: "IN",
  de: "DE",
  fr: "FR",
  ae: "AE",
  sg: "SG",
};

function getIndeedJobsHostname(countryLabel) {
  const cc = String(countryLabel || "")
    .trim()
    .toUpperCase()
    .slice(0, 2);
  if (!cc || cc.length !== 2) return "www.indeed.com";
  if (cc === "US") return "www.indeed.com";
  return `${cc.toLowerCase()}.indeed.com`;
}

function resolveIndeedCountry(explicitCountry) {
  if (explicitCountry != null && String(explicitCountry).trim()) {
    return mapIndeedJobsCountry(explicitCountry);
  }
  return mapIndeedJobsCountry(null);
}

/** Drop listings whose URL host does not match the selected Indeed region (stops cross-site bleed). */
export function jobUrlMatchesIndeedCountry(jobUrl, countryLabel) {
  if (!jobUrl || typeof jobUrl !== "string") return false;
  let host;
  try {
    host = new URL(jobUrl.trim()).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (countryLabel === "US") {
    return host === "www.indeed.com" || host === "indeed.com";
  }

  const expected = getIndeedJobsHostname(countryLabel).toLowerCase();
  return host === expected;
}

function pick(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

export function isIndeedJobSearchConfigured() {
  return isScraperServiceConfigured();
}

export function mapIndeedJobsCountry(code) {
  if (!code || typeof code !== "string") {
    const env = String(
      process.env.INDEED_JOBS_COUNTRY || process.env.INDEED_APIFY_COUNTRY || "pk"
    )
      .trim()
      .toLowerCase();
    return COUNTRY_CODES[env] || env.slice(0, 2).toUpperCase();
  }
  const k = code.trim().toLowerCase();
  return COUNTRY_CODES[k] || k.slice(0, 2).toUpperCase();
}

/**
 * Build Indeed SERP URL on the correct country host (geography matches the site you scrape).
 */
export function buildIndeedJobsSearchUrl(keyword, location, countryLabel = "US") {
  const params = new URLSearchParams();
  params.set("q", keyword && keyword.trim() ? keyword.trim() : "jobs");
  const loc = typeof location === "string" ? location.trim() : "";
  if (loc) params.set("l", loc);
  const host = getIndeedJobsHostname(countryLabel);
  return `https://${host}/jobs?${params.toString()}`;
}

function cleanJobRow(job) {
  const desc =
    typeof job.description === "string"
      ? job.description
      : typeof job.snippet === "string"
        ? job.snippet
        : "";
  const snippet = desc ? desc.slice(0, 500) : "";

  const url = pick(job, ["url", "link"]);
  if (!url || !/^https?:\/\//i.test(url)) return null;

  return {
    url,
    title: pick(job, ["positionName", "title"]) || null,
    company: pick(job, ["companyName", "company"]) || null,
    location: pick(job, ["location"]) || null,
    salary: pick(job, ["salary", "salaryText"]) || null,
    snippet,
    indeedRaw: job,
  };
}

function tokeniseQuery(q) {
  const stopWords = new Set([
    "a","an","the","and","or","in","on","at","for","of","to","with","is","are",
    "be","was","were","has","have","do","does","job","jobs","work","position",
    "role","opening","opportunity","full","time","part","remote","hybrid",
  ]);
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stopWords.has(w));
}

function keywordScore(job, tokens) {
  if (!tokens.length) return 1;
  const titleLow = (job.title || "").toLowerCase();
  const snippetLow = (job.snippet || "").toLowerCase();
  let matched = 0;
  for (const t of tokens) {
    if (titleLow.includes(t)) {
      matched += 2;
    } else if (snippetLow.includes(t)) {
      matched += 1;
    }
  }
  return matched / (2 * tokens.length);
}

function filterByKeywordRelevance(jobs, query, { threshold = 0.4 } = {}) {
  const tokens = tokeniseQuery(query);
  if (!tokens.length) return jobs;

  const scored = jobs.map((j) => ({ job: j, score: keywordScore(j, tokens) }));
  const filtered = scored.filter((s) => s.score >= threshold);

  const base = filtered.length ? filtered : scored;
  base.sort((a, b) => b.score - a.score);
  return base.map((s) => s.job);
}

/**
 * @param {{ query?: string, keywords?: string, location?: string, limit?: number, country?: string }} opts
 */
export async function searchIndeedJobs(opts = {}) {
  const token = getScraperServiceTokenFromEnv();
  if (!token) {
    throw new Error(
      "Indeed job search isn’t configured on this server. Your administrator needs to add scraping credentials."
    );
  }

  const parts = [opts.query, opts.keywords]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  const folded = parts.join(" ").trim();
  const loc = typeof opts.location === "string" ? opts.location.trim() : "";

  if (!folded && !loc) {
    throw new Error("At least one of query/keywords/location is required");
  }

  const keyword = folded || "jobs";
  const countryLabel = resolveIndeedCountry(opts.country);
  const maxResults = Math.min(Math.max(Number(opts.limit) || 25, 1), 100);

  const fetchLimit = Math.min(maxResults * 3, 100);

  const actorLocation = loc;

  const runInput = {
    position: keyword,
    maxItemsPerSearch: fetchLimit,
    country: countryLabel,
    location: actorLocation,
    parseCompanyDetails: false,
    saveOnlyUniqueItems: true,
    followApplyRedirects: false,
    startUrls: [{ url: buildIndeedJobsSearchUrl(keyword, loc, countryLabel) }],
  };

  const client = new JobRunnerClient({ token });

  let run;
  try {
    run = await client.actor(INDEED_JOB_RUNNER_ID).call(runInput);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Indeed job search failed: ${msg}`);
  }

  const datasetId = run?.defaultDatasetId;
  if (!datasetId) {
    throw new Error("Indeed search finished without result data.");
  }

  const { items } = await client.dataset(datasetId).listItems({ limit: Math.min(fetchLimit + 50, 500) });

  let cleaned = (items || []).map(cleanJobRow).filter(Boolean);

  cleaned = cleaned.filter((j) => jobUrlMatchesIndeedCountry(j.url, countryLabel));

  if (keyword && keyword !== "jobs") {
    cleaned = filterByKeywordRelevance(cleaned, keyword);
  }

  const jobs = cleaned.slice(0, maxResults);

  return { jobs, countryLabel };
}
