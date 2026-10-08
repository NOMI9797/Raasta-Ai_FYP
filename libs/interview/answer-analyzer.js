// Decides whether an answer deserves a follow-up (docs/ai-hiring/04-source-port-map.md, "Answer analyzer").
// Ported from the earlier interview engine: seven conditions, primary reason = first in order.
// The three LLM checks (new topic, contradiction, deep experience) are merged into one JSON call;
// when it fails, the original fallbacks apply (keyword heuristics; contradiction = false).
// Relative imports only — runs in the interview engine.
import { chatJSON, getFastModel } from "../ai/llm";
import { ANALYZER_SYSTEM, buildAnalyzerUser } from "../ai/prompts/interview";

export const REASON_MESSAGES = {
  answer_incomplete: (a) => `Answer is too short (${a.wordCount} words) or lacks detail. Completeness score: ${Math.round(a.completenessScore)}%`,
  new_topic_opened: () => "Answer opens an interesting new topic worth exploring",
  skill_avoided: () => "Expected keywords/skills not adequately covered in answer",
  contradiction: () => "Answer contains contradictions or questionable statements",
  deep_experience: () => "Answer shows deep experience worth exploring further",
  natural_cues: () => "Candidate signaled willingness to provide more details",
  multi_step_required: () => "Question type requires multiple probing steps (e.g., behavioral/STAR method)",
};

export function countWords(text) {
  return String(text || "").split(/\s+/).filter((w) => w.length > 0).length;
}

// Condition 1a: structure-aware completeness
export function checkAnswerCompleteness(answer, wordCount, question) {
  if (wordCount < 15) return false;
  const hasWhy = /\b(why|because|reason|since|as)\b/i.test(answer);
  const hasHow = /\b(how|method|process|steps|approach|way)\b/i.test(answer);
  const questionText = question?.question || "";
  if (/\bhow\b/i.test(questionText) && !hasHow && wordCount < 25) return false;
  if (/\bwhy\b/i.test(questionText) && !hasWhy && wordCount < 20) return false;
  return wordCount >= 20;
}

// Condition 1b: 0-100, length plus structure bonuses
export function calculateCompletenessScore(answer) {
  const wordCount = countWords(answer);
  let score = Math.min(100, (wordCount / 30) * 100);
  if (/\b(because|since|as|due to|reason|explain)\b/i.test(answer)) score += 10;
  if (/\b(example|instance|case|like|such as)\b/i.test(answer)) score += 10;
  if (/\b(details|specific|precisely|exactly)\b/i.test(answer)) score += 10;
  return Math.min(100, score);
}

// Condition 2 fallback
export function fallbackNewTopic(answer, question) {
  const questionText = (question?.question || "").toLowerCase();
  const lower = answer.toLowerCase();
  const techTerms = ["framework", "library", "tool", "technology", "system", "architecture", "pattern", "methodology"];
  return techTerms.some((term) => lower.includes(term) && !questionText.includes(term));
}

// Condition 3: at least half of the expected keywords mentioned
export function checkSkillCoverage(answer, question) {
  const keywords = question?.expectedKeywords || [];
  if (keywords.length === 0) return true;
  const lower = answer.toLowerCase();
  const mentioned = keywords.filter((k) => lower.includes(String(k).toLowerCase()));
  return mentioned.length >= Math.ceil(keywords.length * 0.5);
}

// Condition 5 fallback
export function fallbackDeepExperience(answer) {
  const indicators = [
    "architect", "optimization", "scalability", "distributed", "microservices",
    "algorithm", "complexity", "design pattern", "best practice", "performance",
    "integration", "implementation", "architecture", "infrastructure", "deployment",
  ];
  const lower = answer.toLowerCase();
  return indicators.filter((term) => lower.includes(term)).length >= 2;
}

// Condition 6
const NATURAL_CUES = [
  /and that'?s how/i, /let me know if you want/i, /i can explain more/i, /if you need more details/i,
  /i can tell you more/i, /want me to go into/i, /should i continue/i, /more about that/i,
];
export function checkNaturalCues(answer) {
  return NATURAL_CUES.some((pattern) => pattern.test(answer));
}

// Condition 7
const MULTI_STEP = [/tell me about a time/i, /describe a situation/i, /give an example/i, /walk me through/i, /explain how you/i];
export function checkMultiStepRequired(question) {
  if ((question?.category || "").toLowerCase() === "behavioral") return true;
  return MULTI_STEP.some((pattern) => pattern.test(question?.question || ""));
}

async function llmChecks({ answer, question, candidateSkills }, llm) {
  try {
    const result = await llm({
      system: ANALYZER_SYSTEM,
      user: buildAnalyzerUser({ question, answer, candidateSkills }),
      model: getFastModel(),
      temperature: 0.3,
      maxTokens: 600,
      reasoningEffort: "low", // this runs between the answer and the next question: keep it quick
    });
    return {
      opensNewTopic: result?.opensNewTopic === true,
      hasContradictions: result?.hasContradictions === true,
      showsDeepExperience: result?.showsDeepExperience === true,
      llmUsed: true,
    };
  } catch {
    return {
      opensNewTopic: fallbackNewTopic(answer, question),
      hasContradictions: false, // conservative, as in the original
      showsDeepExperience: fallbackDeepExperience(answer),
      llmUsed: false,
    };
  }
}

/**
 * Analyse an answer. Returns the per-condition flags plus { reasons, reasonForFollowUp, shouldFollowUp }.
 * context: { candidateSkills? }
 */
export async function analyzeAnswer(answer, question, context = {}, { llm = chatJSON } = {}) {
  const wordCount = countWords(answer);
  const analysis = {
    wordCount,
    isComplete: checkAnswerCompleteness(answer, wordCount, question),
    completenessScore: calculateCompletenessScore(answer),
    mentionsSkills: checkSkillCoverage(answer, question),
    hasNaturalCues: checkNaturalCues(answer),
    requiresMultiStep: checkMultiStepRequired(question),
    ...(await llmChecks({ answer, question, candidateSkills: context.candidateSkills }, llm)),
  };

  const flagged = [
    ["answer_incomplete", !analysis.isComplete || analysis.completenessScore < 60],
    ["new_topic_opened", analysis.opensNewTopic],
    ["skill_avoided", !analysis.mentionsSkills],
    ["contradiction", analysis.hasContradictions],
    ["deep_experience", analysis.showsDeepExperience],
    ["natural_cues", analysis.hasNaturalCues],
    ["multi_step_required", analysis.requiresMultiStep],
  ];
  analysis.reasons = flagged
    .filter(([, fired]) => fired)
    .map(([condition]) => ({ condition, message: REASON_MESSAGES[condition](analysis) }));
  analysis.reasonForFollowUp = analysis.reasons[0] || null;
  analysis.shouldFollowUp = analysis.reasons.length > 0;
  return analysis;
}
