/**
 * Indeed job listings search for the Lead Scraper.
 *
 * Runs services/indeed-search/search.py (JobSpy, free and open source) in a
 * child process: one JSON request on stdin, one JSON response on stdout.
 *
 * Python: INDEED_SEARCH_PYTHON, else services/indeed-search/.venv, else python3.
 * Set it up once with `npm run setup:indeed`.
 * Country: opts.country (ISO2 or name) or INDEED_JOBS_COUNTRY env, default Pakistan.
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const SERVICE_DIR = path.join(process.cwd(), "services", "indeed-search");
const SCRIPT_PATH = path.join(SERVICE_DIR, "search.py");
const VENV_PYTHON = path.join(SERVICE_DIR, ".venv", "bin", "python");
const SEARCH_TIMEOUT_MS = 120_000;

/** ISO2 / short codes → the country names JobSpy expects for country_indeed. */
const COUNTRY_NAMES = {
  pk: "pakistan",
  us: "usa",
  uk: "uk",
  gb: "uk",
  ca: "canada",
  au: "australia",
  in: "india",
  de: "germany",
  fr: "france",
  ae: "united arab emirates",
  sa: "saudi arabia",
  qa: "qatar",
  sg: "singapore",
};

/** Normalise a country code or name to a JobSpy country name. */
export function resolveIndeedCountry(country) {
  const raw = String(country || process.env.INDEED_JOBS_COUNTRY || "pk").trim().toLowerCase();
  return COUNTRY_NAMES[raw] || raw;
}

function pythonPath() {
  if (process.env.INDEED_SEARCH_PYTHON) return process.env.INDEED_SEARCH_PYTHON;
  if (fs.existsSync(VENV_PYTHON)) return VENV_PYTHON;
  return "python3";
}

export function isIndeedJobSearchConfigured() {
  return Boolean(process.env.INDEED_SEARCH_PYTHON) || fs.existsSync(VENV_PYTHON);
}

function runSearchScript(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath(), [SCRIPT_PATH], { cwd: SERVICE_DIR });
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Indeed search took too long. Try a narrower search or fewer results."));
    }, SEARCH_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Could not start the Indeed search (${err.message}). Run npm run setup:indeed.`));
    });
    child.on("close", () => {
      clearTimeout(timer);
      let data;
      try {
        data = JSON.parse(stdout);
      } catch {
        console.error("[Indeed search] unreadable output:", stderr.slice(-500));
        reject(new Error("Indeed search failed. Run npm run setup:indeed if it was never set up."));
        return;
      }
      if (data.error) reject(new Error(`Indeed search failed: ${data.error}`));
      else resolve(data.jobs || []);
    });

    child.stdin.end(JSON.stringify(request));
  });
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
  const descLow = (job.description || "").toLowerCase();
  let matched = 0;
  for (const t of tokens) {
    if (titleLow.includes(t)) {
      matched += 2;
    } else if (descLow.includes(t)) {
      matched += 1;
    }
  }
  return matched / (2 * tokens.length);
}

/** Put the best keyword matches first and drop weak ones (keeps everything if nothing passes). */
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
 * @param {{ query?: string, keywords?: string, location?: string, limit?: number, country?: string, hoursOld?: number }} opts
 * @returns {Promise<{ jobs: object[], country: string }>} jobs as returned by search.py
 */
export async function searchIndeedJobs(opts = {}) {
  const parts = [opts.query, opts.keywords]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  const keyword = parts.join(" ").trim();
  const location = typeof opts.location === "string" ? opts.location.trim() : "";

  if (!keyword && !location) {
    throw new Error("At least one of query/keywords/location is required");
  }

  const country = resolveIndeedCountry(opts.country);
  const maxResults = Math.min(Math.max(Number(opts.limit) || 25, 1), 100);

  // Fetch extra so the relevance filter still leaves enough rows
  const fetched = await runSearchScript({
    query: keyword,
    location,
    country,
    limit: Math.min(maxResults * 2, 200),
    hoursOld: opts.hoursOld || null,
  });

  const seen = new Set();
  let jobs = fetched.filter((j) => j.url && !seen.has(j.url) && seen.add(j.url));
  if (keyword) jobs = filterByKeywordRelevance(jobs, keyword);

  return { jobs: jobs.slice(0, maxResults), country };
}
