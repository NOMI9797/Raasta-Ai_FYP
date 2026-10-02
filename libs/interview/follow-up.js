// Generates a follow-up question (docs/ai-hiring/04-source-port-map.md, "Follow-up prompt").
// Ported prompt and fallback table; the fallback is used when the LLM fails (the original
// computed it but then ignored it).
// Relative imports only — runs in the interview engine.
import { chatText, getModel } from "../ai/llm";
import { buildFollowUpPrompt } from "../ai/prompts/interview";

export const FALLBACK_FOLLOW_UPS = {
  answer_incomplete: "Can you provide more details about that?",
  new_topic_opened: "That's interesting. Can you tell me more about that?",
  skill_avoided: "Could you give me a specific example of how you've used that?",
  contradiction: "Can you help me understand that better?",
  deep_experience: "That sounds like valuable experience. Can you walk me through the details?",
  natural_cues: "Please, go ahead and tell me more.",
  multi_step_required: "What specific challenges did you face in that situation?",
};
const DEFAULT_FALLBACK = "Can you elaborate on that?";

function clean(text) {
  // One question, no surrounding quotes or "Follow-up:" labels
  return String(text || "")
    .trim()
    .replace(/^(follow[- ]?up( question)?\s*[:-]\s*)/i, "")
    .replace(/^["'“]+|["'”]+$/g, "")
    .trim();
}

/**
 * Returns { question, fallback }.
 * context: { question, answer, analysis, reason, history, candidate, role, depth }
 */
export async function generateFollowUp(context, { llm = chatText } = {}) {
  try {
    const text = clean(await llm({
      system: buildFollowUpPrompt(context),
      user: "Write the follow-up question now.",
      model: getModel(),
      temperature: 0.7,
      maxTokens: 150,
    }));
    if (!text || text.length > 400) throw new Error("unusable follow-up");
    return { question: text, fallback: false };
  } catch {
    return { question: FALLBACK_FOLLOW_UPS[context.reason?.condition] || DEFAULT_FALLBACK, fallback: true };
  }
}
