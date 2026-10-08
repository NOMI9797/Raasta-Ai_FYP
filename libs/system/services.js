// The programs the hiring pipeline runs on, how to tell whether each one is up, and what each one is for.
// Probes take their dependencies as arguments so they can be tested without a network.
// Relative imports only (also usable outside Next.js).
import net from "net";

import { FEATURE_NEEDS, FEATURE_WHY, INFRA_ID, SERVICE_ID, START_ORDER, workerMode } from "./features";

export { FEATURE_NEEDS, FEATURE_WHY, INFRA_ID, SERVICE_ID, START_ORDER };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** { url, host, port, local } for an address, or the default when the value is missing or not a URL. */
export function parseTarget(value, fallback) {
  let parsed;
  try {
    parsed = new URL(value || fallback);
  } catch {
    parsed = new URL(fallback);
  }
  const port = Number(parsed.port) || (parsed.protocol === "https:" || parsed.protocol === "wss:" ? 443 : 80);
  return { host: parsed.hostname, port, local: LOCAL_HOSTS.has(parsed.hostname), protocol: parsed.protocol };
}

/** The interview engine address. The browser connects to NEXT_PUBLIC_INTERVIEW_WS_URL, so health is asked at the same host. */
export function engineTarget(env = process.env) {
  const port = Number(env.INTERVIEW_ENGINE_PORT) || 8090;
  const target = parseTarget(env.NEXT_PUBLIC_INTERVIEW_WS_URL, `ws://localhost:${port}/ws`);
  const secure = target.protocol === "wss:" || target.protocol === "https:";
  return { ...target, healthUrl: `${secure ? "https" : "http"}://${target.host}:${target.port}/health` };
}

export function aiEngineTarget(env = process.env) {
  const target = parseTarget(env.AI_ENGINE_URL, "http://localhost:8000");
  return { ...target, healthUrl: `${target.protocol}//${target.host}:${target.port}/health` };
}

/**
 * The programs, in plain words: the four hiring needs, and the optional posting engine. `local` says whether the app is
 * allowed to start it (only a program on this machine can be started from here).
 */
/** The posting engine listens on this machine only (its health address is not meant to be reached from elsewhere). */
export function posterTarget(env = process.env) {
  const value = Number(env.POSTER_ENGINE_PORT);
  const port = Number.isInteger(value) && value > 0 && value < 65536 ? value : 8095;
  return { host: "127.0.0.1", port, local: true, healthUrl: `http://127.0.0.1:${port}/health` };
}

export function getServiceDefs(env = process.env) {
  const engine = engineTarget(env);
  const ai = aiEngineTarget(env);
  const poster = posterTarget(env);
  return [
    {
      id: SERVICE_ID.WEB,
      label: "Web app",
      role: "The pages you are using now, the public apply form and the interview room page.",
      port: Number(env.PORT) || 8085,
      local: true,
      controllable: false,
      manual: "npm run dev",
    },
    {
      id: SERVICE_ID.WORKER,
      label: "Hiring worker",
      role: "Does the background work: scores applicants, shortlists, builds questions, sends invites, analyses interviews and runs the Hiring agent.",
      local: true,
      // In the default mode the web server runs it, so it can be started and stopped from the app
      hosted: workerMode(env) === "embedded",
      controllable: workerMode(env) === "embedded",
      needs: [INFRA_ID.REDIS, INFRA_ID.POSTGRES],
      manual: "npm run worker:hiring",
    },
    {
      id: SERVICE_ID.ENGINE,
      label: "Interview engine",
      role: "Runs the live interview: listens, asks the questions, scores answers and follows up.",
      port: engine.port,
      healthUrl: engine.healthUrl,
      local: engine.local,
      controllable: engine.local,
      manual: "npm run engine:start",
    },
    {
      id: SERVICE_ID.AI_ENGINE,
      label: "AI engine",
      role: "Speaks the interview questions and analyses the recording (voice, emotion, eye contact).",
      port: ai.port,
      healthUrl: ai.healthUrl,
      local: ai.local,
      controllable: ai.local,
      manual: "cd services/ai-engine, activate the virtual environment, then: uvicorn main:app --port 8000",
    },
    {
      id: SERVICE_ID.POSTER,
      label: "Posting engine",
      role: "Fills in a job post on Indeed in a visible browser window, like a person, and waits for you at every check, sign-in and decision. Optional: Copy and open works without it.",
      port: poster.port,
      healthUrl: poster.healthUrl,
      local: true, // its window opens on the machine it runs on, so it can only be started from here
      controllable: true,
      optional: true,
      manual: "npm run poster:engine",
    },
  ];
}

// ─── Probes ───

/** Asks an HTTP health address. Never throws. { up, status?, ms, body?, error? } */
export async function probeHttp(url, { timeoutMs = 1500, fetchImpl = fetch } = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, cache: "no-store" });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { up: res.ok, status: res.status, ms: Date.now() - started, body };
  } catch (error) {
    const code = error?.name === "AbortError" ? "timeout" : error?.cause?.code || error?.code || "unreachable";
    return { up: false, error: code, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/** True when something accepts connections on the port (used to spot a port taken by another program). */
export function probePort(port, { host = "127.0.0.1", timeoutMs = 600, connect = net.connect } = {}) {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

const withTimeout = (promise, ms, label) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms))]);

export async function probeRedis({ redis, timeoutMs = 1500 }) {
  const started = Date.now();
  try {
    await withTimeout(redis.ping(), timeoutMs, "Redis");
    return { up: true, ms: Date.now() - started };
  } catch (error) {
    return { up: false, error: error?.message || "unreachable" };
  }
}

export async function probePostgres({ query, timeoutMs = 2500 }) {
  const started = Date.now();
  try {
    await withTimeout(query(), timeoutMs, "Postgres");
    return { up: true, ms: Date.now() - started };
  } catch (error) {
    return { up: false, error: error?.message || "unreachable" };
  }
}

/**
 * The worker has no address; it shows up as a consumer of the job queue.
 * `overview` is the result of getQueueOverview(). { up, lastSeenMs, waiting, failed }
 */
export function workerFromOverview(overview) {
  const worker = overview?.worker || {};
  return {
    up: Boolean(worker.active),
    seen: Boolean(worker.seen),
    lastSeenMs: worker.lastSeenMs ?? null,
    waiting: overview?.waiting ?? null,
    failed: overview?.deadTotal ?? 0,
  };
}

/** Settings that are present or not. Only yes / no leaves this function, never a value. */
export function checkConfig(env = process.env) {
  const has = (key) => Boolean(String(env[key] || "").trim());
  return [
    {
      id: "groq",
      label: "AI model key (Groq)",
      ok: has("GROQ_API_KEY"),
      impact: "Screening, interview questions, answer scoring and job posts need it.",
      hint: "Add GROQ_API_KEY to .env.local and restart the programs.",
    },
    {
      id: "ai-token",
      label: "AI engine access token",
      ok: has("AI_ENGINE_TOKEN"),
      impact: "Without it the AI engine refuses every request except its health check.",
      hint: "Set the same AI_ENGINE_TOKEN in .env.local for the web app, worker and AI engine.",
    },
    {
      id: "ticket",
      label: "Interview link secret",
      ok: has("INTERVIEW_TICKET_SECRET"),
      impact: "Candidates cannot open an interview room without it.",
      hint: "Set INTERVIEW_TICKET_SECRET in .env.local to a long random string.",
    },
    {
      id: "mail",
      label: "Email sending (Mailgun)",
      ok: has("MAILGUN_API_KEY") && has("MAILGUN_DOMAIN"),
      optional: true,
      impact: has("MAILGUN_API_KEY") && !has("MAILGUN_DOMAIN")
        ? "MAILGUN_API_KEY is set but the sending domain is not, so interview invitations fail to send."
        : "Without it, interview invitations are saved to a local outbox folder instead of being emailed.",
      hint: "Add MAILGUN_API_KEY and MAILGUN_DOMAIN (and MAILGUN_REGION=eu for an EU domain) to .env.local, restart the programs, then run npm run mail:check.",
    },
  ];
}
