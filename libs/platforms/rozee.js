/**
 * Rozee.pk Platform Adapter
 *
 * Wraps the existing libs/rozee-* modules behind the shared platform
 * adapter contract (see libs/platforms/index.js).
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { rozeeAccounts } from "../schema";
import {
  testRozeeSession,
  cleanupBrowserSession,
} from "../rozee-session-validator";
import { sendRozeeMessage } from "../rozee-message-sender";
import { publishRozeeJob } from "../rozee-job-publisher";
import { searchRozeeJobs, scrapeRozeeCandidate } from "../rozee-candidate-scraper";
import {
  checkDailyMessageLimitForPlatform,
  incrementMessageCounterForPlatform,
  checkDailyLimitForPlatform,
  incrementDailyCounterForPlatform,
} from "../rate-limit-manager";

const ID = "rozee";

async function getAccount(accountId) {
  const [account] = await db
    .select()
    .from(rozeeAccounts)
    .where(eq(rozeeAccounts.id, accountId))
    .limit(1);
  return account || null;
}

async function testSession(account, keepOpen = false) {
  return testRozeeSession(account, keepOpen);
}

async function cleanupSession(context) {
  return cleanupBrowserSession(context);
}

// Rozee's message sender spins up its own Playwright context per message,
// so there's no shared `page` concept today. `sendMessage` owns the full
// session lifecycle.
async function sendMessage(account, { leadUrl, message }) {
  return sendRozeeMessage({
    profileUrl: leadUrl,
    message,
    sessionData: account,
  });
}

async function publishJobWithPage(page, job) {
  return publishRozeeJob(page, job);
}

async function publishJob(account, job) {
  const sessionCheck = await testSession(account, true);
  if (!sessionCheck.isValid) {
    return { success: false, error: `Session invalid: ${sessionCheck.reason}` };
  }
  try {
    return await publishJobWithPage(sessionCheck.page, job);
  } finally {
    await cleanupSession(sessionCheck.context);
  }
}

// searchCandidates scrapes public Rozee job listings (authenticated session
// required so the server renders real cards). Returns job posts shaped as
// "leads": company = lead name, title = job title, url = job detail page.
async function searchCandidates(account, { query, location, limit = 20 } = {}) {
  if (!query && !location) return { success: false, error: "query or location is required", candidates: [] };
  try {
    const jobs = await searchRozeeJobs({ query, location, sessionData: account, limit });
    // Map job cards to the lead/candidate shape the rest of the app expects
    const candidates = jobs.map((j) => ({
      name:     j.company  || null,
      title:    j.title    || null,
      url:      j.url      || null,
      salary:   j.salary   || null,
      location: j.location || null,
      source:   "rozee",
    }));
    return { success: true, candidates };
  } catch (error) {
    return { success: false, error: error.message, candidates: [] };
  }
}

async function scrapeCandidate(account, url) {
  if (!url) return { success: false, error: "url is required", candidate: null };
  try {
    const candidate = await scrapeRozeeCandidate({ url, sessionData: account });
    return { success: true, candidate };
  } catch (error) {
    return { success: false, error: error.message, candidate: null };
  }
}

async function scrapeApplicants(account, job, opts = {}) {
  const skills = (job?.requiredSkills || []).slice(0, 5).join(" ");
  const query = skills || job?.title || "";
  return searchCandidates(account, { query, limit: opts.limit || 25 });
}

// Unified profile search used by the Lead Scraper module. Accepts a generic
// filters object so every adapter can expose the same entrypoint regardless
// of the underlying query language. Rozee only supports a free-text query
// today, so `location` / `keywords` are folded into it.
async function search(account, filters = {}) {
  // Build query from free-text fields; pass location separately so the
  // scraper can append it as a /city/ segment on the URL.
  const queryParts = [filters.query, filters.keywords]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  const query    = queryParts.join(" ").trim() || null;
  const location = typeof filters.location === "string" ? filters.location.trim() : null;

  if (!query && !location) {
    return { success: false, error: "At least one of query/keywords/location is required", results: [] };
  }

  const { success, error, candidates } = await searchCandidates(account, {
    query,
    location,
    limit: filters.limit || 25,
  });
  if (!success) return { success: false, error, results: [] };

  const results = (candidates || [])
    .filter((c) => c?.url)
    .map((c) => ({
      url:      c.url,
      name:     c.name     || null,   // company name
      title:    c.title    || null,   // job title
      location: c.location || null,
      salary:   c.salary   || null,
      source:   ID,
      sourceData: {
        salary:   c.salary   || null,
        location: c.location || null,
      },
    }));
  return { success: true, results };
}

export const rozeeAdapter = {
  id: ID,
  label: "Rozee.pk",
  accountsTable: rozeeAccounts,

  getAccount,
  testSession,
  cleanupSession,
  sendMessage,
  publishJob,
  publishJobWithPage,
  scrapeApplicants,
  searchCandidates,
  scrapeCandidate,
  search,

  rateLimit: {
    checkMessages: (accountId) => checkDailyMessageLimitForPlatform(accountId, ID),
    incrementMessages: (accountId) => incrementMessageCounterForPlatform(accountId, ID),
    checkInvites: (accountId) => checkDailyLimitForPlatform(accountId, ID),
    incrementInvites: (accountId, n = 1) =>
      incrementDailyCounterForPlatform(accountId, ID, n),
  },
};
