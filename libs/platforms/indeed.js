/**
 * Indeed
 *  - job search via the hosted Indeed scraper (Lead Scraper, Sales): needs no account
 *  - job publishing (Hiring): posts through a connected Indeed employer session, like LinkedIn and Rozee.pk
 *
 * `accountsTable` stays null on purpose: the Lead Scraper treats a non-null table as "this platform needs a
 * connected account" and would start refusing Indeed searches. Publishing finds its account through getAccount().
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { indeedAccounts } from "../schema";
import { searchIndeedJobs, isIndeedJobSearchConfigured } from "../indeed-job-search";
import { testIndeedSession, cleanupBrowserSession } from "../indeed-session-validator";
import { publishIndeedJob } from "../indeed-job-publisher";
import { DebugRecorder, debugEnabled } from "../indeed-debug";

const ID = "indeed";

async function getPublishAccount(accountId) {
  const [account] = await db
    .select()
    .from(indeedAccounts)
    .where(eq(indeedAccounts.id, accountId))
    .limit(1);
  return account || null;
}

async function publishJob(account, job) {
  // INDEED_DEBUG=true records screenshots, page structure and errors for every attempt (libs/indeed-debug.js)
  const recorder = debugEnabled() ? new DebugRecorder({ label: "publish" }) : null;
  const sessionCheck = await testIndeedSession(account, true, { recorder });

  // Close the recording and point a failed attempt at it
  const done = async (result) => {
    if (!recorder) return result;
    await recorder.finish({ success: result.success, code: result.code, error: result.error });
    return result.success ? result : { ...result, error: `${result.error} Debug trace: ${recorder.location}` };
  };

  if (!sessionCheck.isValid) {
    // A verification page is the platform asking a person to confirm something. Report it and stop; never push through.
    if (sessionCheck.challenge) {
      return done({ success: false, code: "checkpoint", error: "Indeed showed its bot check to the automated browser, so nothing was posted. Reconnecting the account will not change that. Use Copy and open to post it yourself." });
    }
    return done({ success: false, code: "session_invalid", error: `Session invalid: ${sessionCheck.reason}` });
  }
  try {
    return await done(await publishIndeedJob(sessionCheck.page, job, { recorder }));
  } finally {
    await cleanupBrowserSession(sessionCheck.context);
  }
}

function notSupported() {
  return {
    success: false,
    error: "This action is not supported for Indeed in this app.",
  };
}

async function search(_account, filters = {}) {
  if (!isIndeedJobSearchConfigured()) {
    return {
      success: false,
      error:
        "Indeed job search isn’t enabled on this server yet. Ask your administrator to configure scraping.",
      results: [],
    };
  }

  const queryParts = [filters.query, filters.keywords]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  const query = queryParts.join(" ").trim();
  const location = typeof filters.location === "string" ? filters.location.trim() : "";

  if (!query && !location) {
    return {
      success: false,
      error: "At least one of query/keywords/location is required",
      results: [],
    };
  }

  try {
    const { jobs, countryLabel } = await searchIndeedJobs({
      query,
      location,
      limit: filters.limit ?? 25,
      country: filters.country,
    });

    const cc = String(countryLabel || "PK").toLowerCase();

    const results = (jobs || [])
      .filter((j) => j?.url)
      .map((j) => ({
        url: j.url,
        name: j.company || null,
        title: j.title || null,
        location: j.location || null,
        salary: j.salary || null,
        source: ID,
        sourceData: {
          salary: j.salary || null,
          location: j.location || null,
          description: j.snippet || "",
          indeedCountry: cc,
          indeedRaw: j.indeedRaw || null,
        },
      }));

    return { success: true, results };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Indeed search failed";
    console.error("[Indeed adapter] search failed:", msg);
    return { success: false, error: msg, results: [] };
  }
}

export const indeedAdapter = {
  id: ID,
  label: "Indeed",
  comingSoon: false,
  accountsTable: null,

  getAccount: getPublishAccount,
  // Search needs no session, so a call without an account only reports whether the hosted scraper is configured
  async testSession(account, keepOpen = false) {
    if (account) return testIndeedSession(account, keepOpen);
    return {
      isValid: isIndeedJobSearchConfigured(),
      reason: isIndeedJobSearchConfigured()
        ? "Ready"
        : "Not configured on this server.",
    };
  },
  cleanupSession: cleanupBrowserSession,
  async sendMessage() {
    return notSupported();
  },
  publishJob,
  async scrapeApplicants() {
    return { success: false, error: notSupported().error, candidates: [] };
  },
  search,

  rateLimit: {
    async checkMessages() {
      return { canSend: false, remaining: 0, limit: 0, resetsAt: new Date(), sent: 0 };
    },
    async incrementMessages() {
      /* noop */
    },
    async checkInvites() {
      return { canSend: false, remaining: 0, limit: 0, resetsAt: new Date(), sent: 0 };
    },
    async incrementInvites() {
      /* noop */
    },
  },
};
