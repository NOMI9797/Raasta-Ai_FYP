// What each job platform expects from a post, the model prompt for it, and a clean-up pass that enforces
// those rules whatever the model returns. Relative imports only (also used by the worker).
import { chatText, getFastModel } from "../ai/llm";

export const PLATFORM = Object.freeze({ LINKEDIN: "linkedin", ROZEE: "rozee", INDEED: "indeed" });
export const POST_PLATFORMS = Object.freeze([PLATFORM.LINKEDIN, PLATFORM.ROZEE, PLATFORM.INDEED]);

// Limits are conservative: a post that stays inside them is accepted by the platform's own form.
export const PLATFORM_SPECS = Object.freeze({
  [PLATFORM.LINKEDIN]: {
    id: PLATFORM.LINKEDIN,
    label: "LinkedIn",
    field: "linkedinPost", // jobs column holding the saved text
    maxChars: 3000, // LinkedIn's post limit
    words: [130, 220],
    maxHashtags: 5,
    allowEmoji: true,
    composerUrl: "https://www.linkedin.com/feed/",
    summary: "Feed post: a hook in the first two lines, short paragraphs, 3-5 hashtags at the end.",
  },
  [PLATFORM.ROZEE]: {
    id: PLATFORM.ROZEE,
    label: "Rozee.pk",
    field: "rozeePost",
    maxChars: 4000,
    words: [180, 350],
    maxHashtags: 0,
    allowEmoji: false,
    composerUrl: "https://www.rozeegpt.ai/employer/dashboard", // a signed-in employer's dashboard, where "Post A New Job" starts the wizard (the old www.rozee.pk/employer/job/post form no longer exists; hiring.rozee.pk/login signs in)
    summary: "Job ad: plain structured sections (role, responsibilities, requirements, how to apply). No emojis or hashtags.",
  },
  [PLATFORM.INDEED]: {
    id: PLATFORM.INDEED,
    label: "Indeed",
    field: "indeedPost",
    maxChars: 4000,
    words: [180, 380],
    maxHashtags: 0,
    allowEmoji: false,
    composerUrl: "https://employers.indeed.com/jobs", // the employer dashboard (it asks you to sign in first), where Post a job starts
    summary: "Job description: the title, location and type in the first lines (what search results show), then plain sections. No emojis or hashtags.",
  },
});

export function getPlatformSpec(platform) {
  const spec = PLATFORM_SPECS[platform];
  if (!spec) throw new Error(`Unknown platform "${platform}". Supported: ${POST_PLATFORMS.join(", ")}`);
  return spec;
}

const TONES = {
  professional: "professional and clear",
  casual: "friendly and conversational",
  enthusiastic: "energetic and welcoming",
  formal: "formal and precise",
};

function jobFacts(job) {
  const list = (value) => (Array.isArray(value) ? value.filter(Boolean).join(", ") : "") || "not specified";
  const salary = job.salaryMin || job.salaryMax
    ? `${job.salaryCurrency || "USD"} ${job.salaryMin || "?"} - ${job.salaryMax || "?"}`
    : "not disclosed";
  return [
    `Job title: ${job.title}`,
    `Required skills: ${list(job.requiredSkills)}`,
    `Tech stack: ${list(job.techStack)}`,
    `Experience: ${job.experienceRange || "not specified"}`,
    `Location: ${job.location || "not specified"} (${job.locationType || "not specified"})`,
    `Employment type: ${job.employmentType || "full-time"}`,
    `Salary: ${salary}`,
  ].join("\n");
}

const SHARED_RULES = [
  "Use only the facts you are given. Never invent a company name, salary, perks, team size or requirements.",
  "Write the salary exactly as given (currency and range). Do not add a pay period such as per month unless one is stated.",
  "Plain text only: no markdown, no asterisks, no headings with # signs.",
  "Return ONLY the post text, nothing before or after it.",
];

/**
 * { system, user } for one platform. The facts come from the job row; `applyUrl` is where candidates apply.
 */
export function buildPostPrompt(platform, job, { tone = "professional", applyUrl = "" } = {}) {
  const spec = getPlatformSpec(platform);
  const voice = TONES[tone] || TONES.professional;
  const apply = applyUrl ? `Apply link (must appear once, written out in full): ${applyUrl}` : "No apply link was provided.";

  let system;
  if (platform === PLATFORM.INDEED) {
    system = [
      "You write job descriptions for Indeed, where job seekers search by job title and location.",
      `Tone: ${voice}.`,
      `Length: ${spec.words[0]}-${spec.words[1]} words, at most ${spec.maxChars} characters.`,
      "The first two sentences are what search results show, so they must name the job title, the location and the employment type.",
      "Then use these plain-text section titles, each on its own line followed by a short list with lines starting with a dash:",
      "About the role, Responsibilities, Requirements, What we offer (only if facts are given), How to apply.",
      "No emojis, no hashtags, no hype. State the salary range when given.",
      "The How to apply section contains the apply link.",
      ...SHARED_RULES,
    ].join("\n");
  } else if (platform === PLATFORM.LINKEDIN) {
    system = [
      "You write LinkedIn job posts for a recruiter's own feed.",
      `Tone: ${voice}.`,
      `Length: ${spec.words[0]}-${spec.words[1]} words, at most ${spec.maxChars} characters.`,
      "The first two lines are all a reader sees before the see-more fold, so open with a hook about the role, not a plain announcement that we are hiring.",
      "Then: what the person will work on, the must-have skills, practical details (location, type, salary only if given).",
      "Short paragraphs or lines starting with a dash. At most three emojis in total.",
      "Close with a clear call to action containing the apply link, then 3-5 relevant hashtags on the last line.",
      ...SHARED_RULES,
    ].join("\n");
  } else {
    system = [
      "You write job advertisements for the Rozee.pk job board, read by job seekers in Pakistan.",
      `Tone: ${voice}.`,
      `Length: ${spec.words[0]}-${spec.words[1]} words, at most ${spec.maxChars} characters.`,
      "Structure with these plain-text section titles, each on its own line followed by a short list with lines starting with a dash:",
      "About the role, Responsibilities, Requirements, What we offer (only if facts are given), How to apply.",
      "No emojis, no hashtags, no hype. State the location, employment type and salary range when given.",
      "The How to apply section contains the apply link.",
      ...SHARED_RULES,
    ].join("\n");
  }

  return { system, user: `Write the post for this role.\n\n${jobFacts(job)}\n${apply}` };
}

const HASHTAG = /(^|\s)#[\p{L}\p{N}_]+/gu;
const EMOJI = /[\p{Extended_Pictographic}\uFE0F\u200D]/gu;

function stripMarkdown(text) {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`+/g, "")
    .replace(/^\s*[*\u2022]\s+/gm, "- ");
}

// Keeps at most `max` hashtags (the first ones) and tidies the blank lines that leaves behind
function limitHashtags(text, max) {
  let seen = 0;
  const lines = text.split("\n").map((line) =>
    line.replace(HASHTAG, (match, lead) => (++seen <= max ? match : lead)).replace(/[ \t]+$/g, "")
  );
  return lines.filter((line, i) => line !== "" || lines[i - 1] !== "").join("\n").trim();
}

function cutToLimit(text, max) {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const paragraphEnd = slice.lastIndexOf("\n\n");
  const lineEnd = slice.lastIndexOf("\n");
  const at = paragraphEnd > max * 0.6 ? paragraphEnd : lineEnd > max * 0.6 ? lineEnd : slice.lastIndexOf(" ");
  return slice.slice(0, at > 0 ? at : max).trimEnd();
}

/**
 * Enforce a platform's rules on model output: no markdown, hashtag and emoji rules, the apply link present,
 * length inside the limit. Returns { text, warnings } where warnings say what was changed.
 */
export function finalizePost(platform, raw, { applyUrl = "" } = {}) {
  const spec = getPlatformSpec(platform);
  const warnings = [];
  let text = String(raw || "").replace(/\r\n/g, "\n").trim();
  text = stripMarkdown(text).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  if (!spec.allowEmoji && new RegExp(EMOJI.source, "u").test(text)) {
    text = text.replace(EMOJI, "").replace(/[ \t]{2,}/g, " ");
    warnings.push("Emojis removed (not used on this platform)");
  }

  const hashtags = text.match(HASHTAG) || [];
  if (hashtags.length > spec.maxHashtags) {
    text = limitHashtags(text, spec.maxHashtags);
    warnings.push(spec.maxHashtags ? `Hashtags limited to ${spec.maxHashtags}` : "Hashtags removed (not used on this platform)");
  }

  if (applyUrl && !text.includes(applyUrl)) {
    const line = platform === PLATFORM.LINKEDIN ? `Apply here: ${applyUrl}` : `How to apply: ${applyUrl}`;
    const lines = text.split("\n");
    const last = lines[lines.length - 1] || "";
    const tagsOnly = spec.maxHashtags > 0 && last.trim() !== "" && last.replace(HASHTAG, "").trim() === "";
    if (tagsOnly) lines.splice(lines.length - 1, 0, line, ""); // keep the hashtags last
    else lines.push("", line);
    text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    warnings.push("Apply link added");
  }

  if (text.length > spec.maxChars) {
    text = cutToLimit(text, spec.maxChars);
    warnings.push(`Shortened to fit ${spec.maxChars} characters`);
  }
  return { text, warnings };
}

/**
 * Problems that stop a saved post being published as it is. Empty array = fine.
 */
export function validatePost(platform, text) {
  const spec = getPlatformSpec(platform);
  const body = String(text || "").trim();
  const problems = [];
  if (!body) problems.push(`There is no ${spec.label} post yet. Generate or write one first.`);
  else if (body.length > spec.maxChars) problems.push(`The ${spec.label} post is ${body.length} characters; the limit is ${spec.maxChars}.`);
  return problems;
}

// Less than this is not a post (a model that ran out of budget while thinking returns nothing at all)
const MIN_POST_CHARS = 40;

/**
 * Write the post for one platform with the model, then enforce its rules. Asks once more when the model returns
 * (almost) nothing, and throws rather than hand back a post that is only the apply link.
 * `chat` is injectable for tests.
 */
export async function generatePlatformPost({ job, platform, tone, applyUrl, chat = chatText }) {
  const { system, user } = buildPostPrompt(platform, job, { tone, applyUrl });
  const ask = () => chat({ system, user, model: getFastModel(), temperature: 0.7, maxTokens: 2000 });
  let raw = await ask();
  if (String(raw || "").trim().length < MIN_POST_CHARS) raw = await ask();
  if (String(raw || "").trim().length < MIN_POST_CHARS) {
    throw new Error(`The AI did not return a ${getPlatformSpec(platform).label} post. Try again in a moment.`);
  }
  return finalizePost(platform, raw, { applyUrl });
}

// LinkedIn opens its composer with the text filled in; the person still presses Post themselves.
export function composerHandoffUrl(platform, text) {
  const spec = getPlatformSpec(platform);
  if (platform === PLATFORM.LINKEDIN && text) {
    return `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`;
  }
  return spec.composerUrl;
}

/** Public apply link for a job. The configured app URL wins; the request origin is only the fallback for local use. */
export function jobApplyUrl(jobId, fallbackOrigin = "") {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || fallbackOrigin || "http://localhost:8085";
  return `${base.replace(/\/$/, "")}/apply/${jobId}`;
}
