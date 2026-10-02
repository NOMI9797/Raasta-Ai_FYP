// Speech for the Raasta AI Interviewer via the ai-engine /tts endpoint (docs/ai-hiring/09-interview-engine.md).
// Returns audio bytes, never file paths. On any failure returns null: the client then speaks the
// text with the browser's speechSynthesis.
// Relative imports only.

const TIMEOUT_MS = 20 * 1000;
const CACHE_LIMIT = 50;
const cache = new Map(); // greeting/closing audio, keyed by voice + text

/**
 * Returns { audio: Buffer, mime: "audio/wav", durationMs } or null.
 * options.cache: keep the result in memory (used for per-job greeting/closing lines).
 */
export async function synthesize(text, { voice = process.env.TTS_VOICE || "am_michael", cache: useCache = false, fetchImpl = fetch } = {}) {
  const key = `${voice}|${text}`;
  if (useCache && cache.has(key)) return cache.get(key);

  const base = process.env.AI_ENGINE_URL || "http://localhost:8000";
  try {
    const res = await fetchImpl(`${base}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AI_ENGINE_TOKEN || ""}` },
      body: JSON.stringify({ text: text.slice(0, 600), voice }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const audio = Buffer.from(await res.arrayBuffer());
    const result = { audio, mime: "audio/wav", durationMs: Number(res.headers.get("x-audio-duration-ms")) || null };
    if (useCache) {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
      cache.set(key, result);
    }
    return result;
  } catch {
    return null;
  }
}

export function clearTtsCache() {
  cache.clear();
}
