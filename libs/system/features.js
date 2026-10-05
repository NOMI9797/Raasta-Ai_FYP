// Plain constants shared by the server code and the screens (no Node imports, so the browser can use it too).

export const SERVICE_ID = Object.freeze({ WEB: "web", WORKER: "worker", ENGINE: "engine", AI_ENGINE: "ai-engine" });
export const INFRA_ID = Object.freeze({ POSTGRES: "postgres", REDIS: "redis" });

// Start order for "start everything": the worker last, because it calls the others
export const START_ORDER = Object.freeze([SERVICE_ID.AI_ENGINE, SERVICE_ID.ENGINE, SERVICE_ID.WORKER]);

// What each part of the product needs to be running (used to warn before something silently waits)
export const FEATURE_NEEDS = Object.freeze({
  agent: [SERVICE_ID.WORKER],
  screening: [SERVICE_ID.WORKER],
  invites: [SERVICE_ID.WORKER, SERVICE_ID.ENGINE, SERVICE_ID.AI_ENGINE],
  interviews: [SERVICE_ID.ENGINE, SERVICE_ID.AI_ENGINE, SERVICE_ID.WORKER],
});

// Why a feature needs them, in the words shown to the person
export const FEATURE_WHY = Object.freeze({
  agent: "The Hiring agent runs inside the hiring worker, so it does nothing while the worker is off.",
  screening: "Applicants are scored by the hiring worker, so they wait while it is off.",
  invites: "The invite is sent by the hiring worker, and the candidate needs the interview engine and the AI engine running when they open the link.",
  interviews: "Interviews need the interview engine and the AI engine, and the results are processed by the hiring worker.",
});

/** A program label in the middle of a sentence: "Hiring worker" becomes "hiring worker", "AI engine" stays "AI engine". */
export function sentenceName(label) {
  return /^[A-Z]{2}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * How the hiring worker is run (HIRING_WORKER_MODE):
 *   embedded (default) - the web server starts it, watches it, restarts it, and wakes it when a job is queued
 *   external           - something else runs it (a terminal, a Docker service); the web server only reports on it
 *   off                - nothing runs it and nothing is reported as missing
 */
export function workerMode(env = process.env) {
  const value = String(env.HIRING_WORKER_MODE || "").trim().toLowerCase();
  return value === "external" || value === "off" ? value : "embedded";
}
