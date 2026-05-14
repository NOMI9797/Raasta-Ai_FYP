/**
 * Indeed — job search via hosted Indeed scraper (Lead Scraper).
 */

import { searchIndeedJobs, isIndeedJobSearchConfigured } from "../indeed-job-search";

const ID = "indeed";

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

  async getAccount() {
    return null;
  },
  async testSession() {
    return {
      isValid: isIndeedJobSearchConfigured(),
      reason: isIndeedJobSearchConfigured()
        ? "Ready"
        : "Not configured on this server.",
    };
  },
  async cleanupSession() {
    /* noop */
  },
  async sendMessage() {
    return notSupported();
  },
  async publishJob() {
    return notSupported();
  },
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
