// The "posting kit": everything a recruiter needs to post a job by hand on a platform, in the order its form asks for
// it. Raasta-AI sends it to the Raasta-AI Poster browser extension (extensions/raasta-poster), which shows it beside the
// platform's own form in the recruiter's own browser, where the recruiter signs in, passes any bot check as a normal
// visitor, reviews, and presses the platform's own Post button. Nothing here touches a platform. See docs/ai-hiring/19.
// Relative imports only (also used by the worker).
import { PLATFORM, getPlatformSpec } from "./platform-content";

export const KIT_VERSION = 1;
export const KIT_TTL_MS = 2 * 60 * 60 * 1000; // a kit is meant to be used now; the extension discards it after this
// Platforms posted to by hand with the extension. LinkedIn has its own working hand-off (a composer link with the text in it).
export const KIT_PLATFORMS = Object.freeze([PLATFORM.INDEED, PLATFORM.ROZEE]);

const MAX_VALUE_CHARS = 8000;
const MAX_TITLE_CHARS = 60;

const titleCase = (text) => String(text || "").trim().replace(/(^|\s)([a-z])/g, (_, lead, letter) => lead + letter.toUpperCase());
const clip = (text) => String(text || "").slice(0, MAX_VALUE_CHARS);

function list(value) {
  return Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : [];
}

// A bracketed aside, "(Node.js / React)" or "[Remote]", with the space before it
const BRACKETED = /\s*[([{][^)\]}]*[)\]}]/g;
// Symbols Indeed advises against in a title. Plus signs and hashes are not here: "C++" and "C#" are real titles
const SYMBOLS = /[%$@!*|~^<>{}=_\\]/g;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
const EDGE_PUNCTUATION = /^[\s/&,.:;-]+|[\s/&,.:;-]+$/g;

/**
 * The title as Indeed wants it. Indeed advises against symbols and extra detail in a title, and its post flow stops
 * to ask for a check when a title carries them, so bracketed asides and symbols are dropped ("Full Stack Developer
 * (Node.js / React)" becomes "Full Stack Developer"; the stack stays in the description). Never longer than
 * 60 characters, and never emptied: a title that would be left with almost nothing is returned as written.
 */
export function indeedTitle(title) {
  const original = String(title || "").trim();
  const cleaned = original
    .replace(BRACKETED, "")
    .replace(SYMBOLS, " ")
    .replace(EMOJI, " ")
    .replace(/\s+/g, " ")
    .replace(EDGE_PUNCTUATION, "");
  if (cleaned.length < 3) return original;
  if (cleaned.length <= MAX_TITLE_CHARS) return cleaned;
  const cut = cleaned.slice(0, MAX_TITLE_CHARS);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 20)).trim();
}

function salaryText(job) {
  if (!job.salaryMin && !job.salaryMax) return "";
  const currency = job.salaryCurrency || "USD";
  if (job.salaryMin && job.salaryMax) return `${currency} ${job.salaryMin} - ${job.salaryMax}`;
  return `${currency} ${job.salaryMin || job.salaryMax}`;
}

/**
 * Build the kit for one job and platform. `postText` is the saved post for that platform (what the AI wrote and the
 * recruiter edited). Empty fields are left out. Returns a plain JSON object.
 */
export function buildPostingKit({ job, platform, postText, applyUrl = "", entryUrl = "", now = new Date() }) {
  if (!KIT_PLATFORMS.includes(platform)) throw new Error(`No posting kit for "${platform}". Supported: ${KIT_PLATFORMS.join(", ")}`);
  const spec = getPlatformSpec(platform);
  const skills = [...new Set([...list(job.requiredSkills), ...list(job.techStack)])];
  const place = [job.location, job.locationType && titleCase(job.locationType)].filter(Boolean).join(" - ");

  const written = String(job.title || "").trim();
  const title = platform === PLATFORM.INDEED ? indeedTitle(written) : written;
  const fields = [
    { key: "title", label: "Job title", value: title },
    // When the platform's rules changed the title, the original stays available to copy
    { key: "titleAsWritten", label: "Title as written", value: title !== written ? written : "" },
    { key: "location", label: "Location", value: job.location },
    { key: "workplace", label: "Workplace type", value: job.locationType && titleCase(job.locationType) },
    { key: "employmentType", label: "Job type", value: job.employmentType && titleCase(job.employmentType) },
    { key: "experience", label: "Experience", value: job.experienceRange },
    { key: "salary", label: "Pay", value: salaryText(job) },
    { key: "salaryMin", label: "Pay: minimum", value: job.salaryMin && String(job.salaryMin) },
    { key: "salaryMax", label: "Pay: maximum", value: job.salaryMax && String(job.salaryMax) },
    { key: "currency", label: "Currency", value: (job.salaryMin || job.salaryMax) && (job.salaryCurrency || "USD") },
    { key: "skills", label: "Skills", value: skills.join(", ") },
    { key: "description", label: "Job description", value: postText },
    { key: "applyUrl", label: "Apply link", value: applyUrl },
  ]
    .map((field) => ({ ...field, value: clip(String(field.value || "").trim()) }))
    .filter((field) => field.value);

  return {
    version: KIT_VERSION,
    jobId: job.id,
    platform,
    platformLabel: spec.label,
    jobTitle: job.title,
    place,
    entryUrl: entryUrl || spec.composerUrl,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + KIT_TTL_MS).toISOString(),
    fields,
  };
}
