// The sales pipeline as ordered steps. Sidebar, step pages and the setup guide all read this list.

export const SALES_STAGES = [
  {
    key: "campaigns",
    step: 1,
    label: "Campaigns",
    href: "/dashboard/sales/campaigns",
    summary: "Create a campaign: who you want to reach and which platforms to find them on.",
  },
  {
    key: "find",
    step: 2,
    label: "Find leads",
    href: "/dashboard/sales/find-leads",
    summary: "Add people from LinkedIn, or find companies that are hiring on Rozee.pk and Indeed.",
  },
  {
    key: "research",
    step: 3,
    label: "Research",
    href: "/dashboard/sales/research",
    summary: "Learn about each lead: LinkedIn profiles and posts, or company details and who to contact.",
  },
  {
    key: "messages",
    step: 4,
    label: "Messages",
    href: "/dashboard/sales/messages",
    summary: "AI writes a personal message for each lead. Review, edit and approve them.",
  },
  {
    key: "outreach",
    step: 5,
    label: "Outreach",
    href: "/dashboard/sales/outreach",
    summary: "Send LinkedIn invites and messages, or email companies, and track who responds.",
  },
  {
    key: "results",
    step: 6,
    label: "Results",
    href: "/dashboard/sales/results",
    summary: "See how each campaign and platform performed.",
  },
];

export const SALES_SETUP_PATH = "/dashboard/sales/setup";

/** LinkedIn leads are people; Rozee.pk and Indeed leads are companies that are hiring. */
export const PLATFORM_KIND = { linkedin: "person", rozee: "company", indeed: "company" };

export function getStage(key) {
  return SALES_STAGES.find((s) => s.key === key) || null;
}

export function nextStage(key) {
  const i = SALES_STAGES.findIndex((s) => s.key === key);
  return i >= 0 ? SALES_STAGES[i + 1] || null : null;
}

/** Link to a stage page, keeping the selected campaign and platform. */
export function stageHref(key, { campaignId, platform } = {}) {
  const stage = getStage(key);
  if (!stage) return "/dashboard/sales/campaigns";
  const params = new URLSearchParams();
  if (campaignId) params.set("campaign", campaignId);
  if (platform) params.set("platform", platform);
  const query = params.toString();
  return query ? `${stage.href}?${query}` : stage.href;
}
