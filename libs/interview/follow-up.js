// Generates a follow-up question (docs/ai-hiring/04-source-port-map.md, "Follow-up prompt").
// Ported prompt and fallback table; the fallback is used when the LLM fails (the original
// computed it but then ignored it).
// Relative imports only — runs in the interview engine.
import { chatText, getModel } from "../ai/llm";
import { buildFollowUpPrompt } from "../ai/prompts/interview";

// Used only when the model can't produce a question. Each one must make sense on its own: it is
// spoken to a real person who may not have said anything it could refer to ("that situation").
export const FALLBACK_FOLLOW_UPS = {
  answer_incomplete: "Could you add a bit more detail to your answer?",
  new_topic_opened: "You touched on something interesting there. Could you tell me more about it?",
  skill_avoided: "Could you share a specific example from your own experience that relates to the question?",
  contradiction: "Could you clarify that last point for me?",
  deep_experience: "That sounds like valuable experience. Could you walk me through the details?",
  natural_cues: "Please, go ahead and tell me more.",
  multi_step_required: "Could you walk me through a specific example: what you did, and what the result was?",
};
const DEFAULT_FALLBACK = "Can you elaborate on that?";

// Reasoning models spend part of the budget thinking; 150 tokens left an empty or cut-off question
const ATTEMPTS = [
  { maxTokens: 500, temperature: 0.7 },
  { maxTokens: 900, temperature: 0.3 },
];

function clean(text) {
  // One question, no surrounding quotes or "Follow-up:" labels
  return String(text || "")
    .trim()
    .replace(/^(follow[- ]?up( question)?\s*[:-]\s*)/i, "")
    .replace(/^["'“]+|["'”]+$/g, "")
    .trim();
}

/** A spoken question ends in terminal punctuation; anything else was cut off mid-sentence. */
export function looksComplete(text) {
  return /[?.!]["'”)]*$/.test(String(text || "").trim());
}

/**
 * Returns { question, fallback }.
 * context: { question, answer, analysis, reason, history, candidate, role, depth }
 */
export async function generateFollowUp(context, { llm = chatText } = {}) {
  for (const attempt of ATTEMPTS) {
    try {
      const text = clean(await llm({
        system: buildFollowUpPrompt(context),
        user: "Write the follow-up question now.",
        model: getModel(),
        reasoningEffort: "low",
        ...attempt,
      }));
      if (text && text.length <= 400 && looksComplete(text)) return { question: text, fallback: false };
    } catch (error) {
      if (error?.code === "rate_limit") break; // retrying straight away only makes it worse
    }
  }
  return { question: FALLBACK_FOLLOW_UPS[context.reason?.condition] || DEFAULT_FALLBACK, fallback: true };
}
