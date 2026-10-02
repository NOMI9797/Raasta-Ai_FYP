// Shared LLM helpers: Groq through the OpenAI SDK.
// Relative imports only — this module also runs outside Next.js (worker, interview engine).
import OpenAI, { APIError, toFile } from "openai";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export const DEFAULT_MODEL = "llama-3.3-70b-versatile";
export const DEFAULT_FAST_MODEL = "llama-3.1-8b-instant";
export const DEFAULT_TRANSCRIBE_MODEL = "whisper-large-v3-turbo";

// Read at call time so processes that load env files late still pick them up
export function getModel() {
  return process.env.LLM_MODEL || DEFAULT_MODEL;
}
export function getFastModel() {
  return process.env.LLM_FAST_MODEL || DEFAULT_FAST_MODEL;
}

export class LlmError extends Error {
  /**
   * @param {string} message
   * @param {{ code: 'parse'|'rate_limit'|'upstream', retryAfterMs?: number|null, cause?: unknown }} details
   */
  constructor(message, { code, retryAfterMs = null, cause } = {}) {
    super(message);
    this.name = "LlmError";
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    if (cause) this.cause = cause;
  }
}

let client = null;

function getClient() {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.GROQ_API_KEY || "", baseURL: GROQ_BASE_URL });
  }
  return client;
}

// Tests inject a fake client; pass null to restore the real one.
export function setLlmClient(fakeClient) {
  client = fakeClient;
}

function buildMessages({ system, user, messages }) {
  if (Array.isArray(messages) && messages.length > 0) {
    return system ? [{ role: "system", content: system }, ...messages] : [...messages];
  }
  const built = [];
  if (system) built.push({ role: "system", content: system });
  if (user) built.push({ role: "user", content: user });
  if (built.length === 0) throw new Error("chat call needs `user`, `system` or `messages`");
  return built;
}

function retryAfterMsFrom(error) {
  const headers = error?.headers;
  const read = (name) => (typeof headers?.get === "function" ? headers.get(name) : headers?.[name]);
  const ms = Number(read("retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0) return ms;
  const seconds = Number(read("retry-after"));
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return null;
}

// Groq rejects JSON-mode output it cannot validate with a 400 "json_validate_failed"
function isJsonValidationError(error) {
  return (
    error instanceof APIError &&
    error.status === 400 &&
    /json_validate_failed|failed to generate json/i.test(`${error.code || ""} ${error.message || ""}`)
  );
}

function toLlmError(error) {
  if (error instanceof LlmError) return error;
  if (error instanceof APIError && error.status === 429) {
    return new LlmError("LLM rate limit reached", {
      code: "rate_limit",
      retryAfterMs: retryAfterMsFrom(error),
      cause: error,
    });
  }
  return new LlmError(`LLM request failed: ${error?.message || "unknown error"}`, {
    code: "upstream",
    cause: error,
  });
}

/**
 * Parse a JSON object (or array) from model output, tolerating ``` fences and stray text around it.
 * Returns undefined when nothing parseable is found.
 */
export function parseJsonContent(raw) {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const asObject = (value) => (value && typeof value === "object" ? value : undefined);
  try {
    return asObject(JSON.parse(text));
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return undefined;
    try {
      return asObject(JSON.parse(text.slice(start, end + 1)));
    } catch {
      return undefined;
    }
  }
}

async function complete({ messages, model, temperature, maxTokens, json }) {
  try {
    const completion = await getClient().chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    });
    return completion.choices?.[0]?.message?.content?.trim() || "";
  } catch (error) {
    if (json && isJsonValidationError(error)) return null; // treat as unparseable output
    throw toLlmError(error);
  }
}

/**
 * Plain-text completion.
 */
export async function chatText({ system, user, messages, model, temperature = 0.7, maxTokens = 400 }) {
  return complete({
    messages: buildMessages({ system, user, messages }),
    model: model || getModel(),
    temperature,
    maxTokens,
    json: false,
  });
}

/**
 * JSON completion. Retries once with a stricter instruction if the output is not valid JSON.
 * Throws LlmError { code: 'parse' | 'rate_limit' | 'upstream' }.
 */
export async function chatJSON({
  system,
  user,
  messages,
  model,
  temperature = 0.2,
  maxTokens = 1200,
  schemaHint,
}) {
  const systemPrompt = schemaHint
    ? `${system || ""}\n\nRespond with a JSON object matching this shape:\n${schemaHint}`.trim()
    : system;
  const baseMessages = buildMessages({ system: systemPrompt, user, messages });
  const options = { model: model || getModel(), temperature, maxTokens, json: true };

  const first = await complete({ ...options, messages: baseMessages });
  const parsed = parseJsonContent(first);
  if (parsed !== undefined) return parsed;

  const retryMessages = [...baseMessages, { role: "user", content: "Return ONLY valid JSON." }];
  const second = await complete({ ...options, messages: retryMessages });
  const reparsed = parseJsonContent(second);
  if (reparsed !== undefined) return reparsed;

  throw new LlmError("LLM did not return valid JSON", { code: "parse" });
}

/**
 * Speech-to-text with Groq Whisper. Returns the transcript text.
 */
export async function transcribe({ wavBuffer, model = DEFAULT_TRANSCRIBE_MODEL }) {
  try {
    const file = await toFile(wavBuffer, "audio.wav", { type: "audio/wav" });
    const result = await getClient().audio.transcriptions.create({ file, model });
    return (result?.text || "").trim();
  } catch (error) {
    throw toLlmError(error);
  }
}
