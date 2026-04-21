/**
 * Platform Metadata
 *
 * Single source of truth for the "UI-level" description of each platform.
 * Import this from any UI file (Platforms page, onboarding, campaign/job
 * modals, source badges, etc.) so platform lists stay in sync.
 *
 * Keep server-safe: no React/browser APIs here.
 */

export const PLATFORM_META = Object.freeze({
  linkedin: {
    id: "linkedin",
    label: "LinkedIn",
    shortLabel: "LinkedIn",
    accent: "bg-blue-600",
    initials: "in",
    description:
      "Scrape leads, send invites, send messages, and publish jobs.",
    comingSoon: false,
  },
  rozee: {
    id: "rozee",
    label: "Rozee.pk",
    shortLabel: "Rozee",
    accent: "bg-emerald-600",
    initials: "RZ",
    description:
      "Post jobs, scrape applicants, and message candidates in Pakistan.",
    comingSoon: false,
  },
  indeed: {
    id: "indeed",
    label: "Indeed",
    shortLabel: "Indeed",
    accent: "bg-teal-700",
    initials: "Id",
    description: "Job posts and candidate sourcing on Indeed.",
    comingSoon: true,
  },
});

export const PLATFORM_ORDER = Object.freeze(["linkedin", "rozee", "indeed"]);

export const PLATFORM_LIST = Object.freeze(
  PLATFORM_ORDER.map((id) => PLATFORM_META[id])
);

export const AVAILABLE_PLATFORMS = Object.freeze(
  PLATFORM_LIST.filter((p) => !p.comingSoon)
);

export function getPlatformMeta(id) {
  return PLATFORM_META[id] || null;
}

export function isPlatformAvailable(id) {
  return Boolean(PLATFORM_META[id] && !PLATFORM_META[id].comingSoon);
}
