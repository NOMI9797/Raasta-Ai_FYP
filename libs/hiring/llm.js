import OpenAI from "openai";

// Shared Groq client for the AI hiring pipeline (OpenAI-compatible API)
export const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY || "",
  baseURL: "https://api.groq.com/openai/v1",
});

export const HIRING_MODELS = {
  accurate: "llama-3.3-70b-versatile",
  fast: "llama-3.1-8b-instant",
};

/**
 * Pull the first JSON object out of an LLM response.
 * Tolerates markdown fences or stray text around the object.
 */
export function extractJSON(raw) {
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/**
 * Run a chat completion that must return a JSON object.
 * Returns { data, raw } — data is null when the response could not be parsed.
 */
export async function chatJSON({
  system,
  user,
  model = HIRING_MODELS.accurate,
  temperature = 0.1,
  maxTokens = 2000,
}) {
  const completion = await groq.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "";
  return { data: extractJSON(raw), raw };
}
