// Stage-1 AI resume screening (docs/ai-hiring/06-stage1-screening.md §2).
// Relative imports only — runs in the worker and in the agent pipeline.
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { candidates, jobs } from "../schema";
import { chatJSON, getModel } from "../ai/llm";
import { FIT_SYSTEM, FIT_SCHEMA_HINT, buildFitUser } from "../ai/prompts/fit";
import { CANDIDATE_STATUS } from "./statuses";

export const FIT_VERSION = 1;
const LLM_ATTEMPTS = 3; // first try + 2 retries
const MAX_LIST_ITEMS = 5;
const MIN_RESUME_TEXT_CHARS = 30;

// Each group lists spellings of the same skill; the first entry is the canonical form
const SKILL_SYNONYMS = [
  ["javascript", "js"],
  ["typescript", "ts"],
  ["node.js", "node", "nodejs"],
  ["postgresql", "postgres"],
  ["kubernetes", "k8s"],
  ["aws", "amazon web services"],
  ["ci/cd", "cicd", "ci cd", "continuous integration"],
  ["react", "react.js", "reactjs"],
  ["vue", "vue.js", "vuejs"],
  ["gcp", "google cloud"],
];

const SYNONYM_INDEX = new Map();
for (const group of SKILL_SYNONYMS) for (const name of group) SYNONYM_INDEX.set(name, group);

function normalise(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

export function skillVariants(skill) {
  const key = normalise(skill);
  return SYNONYM_INDEX.get(key) || [key];
}

/**
 * True if the skill (or a synonym) appears as a whole term in the text.
 */
export function skillAppearsIn(skill, text) {
  const haystack = normalise(text);
  return skillVariants(skill).some((variant) =>
    variant && new RegExp(`(^|[^a-z0-9])${escapeRegExp(variant)}([^a-z0-9]|$)`).test(haystack)
  );
}

// Everything in the resume a skill claim can be checked against
function evidenceText(parsed) {
  const parts = [parsed._resumeText || ""];
  const add = (value) => {
    if (Array.isArray(value)) value.forEach(add);
    else if (value && typeof value === "object") Object.values(value).forEach(add);
    else if (typeof value === "string") parts.push(value);
  };
  add(parsed.skills);
  add(parsed.skillsByCategory);
  add(parsed.jobTitles);
  add(parsed.experience);
  add(parsed.projects);
  return parts.join("\n");
}

function hasReadableResume(parsed) {
  const text = typeof parsed._resumeText === "string" ? parsed._resumeText.trim() : "";
  return text.length > MIN_RESUME_TEXT_CHARS || (Array.isArray(parsed.skills) && parsed.skills.length > 0);
}

/**
 * Replace the candidate's name in model output with "the candidate".
 */
export function scrubName(text, name) {
  if (typeof text !== "string" || !name) return text;
  let result = text;
  const tokens = [String(name).trim(), ...String(name).split(/\s+/)].filter((t) => t.length >= 3);
  for (const token of tokens) {
    result = result.replace(new RegExp(`(^|[^\\p{L}])${escapeRegExp(token)}(?=[^\\p{L}]|$)`, "giu"), "$1the candidate");
  }
  // Capitalise where the replacement starts a sentence
  return result.replace(/(^|[.!?]\s+)the candidate/g, "$1The candidate");
}

function stringList(value, scrub, max = MAX_LIST_ITEMS) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => scrub(item.trim()))
    .slice(0, max);
}

function oneOf(value, allowed) {
  return allowed.includes(value) ? value : "unknown";
}

function unreadableResult(job) {
  return {
    fitScore: 0,
    skillMatch: { matched: [], missing: [...(job.requiredSkills || [])], extra: [] },
    experienceMatch: { required: job.experienceRange || null, candidateYears: null, verdict: "unknown" },
    educationMatch: { verdict: "unknown", note: "" },
    strengths: [],
    concerns: ["Resume could not be read"],
    rationale: "The resume could not be read, so it was not scored. Review it manually.",
    manualReview: true,
    model: null,
    version: FIT_VERSION,
  };
}

/**
 * Deterministic clean-up of the LLM's answer (doc 06 §2 post-processing).
 */
export function postProcessFit(raw, { job, candidate, model = getModel() }) {
  const parsed = candidate.parsedData || {};
  // The form name and the parsed resume name can differ; remove both
  const scrub = (text) => scrubName(scrubName(text, candidate.name), parsed.name);
  const evidence = evidenceText(parsed);
  const required = Array.isArray(job.requiredSkills) ? job.requiredSkills : [];
  const llmMatched = Array.isArray(raw?.skillMatch?.matched) ? raw.skillMatch.matched : [];

  // Matched skills are recomputed from the resume itself, synonym-aware
  const matched = required.filter((skill) => skillAppearsIn(skill, evidence));
  const missing = required.filter((skill) => !matched.includes(skill));
  // LLM claims with no support in the resume are reported, not trusted
  const unverified = llmMatched.filter(
    (claim) => typeof claim === "string" && !skillAppearsIn(claim, evidence)
  );
  const requiredKeys = new Set(required.flatMap(skillVariants));
  const extra = (Array.isArray(raw?.skillMatch?.extra) ? raw.skillMatch.extra : [])
    .filter((skill) => typeof skill === "string" && skillAppearsIn(skill, evidence))
    .filter((skill) => !skillVariants(skill).some((v) => requiredKeys.has(v)))
    .slice(0, 10);

  const score = Math.round(Number(raw?.fitScore));
  const llmYears = Number(raw?.experienceMatch?.candidateYears);
  const parsedYears = Number(parsed.yearsExperience);

  return {
    fitScore: Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 0,
    skillMatch: { matched, missing, extra, ...(unverified.length ? { unverified } : {}) },
    experienceMatch: {
      required: job.experienceRange || null,
      candidateYears: Number.isFinite(llmYears) ? llmYears : Number.isFinite(parsedYears) ? parsedYears : null,
      verdict: oneOf(raw?.experienceMatch?.verdict, ["meets", "below", "above"]),
    },
    educationMatch: {
      verdict: oneOf(raw?.educationMatch?.verdict, ["relevant", "partially_relevant", "not_relevant"]),
      note: typeof raw?.educationMatch?.note === "string" ? scrub(raw.educationMatch.note) : "",
    },
    strengths: stringList(raw?.strengths, scrub),
    concerns: stringList(raw?.concerns, scrub),
    rationale: typeof raw?.rationale === "string" ? scrub(raw.rationale.trim()).slice(0, 800) : "",
    model,
    version: FIT_VERSION,
  };
}

/**
 * Score one candidate against one job. Retries the LLM twice; rate limits are
 * rethrown immediately so the worker can back off. Throws LlmError on failure.
 */
export async function scoreCandidateFit({ job, candidate }, { llm = chatJSON, sleep } = {}) {
  const parsed = candidate.parsedData || {};
  // A failed apply-time LLM parse still leaves readable text, which can be scored
  if (!hasReadableResume(parsed)) return unreadableResult(job);

  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const model = getModel();
  let lastError;
  for (let attempt = 1; attempt <= LLM_ATTEMPTS; attempt++) {
    try {
      const raw = await llm({
        system: FIT_SYSTEM,
        user: buildFitUser({ job, candidate }),
        schemaHint: FIT_SCHEMA_HINT,
        model,
        temperature: 0.1,
        maxTokens: 1200,
      });
      return postProcessFit(raw, { job, candidate, model });
    } catch (error) {
      lastError = error;
      if (error?.code === "rate_limit" || attempt === LLM_ATTEMPTS) break;
      await wait(1000 * attempt);
    }
  }
  throw lastError;
}

/**
 * Load, score and save one candidate. New candidates move to "screened"; candidates
 * further along keep their status. On failure fit_analysis.error is recorded and the
 * error rethrown. Returns { candidateId, jobId, fitScore }.
 */
export async function screenCandidate(candidateId, { database = db, scorer = scoreCandidateFit } = {}) {
  const [candidate] = await database.select().from(candidates).where(eq(candidates.id, candidateId)).limit(1);
  if (!candidate) return { candidateId, skipped: "candidate not found" };

  const [job] = await database.select().from(jobs).where(eq(jobs.id, candidate.jobId)).limit(1);
  if (!job) return { candidateId, skipped: "job not found" };

  let result;
  try {
    result = await scorer({ job, candidate });
  } catch (error) {
    await database
      .update(candidates)
      .set({
        fitAnalysis: {
          ...(candidate.fitAnalysis || {}),
          error: error?.code === "rate_limit" ? "Rate limited – will retry" : "Screening failed",
          failedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(candidates.id, candidateId));
    throw error;
  }

  const now = new Date();
  await database
    .update(candidates)
    .set({
      fitScore: result.fitScore,
      fitAnalysis: result,
      screenedAt: now,
      status: sql`case when ${candidates.status} = ${CANDIDATE_STATUS.NEW} then ${CANDIDATE_STATUS.SCREENED} else ${candidates.status} end`,
      updatedAt: now,
    })
    .where(eq(candidates.id, candidateId));

  return { candidateId, jobId: job.id, fitScore: result.fitScore };
}
