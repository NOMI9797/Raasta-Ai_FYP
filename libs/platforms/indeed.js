/**
 * Indeed — job search via JobSpy (Lead Scraper). A hiring company is the lead.
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
        "Indeed job search isn’t set up on this server yet. Run npm run setup:indeed.",
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
    const { jobs, country } = await searchIndeedJobs({
      query,
      location,
      limit: filters.limit ?? 25,
      country: filters.country,
      hoursOld: filters.hoursOld,
    });

    const results = (jobs || [])
      .filter((j) => j?.url)
      .map((j) => ({
        url: j.url,
        name: j.company || null,
        company: j.company || null,
        title: j.title || null,
        location: j.location || null,
        salary: j.salary || null,
        source: ID,
        sourceData: {
          salary: j.salary || null,
          location: j.location || null,
          description: j.description || "",
          jobType: j.jobType || null,
          isRemote: j.isRemote || false,
          datePosted: j.datePosted || null,
          emails: j.emails || [],
          indeedCountry: country,
          // Company details Indeed already shows, so enrichment can skip what is known
          company: {
            indeedUrl: j.companyIndeedUrl || null,
            website: j.companyWebsite || null,
            industry: j.companyIndustry || null,
            employees: j.companyEmployees || null,
            revenue: j.companyRevenue || null,
            addresses: j.companyAddresses || null,
            description: j.companyDescription || null,
            logo: j.companyLogo || null,
          },
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
