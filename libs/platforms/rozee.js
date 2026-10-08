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
import { searchRozeeJobPosts } from "../sales/rozee-search";
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
    return { success: false, code: "session_invalid", error: `Session invalid: ${sessionCheck.reason}` };
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

// Lead search (Find leads › Rozee.pk and the Sales agent): Rozee.pk job posts through a web search
// engine, because Rozee.pk blocks automated browsers with Cloudflare. No Rozee account is needed.
async function search(account, filters = {}) {
  const query = [filters.query, filters.keywords].map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean).join(" ");
  const location = typeof filters.location === "string" ? filters.location.trim() : "";
  if (!query && !location) {
    return { success: false, error: "At least one of query/keywords/location is required", results: [] };
  }
  try {
    const results = await searchRozeeJobPosts({ query, location, limit: Number(filters.limit) || 25 });
    return { success: true, results };
  } catch (error) {
    return { success: false, error: error.message, results: [] };
  }
}

export const rozeeAdapter = {
  searchNeedsAccount: false, // lead search goes through a search engine; the account is for publishing jobs
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
