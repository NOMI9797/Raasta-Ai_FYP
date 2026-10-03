// HTTP client for the Python ai-engine's media and analysis routes (docs/ai-hiring/14-ai-engine.md).
// Inputs are storage keys, never file paths. Relative imports only — runs in the hiring worker.

export const ANALYSIS_TIMEOUT_MS = 10 * 60 * 1000;
const CONCAT_TIMEOUT_MS = 5 * 60 * 1000;

export class EngineError extends Error {
  constructor(message, { status = null, code = "upstream" } = {}) {
    super(message);
    this.name = "EngineError";
    this.status = status;
    this.code = code; // upstream | timeout | unavailable | disabled | not_found | bad_input
  }
}

function codeFor(status) {
  if (status === 404) return "not_found";
  if (status === 400 || status === 422) return "bad_input";
  if (status === 501) return "disabled";
  if (status === 503) return "unavailable";
  return "upstream";
}

export function createAnalysisClient({ baseUrl = process.env.AI_ENGINE_URL || "http://localhost:8000", token = process.env.AI_ENGINE_TOKEN || "", fetchImpl = fetch } = {}) {
  async function post(path, body, timeoutMs) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
      throw new EngineError(timedOut ? `${path} timed out` : `ai-engine unreachable (${error?.message})`, { code: timedOut ? "timeout" : "unavailable" });
    }
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.json())?.detail;
      } catch {
        // not JSON
      }
      throw new EngineError(`${path} → ${res.status}${detail ? `: ${String(detail).slice(0, 200)}` : ""}`, { status: res.status, code: codeFor(res.status) });
    }
    return res.json();
  }

  return {
    /** Join recording parts under prefix into outKey. → { outKey, durationMs, parts } */
    concat: (prefix, outKey) => post("/media/concat", { prefix, outKey }, CONCAT_TIMEOUT_MS),
    voice: (audioKey, segments) => post("/analyze/voice", { audioKey, segments }, ANALYSIS_TIMEOUT_MS),
    emotion: (audioKey, segments) => post("/analyze/emotion", { audioKey, segments: segments.map(({ id, startMs, endMs }) => ({ id, startMs, endMs })) }, ANALYSIS_TIMEOUT_MS),
    gaze: (videoKey) => post("/analyze/gaze", { videoKey, sampleFps: 1 }, ANALYSIS_TIMEOUT_MS),
    face: (videoKey) => post("/analyze/face", { videoKey, sampleFps: 1 }, ANALYSIS_TIMEOUT_MS),
  };
}
