// AI interview question generation and validation (docs/ai-hiring/07-question-bank.md).
// Relative imports only — runs in the worker, API routes and the interview engine.
import { chatJSON, getModel } from "../ai/llm";
import {
  QUESTIONS_SYSTEM,
  QUESTIONS_SCHEMA_HINT,
  WARMUP_QUESTION,
  buildQuestionsUser,
  buildPersonalisedUser,
} from "../ai/prompts/questions";

export const CATEGORIES = ["technical", "role", "behavioral"];
export const DIFFICULTIES = ["easy", "medium", "hard"];
const MAX_QUESTION_WORDS = 40;
const MIN_KEYWORDS = 2;
const MAX_KEYWORDS = 8;
const GENERATION_ATTEMPTS = 3;

// Default weight by category when the model omits or garbles it
const DEFAULT_WEIGHT = { technical: 3, role: 2, behavioral: 2 };

export const WARMUP_FALLBACK = {
  question: WARMUP_QUESTION,
  category: "role",
  difficulty: "easy",
  idealAnswer:
    "A strong answer gives a concise, chronological summary of relevant education and experience. " +
    "It highlights two or three achievements that relate to this role. " +
    "It explains clearly why this role and team are a good next step, linking past work to the job's requirements.",
  expectedKeywords: ["experience", "achievements", "motivation", "role fit"],
  scoreWeight: 1,
  isWarmup: true,
};

/**
 * Question mix for a bank of `count` questions. For 8: 1 warm-up, 2 medium + 2 hard technical,
 * 1 role, 2 behavioral; other counts scale proportionally.
 */
export function questionMix(count, { includeWarmup = true } = {}) {
  const warmup = includeWarmup && count > 0 ? 1 : 0;
  const rest = Math.max(0, count - warmup);
  let behavioral = rest >= 2 ? Math.max(1, Math.round(count * 0.25)) : 0;
  let role = rest >= 4 ? Math.max(1, Math.round(count * 0.125)) : 0;
  let technical = rest - behavioral - role;
  if (technical < 1 && rest > 0) {
    // Always keep at least one technical question
    if (role > 0) role -= 1;
    else if (behavioral > 0) behavioral -= 1;
    technical = rest - behavioral - role;
  }
  const technicalMedium = Math.ceil(technical / 2);
  return { warmup, technicalMedium, technicalHard: technical - technicalMedium, role, behavioral };
}

export function mixTotal(mix) {
  return mix.warmup + mix.technicalMedium + mix.technicalHard + mix.role + mix.behavioral;
}

function normaliseText(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function wordCount(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

function isWarmupQuestion(q) {
  return normaliseText(q.question) === normaliseText(WARMUP_QUESTION) ||
    (q.category === "role" && q.difficulty === "easy" && /background/i.test(q.question));
}

/**
 * Clean one model-produced question. Returns null if it fails validation.
 */
export function normaliseQuestion(raw) {
  if (!raw || typeof raw !== "object") return null;
  const question = typeof raw.question === "string" ? raw.question.trim().replace(/\s+/g, " ") : "";
  const idealAnswer = typeof raw.idealAnswer === "string" ? raw.idealAnswer.trim() : "";
  const category = CATEGORIES.includes(raw.category) ? raw.category : "technical";
  const difficulty = DIFFICULTIES.includes(raw.difficulty) ? raw.difficulty : "medium";

  const seen = new Set();
  const expectedKeywords = (Array.isArray(raw.expectedKeywords) ? raw.expectedKeywords : [])
    .filter((k) => typeof k === "string" && k.trim())
    .map((k) => k.trim())
    .filter((k) => !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase()))
    .slice(0, MAX_KEYWORDS);

  if (!question || !idealAnswer || expectedKeywords.length < MIN_KEYWORDS) return null;
  if (wordCount(question) > MAX_QUESTION_WORDS) return null;

  const weight = Math.round(Number(raw.scoreWeight));
  const normalised = {
    question,
    category,
    difficulty,
    idealAnswer,
    expectedKeywords,
    scoreWeight: Number.isFinite(weight) ? Math.min(3, Math.max(1, weight)) : DEFAULT_WEIGHT[category],
  };
  normalised.isWarmup = isWarmupQuestion(normalised);
  if (normalised.isWarmup) normalised.scoreWeight = 1;
  return normalised;
}

const ORDER = (q) => (q.isWarmup ? 0 : { technical: 1, role: 2, behavioral: 3 }[q.category]);

/**
 * Validate, de-duplicate, order (warm-up, technical, role, behavioral) and cap a generated batch.
 * `existing` are question texts already in the bank; `needsWarmup` adds the standard warm-up
 * if the model left it out.
 */
export function validateGeneratedQuestions(rawList, { count, existing = [], needsWarmup = false }) {
  const seen = new Set(existing.map(normaliseText));
  const accepted = [];
  for (const raw of Array.isArray(rawList) ? rawList : []) {
    const q = normaliseQuestion(raw);
    if (!q) continue;
    const key = normaliseText(q.question);
    if (seen.has(key)) continue;
    if (q.isWarmup && (!needsWarmup || accepted.some((a) => a.isWarmup))) continue;
    seen.add(key);
    accepted.push(q);
  }
  if (needsWarmup && !accepted.some((q) => q.isWarmup) && !seen.has(normaliseText(WARMUP_QUESTION))) {
    accepted.push({ ...WARMUP_FALLBACK, expectedKeywords: [...WARMUP_FALLBACK.expectedKeywords] });
  }
  // Stable sort by section, then cap (warm-up survives the cap because it sorts first)
  return accepted
    .map((q, i) => ({ q, i }))
    .sort((a, b) => ORDER(a.q) - ORDER(b.q) || a.i - b.i)
    .map(({ q }) => q)
    .slice(0, count);
}

async function generateValidated({ system, user, count, existing, needsWarmup, llm, model }) {
  let best = [];
  for (let attempt = 1; attempt <= GENERATION_ATTEMPTS; attempt++) {
    const raw = await llm({ system, user, schemaHint: QUESTIONS_SCHEMA_HINT, model, temperature: 0.5, maxTokens: 3000 });
    const valid = validateGeneratedQuestions(raw?.questions, { count, existing, needsWarmup });
    if (valid.length > best.length) best = valid;
    if (valid.length >= count - 2) return valid;
  }
  if (best.length >= count - 2) return best;
  throw new Error(`Only ${best.length} of ${count} generated questions were valid`);
}

/**
 * Generate `count` job-wide questions. `existing` are the texts already in the bank; when it
 * already has a warm-up, no new warm-up is requested.
 */
export async function generateJobQuestions({ job, count = 8, existing = [] }, { llm = chatJSON } = {}) {
  const hasWarmup = existing.some((text) => normaliseText(text) === normaliseText(WARMUP_QUESTION));
  const mix = questionMix(count, { includeWarmup: !hasWarmup });
  return generateValidated({
    system: QUESTIONS_SYSTEM,
    user: buildQuestionsUser({ job, mix, existing }),
    count,
    existing,
    needsWarmup: mix.warmup > 0,
    llm,
    model: getModel(),
  });
}

/**
 * 1-2 questions targeting this candidate's screening gaps. Returns [] when there are no gaps.
 */
export async function generatePersonalisedQuestions({ job, candidate, count = 2, existing = [] }, { llm = chatJSON } = {}) {
  const analysis = candidate.fitAnalysis || {};
  const concerns = (analysis.concerns || []).filter((c) => c !== "Resume could not be read");
  const missingSkills = analysis.skillMatch?.missing || [];
  if (count < 1 || (!concerns.length && !missingSkills.length)) return [];

  const questions = await generateValidated({
    system: QUESTIONS_SYSTEM,
    user: buildPersonalisedUser({ job, concerns, missingSkills, count, existing }),
    count,
    existing,
    needsWarmup: false,
    llm,
    model: getModel(),
  });
  // Personalised questions probe gaps: never behavioral, never the warm-up
  return questions
    .filter((q) => !q.isWarmup)
    .map((q) => ({ ...q, category: q.category === "behavioral" ? "role" : q.category }));
}

/**
 * The question list for one candidate's interview: job-wide questions in order, with that
 * candidate's personalised questions slotted in after the technical block.
 */
export function buildCandidateQuestionList(jobQuestions, personalised = []) {
  const ordered = [...jobQuestions].sort((a, b) => a.orderIndex - b.orderIndex);
  const extra = [...personalised].sort((a, b) => a.orderIndex - b.orderIndex);
  if (!extra.length) return ordered;
  let insertAt = -1;
  ordered.forEach((q, i) => { if (q.category === "technical") insertAt = i; });
  if (insertAt === -1) {
    // No technical block: put them before the behavioral questions
    const firstBehavioral = ordered.findIndex((q) => q.category === "behavioral");
    insertAt = (firstBehavioral === -1 ? ordered.length : firstBehavioral) - 1;
  }
  return [...ordered.slice(0, insertAt + 1), ...extra, ...ordered.slice(insertAt + 1)];
}

/**
 * Frozen copy of the questions for interviews.question_snapshot. Later edits to the bank
 * don't affect an interview that has started.
 */
export function snapshotQuestions(questions) {
  return questions.map((q) => ({
    id: q.id,
    candidateId: q.candidateId ?? null,
    question: q.question,
    category: q.category,
    difficulty: q.difficulty,
    idealAnswer: q.idealAnswer,
    expectedKeywords: [...(q.expectedKeywords || [])],
    scoreWeight: q.scoreWeight,
  }));
}
