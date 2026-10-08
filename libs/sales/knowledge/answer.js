// Answer a question from the knowledge base only, saying which passages were used and whether the
// knowledge base actually covers it. The Knowledge base page's "Ask" box uses this to show what the
// agent would say; the reply agent uses the same grounding rules. Relative imports only.
import { chatJSON, getModel } from "../../ai/llm";
import { formatContext, searchKnowledge } from "./search";

export const GROUNDING_RULES = [
  "Use ONLY facts from the KNOWLEDGE passages. Never invent prices, timelines, clients, guarantees or features.",
  "If the passages don't answer something, say you'll check with the team and get back to them; do not guess.",
  "Quote prices only as they appear in the passages (ranges stay ranges). Never offer discounts or contract terms that aren't written there.",
].join("\n");

/** @returns {{ system: string, user: string }} */
export function answerPrompt({ question, results }) {
  return {
    system: [
      "You answer questions about our company for our sales team.",
      GROUNDING_RULES,
      'Return JSON: {"answer": "2-5 plain sentences", "covered": true|false, "sources": [passage numbers you used]}',
      '"covered" is false when the passages don\'t really answer the question.',
    ].join("\n"),
    user: `KNOWLEDGE:\n${formatContext(results)}\n\nQUESTION: ${question}`,
  };
}

/** Keep only passage numbers that exist, as 1-based indexes. */
export function normaliseSources(sources, count) {
  return [...new Set((Array.isArray(sources) ? sources : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= count))];
}

export async function answerQuestion({ userId, question }, deps = {}) {
  const search = deps.search || searchKnowledge;
  const { results, topSimilarity } = await search({ userId, query: question, limit: 5 });
  if (!results.length) {
    return { answer: "The knowledge base has nothing on this yet.", covered: false, sources: [], passages: [], topSimilarity };
  }
  const out = await chatJSON({ ...answerPrompt({ question, results }), model: getModel(), temperature: 0.2, maxTokens: 900 });
  const used = normaliseSources(out?.sources, results.length);
  return {
    answer: String(out?.answer || "").trim(),
    covered: Boolean(out?.covered) && used.length > 0,
    sources: used,
    passages: results,
    topSimilarity,
  };
}
