/* global globalThis */
// The web server runs the hiring worker for you. It starts the worker when the server starts, starts it again
// if it stops, and makes sure it is alive whenever a job is queued. The worker stays a separate process (a
// crash or a heavy job cannot freeze the website) but it belongs to the web server: it stops with it.
// Relative imports only.
import fs from "fs";
import path from "path";
import { execFile, execFileSync, spawn as nodeSpawn } from "child_process";
import { getRedisClient } from "../redis";
import { WORKER_ACTIVE_MS, getQueueOverview } from "../hiring/queue-admin";
import { workerMode } from "./features";
import { logFile, runtimeDir } from "./runtime-paths";

export const WATCHDOG_MS = 15 * 1000;
export const THROTTLE_MS = 3 * 1000; // repeated "is it alive?" questions share one answer
export const READY_MS = 20 * 1000; // a worker younger than this is "starting"
const FAST_EXIT_MS = 60 * 1000; // an exit sooner than this counts as a crash loop step
const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
export const BREAKER_MAX = 5; // this many starts inside the window and the host stops trying for a while
const BREAKER_WINDOW_MS = 2 * 60 * 1000;
export const BREAKER_PAUSE_MS = 5 * 60 * 1000;
const MAX_LOG_BYTES = 1024 * 1024;

const KEY = Symbol.for("raasta.hiringWorkerHost");

export function newHostState() {
  return {
    child: null, pid: null, startedAt: null, desired: true, spawns: [], fastExits: 0, gaveUpUntil: 0,
    lastExit: null, ensuring: null, lastEnsureAt: 0, lastResult: null, restartTimer: null, watchdog: null, started: false, lastLogged: "",
  };
}

/** One state per process, shared by every bundle of this module (the web server loads it more than once). */
export function hostState() {
  if (!globalThis[KEY]) globalThis[KEY] = newHostState();
  return globalThis[KEY];
}

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), ms))]);

function defaults(overrides = {}) {
  return {
    env: process.env,
    cwd: process.cwd(),
    platform: process.platform,
    fs,
    spawn: nodeSpawn,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    state: hostState(),
    isRedisUp: async () => {
      try {
        await withTimeout(getRedisClient().ping(), 1500);
        return true;
      } catch {
        return false;
      }
    },
    isWorkerActive: async () => isExternalWorkerActive((await getQueueOverview()).workers),
    kill: (child, platform) => killProcess(child, platform),
    log: (message) => console.log(`[hiring-worker] ${message}`),
    ...overrides,
  };
}

function killProcess(child, platform) {
  if (!child?.pid) return;
  if (platform === "win32") {
    execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 8000 }, () => {});
    return;
  }
  try {
    child.kill("SIGTERM");
  } catch {
    /* already gone */
  }
}

// s.child is cleared by the exit handler, so having one means it is running
const alive = (s) => Boolean(s.child);

// Workers the web server starts are named web-<server process number>, so they can be told apart from the rest
export const hostedWorkerId = (pid = process.pid) => `web-${pid}`;

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/**
 * Is some other worker reading the queue? `workers` = [{ name, idleMs }] from the queue overview.
 * Ours does not count (it may have just died: its queue entry stays "recent" for half a minute and must not stop a restart).
 * One started by another web server counts only while that server is alive.
 */
export function isExternalWorkerActive(workers = [], { pid = process.pid, isAlive = pidIsAlive, activeMs = WORKER_ACTIVE_MS } = {}) {
  return workers.some((w) => {
    if (w.idleMs >= activeMs) return false;
    const hosted = /^web-([0-9]+)$/.exec(w.name);
    if (!hosted) return true; // started by hand, by Docker, or by anything that is not a web server
    return Number(hosted[1]) !== pid && isAlive(Number(hosted[1]));
  });
}

function launch(d) {
  const s = d.state;
  const tsx = path.join(d.cwd, "node_modules", "tsx", "dist", "cli.mjs");
  d.fs.mkdirSync(runtimeDir(d.cwd), { recursive: true });
  const log = logFile("worker", d.cwd);
  try {
    if (d.fs.statSync(log).size > MAX_LOG_BYTES) d.fs.unlinkSync(log);
  } catch {
    /* no log yet */
  }
  const fd = d.fs.openSync(log, "a");
  d.fs.writeSync(fd, `--- started by the web server at ${new Date(d.now()).toISOString()} ---\n`);

  const env = { ...d.env, FORCE_COLOR: "0", HIRING_WORKER_PARENT_PID: String(process.pid), WORKER_ID: hostedWorkerId() };
  delete env.NODE_OPTIONS; // the web server may carry debugger flags that would clash with the worker
  const child = d.spawn(process.execPath, [tsx, "workers/hiring-worker.js"], { cwd: d.cwd, env, stdio: ["ignore", fd, fd], windowsHide: true });
  try {
    d.fs.closeSync(fd);
  } catch {
    /* the child has its own copy */
  }

  s.child = child;
  s.pid = child.pid;
  s.startedAt = d.now();
  s.spawns.push(d.now());
  child.once("error", (error) => {
    try {
      d.fs.appendFileSync(log, `Could not start the worker: ${error.message}\n`);
    } catch {
      /* the log is only a convenience */
    }
    onExit(d, child, null, null);
  });
  child.once("exit", (code, signal) => onExit(d, child, code, signal));
  return child;
}

// The worker stopped. If the web server still wants it, start it again after a pause that grows while it keeps failing.
function onExit(d, child, code, signal) {
  const s = d.state;
  if (s.child !== child) return; // an old one, already replaced
  const ranMs = d.now() - (s.startedAt || d.now());
  s.child = null;
  s.pid = null;
  s.lastResult = null; // the earlier answer (started) is no longer true, so the restart is not held back by it
  s.lastExit = { code, signal, at: d.now(), ranMs };
  s.fastExits = ranMs < FAST_EXIT_MS ? s.fastExits + 1 : 0;
  if (!s.desired || workerMode(d.env) !== "embedded") return;
  const wait = BACKOFF_MS[Math.min(Math.max(s.fastExits, 1) - 1, BACKOFF_MS.length - 1)];
  d.log(`stopped (${signal || `code ${code}`}); starting it again in ${Math.round(wait / 1000)}s`);
  clearTimeout(s.restartTimer);
  s.restartTimer = d.setTimer(() => {
    ensureWorker({ reason: "restart" }, { ...d }).catch(() => {});
  }, wait);
  s.restartTimer?.unref?.();
}

async function startIfNeeded(d, { force }) {
  const s = d.state;
  if (force) {
    s.desired = true;
    s.spawns = [];
    s.fastExits = 0;
    s.gaveUpUntil = 0;
  }
  if (d.now() < s.gaveUpUntil) return { status: "gave_up", retryAt: s.gaveUpUntil };
  if (!(await d.isRedisUp())) return { status: "waiting_for_redis" };
  // Somebody else already runs one (a terminal, another web server): do not add a second
  if (await d.isWorkerActive().catch(() => false)) return { status: "external" };

  const tsx = path.join(d.cwd, "node_modules", "tsx", "dist", "cli.mjs");
  if (!d.fs.existsSync(tsx)) return { status: "unavailable" };

  s.spawns = s.spawns.filter((at) => d.now() - at < BREAKER_WINDOW_MS);
  if (s.spawns.length >= BREAKER_MAX) {
    s.gaveUpUntil = d.now() + BREAKER_PAUSE_MS;
    d.log(`it stopped ${BREAKER_MAX} times in a row; not trying again for ${Math.round(BREAKER_PAUSE_MS / 60000)} minutes`);
    return { status: "gave_up", retryAt: s.gaveUpUntil };
  }
  const child = launch(d);
  return { status: "started", pid: child.pid };
}

/**
 * Make sure a worker is running. Cheap to call often: it answers from what it already knows.
 *   { status: running | starting | started | external | paused | disabled | waiting_for_redis | gave_up, pid?, retryAt? }
 */
export async function ensureWorker({ reason = "check", force = false } = {}, deps = {}) {
  const d = defaults(deps);
  const s = d.state;
  const mode = workerMode(d.env);
  if (mode !== "embedded") return { status: mode === "off" ? "disabled" : "external" };
  if (!s.desired && !force) return { status: "paused" };
  if (alive(s)) return { status: d.now() - s.startedAt < READY_MS ? "starting" : "running", pid: s.pid };
  if (s.ensuring) return s.ensuring;
  if (!force && s.lastResult && d.now() - s.lastEnsureAt < THROTTLE_MS) return s.lastResult;

  s.ensuring = startIfNeeded(d, { force })
    .then((result) => {
      s.lastResult = result;
      if (result.status !== s.lastLogged) {
        s.lastLogged = result.status;
        if (result.status === "started") d.log(`started (${reason}), pid ${result.pid}`);
        else if (result.status === "external") d.log("a worker is already running elsewhere; leaving it alone");
        else if (result.status === "waiting_for_redis") d.log("waiting for Redis before starting");
        else if (result.status === "unavailable") d.log("node_modules/tsx is missing, so the worker cannot start. Run npm install, or set HIRING_WORKER_MODE=external and run the worker yourself.");
      }
      return result;
    })
    .finally(() => {
      s.ensuring = null;
      s.lastEnsureAt = d.now();
    });
  return s.ensuring;
}

/** The person asked for it: start now, clearing any pause and any give-up. */
export function startWorker(deps = {}) {
  return ensureWorker({ reason: "requested", force: true }, deps);
}

/** The person asked to stop it: it stays stopped (no automatic restart) until startWorker or a server restart. */
export function stopWorker(deps = {}) {
  const d = defaults(deps);
  const s = d.state;
  s.desired = false;
  clearTimeout(s.restartTimer);
  s.lastResult = null;
  const child = s.child;
  if (child) d.kill(child, d.platform);
  return { stopped: Boolean(child) };
}

/** What the Setup guide shows. */
export function getHostState(deps = {}) {
  const d = defaults(deps);
  const s = d.state;
  const mode = workerMode(d.env);
  return {
    mode,
    desired: s.desired,
    alive: alive(s),
    pid: s.pid,
    startedAt: s.startedAt,
    lastExit: s.lastExit,
    gaveUp: d.now() < s.gaveUpUntil,
    retryAt: s.gaveUpUntil || null,
    lastStatus: s.lastResult?.status || null,
  };
}

/**
 * Called once when the web server starts (instrumentation-node.js): start the worker, check on it regularly,
 * and let the job queue wake it. Safe to call twice.
 */
export function startWorkerHost(deps = {}) {
  const d = defaults(deps);
  const s = d.state;
  if (s.started) return;
  s.started = true;
  if (workerMode(d.env) !== "embedded") {
    d.log(`HIRING_WORKER_MODE=${workerMode(d.env)}: the web server leaves the worker to you`);
    return;
  }
  // The queue (libs/hiring/queue.js) calls this after every job it adds from the web server
  globalThis.__raastaEnqueueHook = (type) => {
    ensureWorker({ reason: `queued ${type}` }, deps).catch(() => {});
  };
  // The worker belongs to this server: end it (and what it started) when the server ends. The worker also
  // checks that this server is still alive (HIRING_WORKER_PARENT_PID), for when the server is killed hard.
  process.on("exit", () => {
    if (!s.child) return;
    try {
      if (d.platform === "win32") execFileSync("taskkill", ["/PID", String(s.child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000, stdio: "ignore" });
      else s.child.kill();
    } catch {
      /* gone already */
    }
  });
  ensureWorker({ reason: "server start" }, deps).catch(() => {});
  s.watchdog = setInterval(() => ensureWorker({ reason: "watchdog" }, deps).catch(() => {}), WATCHDOG_MS);
  s.watchdog.unref?.();
}
