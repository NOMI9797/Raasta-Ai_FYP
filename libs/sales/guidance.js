// "What next?" for sales: turns counts from the database into the checklist shown on the Sales setup guide.
// Same shape as the hiring checklist ({ steps, next, attention }) so both use one Checklist component.
import { SALES_STAGES } from "./stages";

const href = (key) => SALES_STAGES.find((s) => s.key === key).href;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * @param {object} counts linkedinAccounts, rozeeAccounts, campaigns, leads, researchedLeads, messages,
 *                        contactedLeads, salesAgents
 * @param {{ indeedReady?: boolean, searchProvider?: "serper"|"duckduckgo" }} setup
 */
export function buildSalesGuidance(counts, { indeedReady = false, searchProvider = "duckduckgo" } = {}) {
  const steps = [
    {
      id: "linkedin",
      title: "Connect a LinkedIn account",
      detail: counts.linkedinAccounts > 0
        ? "A LinkedIn account is connected."
        : "Needed to read profiles and send invites and messages. Not needed for company leads you email.",
      done: counts.linkedinAccounts > 0,
      href: "/dashboard/platforms",
      cta: "Connect",
    },
    {
      id: "job-boards",
      title: "Get Rozee.pk and Indeed ready",
      detail: [
        indeedReady ? "Indeed search is ready." : "Indeed search is not set up on this server (npm run setup:indeed).",
        // Rozee.pk blocks automated browsers, so its job posts are found through a search engine
        searchProvider === "serper"
          ? "Rozee.pk search is ready (Google, through Serper)."
          : "Rozee.pk search uses a free search engine that stops after a few searches: add SERPER_API_KEY.",
      ].join(" "),
      done: indeedReady && searchProvider === "serper",
      optional: true,
      href: "/dashboard/platforms",
      cta: "Platforms",
    },
    {
      id: "campaign",
      title: "Create a campaign",
      detail: counts.campaigns > 0 ? `${plural(counts.campaigns, "campaign", "campaigns")}.` : "Say who you want to reach and which platforms to use.",
      done: counts.campaigns > 0,
      href: href("campaigns"),
      cta: "Create",
    },
    {
      id: "leads",
      title: "Find leads",
      detail: counts.leads > 0 ? `${plural(counts.leads, "lead", "leads")} added.` : "Add LinkedIn people, or find companies that are hiring.",
      done: counts.leads > 0,
      href: href("find"),
      cta: "Find leads",
    },
    {
      id: "research",
      title: "Research your leads",
      detail: counts.researchedLeads > 0 ? `${plural(counts.researchedLeads, "lead", "leads")} researched.` : "Read profiles and posts, or look up company details.",
      done: counts.researchedLeads > 0,
      href: href("research"),
      cta: "Research",
    },
    {
      id: "messages",
      title: "Write messages",
      detail: counts.messages > 0 ? `${plural(counts.messages, "message", "messages")} written.` : "AI writes a personal message for each lead; you approve them.",
      done: counts.messages > 0,
      href: href("messages"),
      cta: "Messages",
    },
    {
      id: "outreach",
      title: "Start outreach",
      detail: counts.contactedLeads > 0 ? `${plural(counts.contactedLeads, "lead", "leads")} contacted.` : "Send invites, messages or emails.",
      done: counts.contactedLeads > 0,
      href: href("outreach"),
      cta: "Outreach",
    },
    {
      id: "agent",
      title: "Let the Sales agent run it",
      detail: counts.salesAgents > 0 ? "A Sales agent is set up." : "Optional. The agent runs the steps for you and asks before sending.",
      done: counts.salesAgents > 0,
      optional: true,
      href: "/dashboard/agents",
      cta: "Set up",
    },
  ];

  const next = steps.find((s) => !s.done && !s.optional) || null;
  return { steps, next, attention: [] };
}
