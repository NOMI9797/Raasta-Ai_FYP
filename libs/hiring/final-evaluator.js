// Stage 2: communication score, final score and suggested decision (docs/ai-hiring/11-stage2-evaluation.md).
// Every formula here is deterministic and unit-tested (tests/hiring/final-evaluator.test.js).
// Relative imports only — runs in the hiring worker.
import { CANDIDATE_STATUS } from "./statuses";

export const NEEDS_REVIEW = "needs_review";
export const RECOMMENDATIONS = ["strong_yes", "yes", "maybe", "no"];

// Communication components and their weights (11 §1.6)
export const COMMUNICATION_WEIGHTS = { pace: 0.3, fluency: 0.3, eyeContact: 0.25, composure: 0.15 };
// Emotion labels that count as composed. "calm" is the speech-emotion model's near-neutral class.
export const COMPOSED_LABELS = ["neutral", "happy", "calm"];

const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const isNum = (value) => typeof value === "number" && Number.isFinite(value);
const round1 = (value) => Math.round(value * 10) / 10;

/** Pace: 100 at 110–160 wpm, linear down to 0 at < 70 or > 210. */
export function paceScore(wpm) {
  if (!isNum(wpm)) return null;
  if (wpm >= 110 && wpm <= 160) return 100;
  if (wpm < 110) return clamp(((wpm - 70) / 40) * 100);
  return clamp(((210 - wpm) / 50) * 100);
}

/**
 * Fluency: 100 − min(100, fillerPerMin × 12) × 0.6 − min(100, pauseRatio × 200) × 0.4.
 * Without a transcript (fillerPerMin null) only the pause part is used, scaled to the full range.
 */
export function fluencyScore({ fillerPerMin, pauseRatio } = {}) {
  const fillerPenalty = isNum(fillerPerMin) ? Math.min(100, fillerPerMin * 12) : null;
  const pausePenalty = isNum(pauseRatio) ? Math.min(100, pauseRatio * 200) : null;
  if (fillerPenalty === null && pausePenalty === null) return null;
  if (fillerPenalty === null) return clamp(100 - pausePenalty);
  if (pausePenalty === null) return clamp(100 - fillerPenalty);
  return clamp(100 - fillerPenalty * 0.6 - pausePenalty * 0.4);
}

/** Composure: 100 × (share of composed emotions), capped at 100. */
export function composureScore(emotion) {
  const distribution = emotion?.distribution;
  if (!distribution || typeof distribution !== "object" || !Object.keys(distribution).length) return null;
  const share = Object.entries(distribution)
    .filter(([label]) => COMPOSED_LABELS.includes(String(label).toLowerCase()))
    .reduce((sum, [, p]) => sum + (isNum(p) ? p : 0), 0);
  return clamp(share * 100);
}

/**
 * Weighted average of the parts that are present; missing (null) parts are dropped and the
 * remaining weights renormalised. Returns { score, weights } — score null when nothing is present.
 */
export function weightedAverage(parts, weights) {
  const present = Object.keys(weights).filter((k) => isNum(parts[k]) && weights[k] > 0);
  const total = present.reduce((sum, k) => sum + weights[k], 0);
  if (!present.length || total <= 0) return { score: null, weights: {} };
  const used = Object.fromEntries(present.map((k) => [k, round1((weights[k] / total) * 100) / 100]));
  const score = present.reduce((sum, k) => sum + parts[k] * (weights[k] / total), 0);
  return { score: Math.round(clamp(score)), weights: used };
}

/**
 * Communication score (0–100) from interviews.analysis. Returns { score, components, weights }.
 */
export function communicationScore(analysis) {
  const components = {
    pace: paceScore(analysis?.voice?.wpm),
    fluency: fluencyScore(analysis?.voice || {}),
    eyeContact: isNum(analysis?.gaze?.eyeContactScore) ? clamp(analysis.gaze.eyeContactScore) : null,
    composure: composureScore(analysis?.emotion),
  };
  const rounded = Object.fromEntries(Object.entries(components).map(([k, v]) => [k, v === null ? null : Math.round(v)]));
  const { score, weights } = weightedAverage(components, COMMUNICATION_WEIGHTS);
  return { score, components: rounded, weights };
}

/**
 * finalScore = w.resume × fitScore + w.interview × interviewScore + w.communication × communicationScore,
 * null parts dropped and weights renormalised. Returns { score, breakdown }.
 */
export function finalScore({ fitScore, interviewScore, communicationScore: comm }, finalWeights) {
  const parts = { resume: fitScore ?? null, interview: interviewScore ?? null, communication: comm ?? null };
  const { score, weights } = weightedAverage(parts, finalWeights);
  return { score, breakdown: { ...parts, weights } };
}

/**
 * Suggested decision: final_shortlisted when score ≥ threshold, else final_rejected.
 * needs_review when fewer than half the questions were answered or there is no score.
 */
export function suggestDecision({ score, threshold, totalAnswers, totalQuestions }) {
  if (isNum(totalQuestions) && totalQuestions > 0 && (totalAnswers ?? 0) < totalQuestions * 0.5) return NEEDS_REVIEW;
  if (!isNum(score)) return NEEDS_REVIEW;
  return score >= threshold ? CANDIDATE_STATUS.FINAL_SHORTLISTED : CANDIDATE_STATUS.FINAL_REJECTED;
}

/** Recommendation when the LLM gives none (or fails), from the final score. */
export function recommendationFromScore(score, threshold) {
  if (!isNum(score)) return "maybe";
  if (score >= Math.max(threshold + 15, 85)) return "strong_yes";
  if (score >= threshold) return "yes";
  if (score >= threshold - 15) return "maybe";
  return "no";
}

function strings(value, max = 5, maxLength = 300) {
  return (Array.isArray(value) ? value : [])
    .filter((v) => typeof v === "string" && v.trim())
    .slice(0, max)
    .map((v) => v.trim().slice(0, maxLength));
}

/** Validate the LLM summary; anything missing falls back to deterministic values. */
export function normaliseSummary(raw, { score, threshold }) {
  const recommendation = RECOMMENDATIONS.includes(raw?.recommendation) ? raw.recommendation : recommendationFromScore(score, threshold);
  const summary = typeof raw?.summary === "string" && raw.summary.trim() ? raw.summary.trim().slice(0, 1500) : null;
  return {
    recommendation,
    summary,
    strengths: strings(raw?.strengths),
    risks: strings(raw?.risks),
    suggestedNextSteps: strings(raw?.suggestedNextSteps, 3),
  };
}

/**
 * Plain summary used when the LLM is unavailable. Only facts already computed; no scores of
 * individual answers, no personal details.
 */
export function fallbackSummary({ score, threshold, breakdown, fitAnalysis, answered, totalQuestions, topAnswers = [], weakAnswers = [] }) {
  const parts = [];
  parts.push(score === null
    ? "Not enough data to compute a final score; review the interview manually."
    : `The candidate's final score is ${score} (threshold ${threshold}).`);
  if (breakdown?.resume != null) parts.push(`Resume fit ${breakdown.resume}.`);
  if (breakdown?.interview != null) parts.push(`Interview answers scored ${breakdown.interview} on average.`);
  if (breakdown?.communication != null) parts.push(`Communication ${breakdown.communication}.`);
  parts.push(`${answered} of ${totalQuestions} questions were answered.`);
  return {
    recommendation: recommendationFromScore(score, threshold),
    summary: parts.join(" "),
    strengths: [
      ...strings(fitAnalysis?.strengths, 3),
      ...topAnswers.slice(0, 2).map((a) => `Strong answer on: ${a.questionText}`),
    ].slice(0, 5),
    risks: [
      ...strings(fitAnalysis?.concerns, 3),
      ...weakAnswers.slice(0, 2).map((a) => `Weak answer on: ${a.questionText}`),
    ].slice(0, 5),
    suggestedNextSteps: [],
    fallback: true,
  };
}
