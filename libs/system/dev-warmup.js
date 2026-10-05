// `npm run dev` compiles a screen the first time somebody opens it, and on a laptop that is seconds per screen
// (the sign-in page and the sign-in API alone take more than 20 s). Right after the server is up, this opens
// the screens people use first, one at a time, so the compile has already happened before they get there.
// Development only; DEV_WARMUP=false turns it off. The requests carry no session: pages answer with a
// redirect and APIs with 401, which is all that is needed to make Next compile them.
// Relative imports only.
/* global globalThis */
import net from "net";

// In the order people reach them: sign in, Home, then the hiring screens
export const WARMUP_PATHS = Object.freeze([
  "/signin",
  "/api/auth/session",
  "/dashboard",
  "/dashboard/home",
  "/api/hiring/jobs",
  "/api/notifications",
  "/api/system/status",
  "/dashboard/recruiter/jobs",
  "/dashboard/recruiter/pipeline",
  "/dashboard/recruiter/candidates",
  "/dashboard/recruiter/agent",
  "/api/agents/runs",
  "/api/agents/actions",
  "/dashboard/recruiter/decisions",
  "/dashboard/recruiter/setup",
  "/dashboard/recruiter/interviews",
  "/dashboard/recruiter/jobs/warmup/candidates", // [jobId] screens compile once for every job, so any id will do
  "/dashboard/recruiter/jobs/warmup/interview-questions",
  "/dashboard/recruiter/interviews/warmup",
  "/dashboard/platforms",
  "/dashboard/settings",
]);

const GAP_MS = 250;           // a short rest between screens, so a person's own click is not starved
const READY_TIMEOUT_MS = 90 * 1000;
const REQUEST_TIMEOUT_MS = 120 * 1000;

export function warmupEnabled(env = process.env) {
  return env.NODE_ENV === "development" && String(env.DEV_WARMUP || "").trim().toLowerCase() !== "false";
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function defaults(overrides = {}) {
  return {
    env: process.env,
    paths: WARMUP_PATHS,
    isUp: canConnect,
    get: (url) => fetch(url, { redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }).then((res) => res.arrayBuffer()),
    sleep,
    log: (message) => console.log(`[dev-warmup] ${message}`),
    ...overrides,
  };
}

/**
 * Wait for the server to accept connections, then request each path in turn. Never throws: a path that
 * fails is skipped, because this is only a head start. Returns { warmed, skipped } (or { skipped: "off" }).
 */
export async function runWarmup(deps = {}) {
  const d = defaults(deps);
  if (!warmupEnabled(d.env)) return { warmed: 0, skipped: "off" };
  // Next sets PORT once it is listening, so read it each time round instead of once
  const port = () => Number(d.env.PORT) || 8085;

  const waitUntil = Date.now() + READY_TIMEOUT_MS;
  while (!(await d.isUp(port()))) {
    if (Date.now() > waitUntil) return { warmed: 0, skipped: "server not reachable" };
    await d.sleep(500);
  }

  d.log("opening the first screens in the background so they are compiled before you sign in. For a much faster feel, stop this and run `npm run serve`.");
  const started = Date.now();
  let warmed = 0;
  for (const route of d.paths) {
    try {
      await d.get(`http://localhost:${port()}${route}`);
      warmed += 1;
    } catch {
      /* a screen that fails to compile shows its error when somebody opens it */
    }
    await d.sleep(GAP_MS);
  }
  d.log(`opened ${warmed} of ${d.paths.length} screens in ${Math.round((Date.now() - started) / 1000)} s, so they are ready when you sign in (DEV_WARMUP=false turns this off)`);
  return { warmed, skipped: d.paths.length - warmed };
}

const STARTED = Symbol.for("raasta.devWarmupStarted");

/** Start the warm-up in the background (a no-op outside development, and only once per server). */
export function startDevWarmup(deps = {}) {
  const d = defaults(deps);
  if (!warmupEnabled(d.env) || globalThis[STARTED]) return;
  globalThis[STARTED] = true;
  // Let the server finish starting before asking it for anything
  setTimeout(() => runWarmup(deps).catch(() => {}), 1500).unref?.();
}
