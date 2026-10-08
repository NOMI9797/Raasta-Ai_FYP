// Scores an answer 0-100 against the question's ideal answer (docs/ai-hiring/04-source-port-map.md, "Scorer rubric").
// Ported rubric; JSON mode instead of tool calling. On LLM failure the keyword fallback score is
// returned and kept (the original computed it but then discarded it).
// Relative imports only — runs in the interview engine.
import { chatJSON, getModel } from "../ai/llm";
import { SCORER_SYSTEM, buildScorerUser } from "../ai/prompts/interview";
import { countWords } from "./answer-analyzer";

function keywordSplit(answer, keywords) {
  const lower = answer.toLowerCase();
  const covered = keywords.filter((k) => lower.includes(String(k).toLowerCase()));
  return { covered, missed: keywords.filter((k) => !covered.includes(k)) };
}

/**
 * 0.7 × keyword coverage + 0.3 × min(100, words / 30 × 100). 50% coverage is assumed without keywords.
 */
export function fallbackScore(answer, question) {
  const keywords = question.expectedKeywords || [];
  const { covered, missed } = keywordSplit(answer, keywords);
  const keywordScore = keywords.length ? (covered.length / keywords.length) * 100 : 50;
  const lengthScore = Math.min(100, (countWords(answer) / 30) * 100);
  return {
    score: Math.round(keywordScore * 0.7 + lengthScore * 0.3),
    reasoning: `Fallback scoring: ${covered.length}/${keywords.length} keywords covered.`,
    keywordsCovered: covered,
    keywordsMissed: missed,
    fallback: true,
  };
}

/**
 * Returns { score, reasoning, keywordsCovered, keywordsMissed, fallback } or null when the question
 * has no ideal answer (nothing to score against).
 */
export async function scoreAnswer(answer, question, { llm = chatJSON } = {}) {
  if (!question?.idealAnswer) return null;
  if (!answer || !answer.trim()) {
    return { score: 0, reasoning: "No answer provided", keywordsCovered: [], keywordsMissed: question.expectedKeywords || [], fallback: false };
  }
  try {
    const result = await llm({
      system: SCORER_SYSTEM,
      user: buildScorerUser({ question, answer }),
      model: getModel(),
      temperature: 0.3,
      maxTokens: 1500, // the model's own reasoning counts against this; 500 left empty replies and keyword-only scores
    });
    const score = Math.round(Number(result?.score));
    if (!Number.isFinite(score)) throw new Error("score missing");
    const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
    return {
      score: Math.min(100, Math.max(0, score)),
      reasoning: typeof result.reasoning === "string" ? result.reasoning.slice(0, 1000) : "",
      keywordsCovered: strings(result.keywordsCovered),
      keywordsMissed: strings(result.keywordsMissed),
      fallback: false,
    };
  } catch {
    return fallbackScore(answer, question);
  }
}
