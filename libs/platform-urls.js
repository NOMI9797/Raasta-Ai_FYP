/**
 * URL helpers for deciding which platform a lead/candidate URL belongs to.
 * Kept as a tiny dependency-free module so it can be used from both server
 * routes and client components.
 */

const HOST_TO_PLATFORM = [
  { test: /(?:^|\.)linkedin\.com$/i, platform: "linkedin" },
  { test: /(?:^|\.)rozee\.pk$/i, platform: "rozee" },
  { test: /(?:^|\.)indeed\.com$/i, platform: "indeed" },
];

export function detectPlatformFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    // Fallback for strings without protocol — take a best-effort look.
    const lower = url.toLowerCase();
    if (lower.includes("linkedin.com")) return "linkedin";
    if (lower.includes("rozee.pk")) return "rozee";
    if (lower.includes("indeed.com")) return "indeed";
    return null;
  }
  const host = parsed.hostname;
  for (const { test, platform } of HOST_TO_PLATFORM) {
    if (test.test(host)) return platform;
  }
  return null;
}

export function isSupportedLeadUrl(url) {
  const platform = detectPlatformFromUrl(url);
  return platform === "linkedin" || platform === "rozee" || platform === "indeed";
}

export function filterUrlsByPlatform(urls, platforms) {
  const allowed = new Set(platforms || []);
  return (urls || [])
    .map((u) => (typeof u === "string" ? u.trim() : ""))
    .filter(Boolean)
    .map((url) => ({ url, platform: detectPlatformFromUrl(url) }))
    .filter(({ platform }) => platform && (allowed.size === 0 || allowed.has(platform)));
}

/** Rozee public job posting URLs (slug …-jobs-{id}) vs seeker profile URLs. */
export function isRozeeJobPostingUrl(url) {
  if (!url || typeof url !== "string") return false;
  const lower = url.toLowerCase();
  if (!lower.includes("rozee.pk")) return false;
  if (/-jobs-\d+/.test(lower)) return true;
  if (/\/job\/[^/]+/.test(lower) && !lower.includes("/job/jsearch")) return true;
  return false;
}
