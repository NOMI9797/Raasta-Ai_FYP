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
  // indeed is detectable but not yet supported for leads — only LinkedIn and Rozee.
  return platform === "linkedin" || platform === "rozee";
}

export function filterUrlsByPlatform(urls, platforms) {
  const allowed = new Set(platforms || []);
  return (urls || [])
    .map((u) => (typeof u === "string" ? u.trim() : ""))
    .filter(Boolean)
    .map((url) => ({ url, platform: detectPlatformFromUrl(url) }))
    .filter(({ platform }) => platform && (allowed.size === 0 || allowed.has(platform)));
}
