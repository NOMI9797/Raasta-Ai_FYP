// Starts, stops and watches the hiring programs from the web app (local development).
// Only the programs in the fixed list below can be started, with fixed commands: nothing the browser sends
// ever becomes part of a command. Processes are started detached and tracked with a pid file in .runtime/, so
// they keep running when the web app restarts. Relative imports only.
import fs from "fs";
import path from "path";
import { execFile, spawn as nodeSpawn } from "child_process";
import { SERVICE_ID, getServiceDefs, probePort } from "./services";
import { workerMode } from "./features";
import { getHostState, startWorker, stopWorker } from "./worker-host";
import { logFile, pidFile, runtimeDir } from "./runtime-paths";

export { logFile, runtimeDir };

export class SystemError extends Error {
  constructor(message, { status = 400, code } = {}) {
    super(message);
    this.name = "SystemError";
    this.status = status;
    this.code = code;
  }
}

export const START_GRACE_MS = 90 * 1000; // the AI engine loads large libraries; give it time before calling it stuck
const MAX_LOG_BYTES = 1024 * 1024;
const IMAGE = { [SERVICE_ID.WORKER]: "node", [SERVICE_ID.ENGINE]: "node", [SERVICE_ID.AI_ENGINE]: "python", [SERVICE_ID.POSTER]: "node" };

/** Starting and stopping is on for local development, and off in production unless SERVICE_CONTROL=true. */
export function controlEnabled(env = process.env) {
  if (env.SERVICE_CONTROL === "true") return true;
  if (env.SERVICE_CONTROL === "false") return false;
  return env.NODE_ENV !== "production";
}


function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

const run = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 8000, windowsHide: true }, (error, stdout) => resolve({ error, stdout: String(stdout || "") }));
  });

/** Image name of a process ("node", "python"), lower case, or "" when it cannot be read. */
async function processName(pid, platform) {
  if (platform === "win32") {
    const { stdout } = await run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
    return (stdout.split(",")[0] || "").replace(/"/g, "").toLowerCase();
  }
  const { stdout } = await run("ps", ["-p", String(pid), "-o", "comm="]);
  return stdout.trim().toLowerCase();
}

async function killTree(pid, platform) {
  if (platform === "win32") {
    await run("taskkill", ["/PID", String(pid), "/T", "/F"]);
    return;
  }
  try {
    process.kill(-pid, "SIGTERM"); // the whole group: the program was started detached
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

function defaults(overrides = {}) {
  return {
    env: process.env,
    cwd: process.cwd(),
    platform: process.platform,
    fs,
    spawn: nodeSpawn,
    isAlive,
    processName,
    killTree,
    portInUse: probePort,
    now: () => Date.now(),
    ...overrides,
  };
}

function controllableDef(id, d) {
  const def = getServiceDefs(d.env).find((s) => s.id === id);
  if (!def) throw new SystemError("Unknown program", { status: 404, code: "unknown_service" });
  if (!controlEnabled(d.env)) {
    throw new SystemError("Starting and stopping from the app is turned off here. Start it from a terminal instead.", { status: 403, code: "control_disabled" });
  }
  if (!def.controllable) {
    throw new SystemError(
      def.id === SERVICE_ID.WEB ? "The web app cannot restart itself from here." : `${def.label} runs on another machine, so it cannot be started from here.`,
      { status: 400, code: "not_controllable" }
    );
  }
  return def;
}

/**
 * The command that starts a program. Fixed per program; only a Python path and the ports come from settings.
 * { file, args, cwd, label }
 */
export function buildCommand(id, { env = process.env, cwd = process.cwd(), platform = process.platform, exists = (p) => fs.existsSync(p) } = {}) {
  const tsx = path.join(cwd, "node_modules", "tsx", "dist", "cli.mjs");
  if (id === SERVICE_ID.WORKER) return { file: process.execPath, args: [tsx, "workers/hiring-worker.js"], cwd, label: "hiring worker" };
  if (id === SERVICE_ID.ENGINE) return { file: process.execPath, args: [tsx, "services/interview-engine/index.js"], cwd, label: "interview engine" };
  if (id === SERVICE_ID.POSTER) return { file: process.execPath, args: [tsx, "services/poster-engine/index.js"], cwd, label: "posting engine" };
  if (id === SERVICE_ID.AI_ENGINE) {
    const dir = path.join(cwd, "services", "ai-engine");
    const venvPython = platform === "win32" ? path.join(dir, ".venv", "Scripts", "python.exe") : path.join(dir, ".venv", "bin", "python");
    const python = env.AI_ENGINE_PYTHON || (exists(venvPython) ? venvPython : platform === "win32" ? "python" : "python3");
    const port = String(getServiceDefs(env).find((s) => s.id === SERVICE_ID.AI_ENGINE).port);
    return { file: python, args: ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", port], cwd: dir, label: "AI engine" };
  }
  throw new SystemError("Unknown program", { status: 404, code: "unknown_service" });
}

/** What the pid file says about a program started from the app: { managed, crashed, pid, startedAt }. */
export function getManaged(id, deps = {}) {
  const d = defaults(deps);
  if (id === SERVICE_ID.WORKER && workerMode(d.env) === "embedded") {
    const host = (d.hostState || getHostState)({ env: d.env });
    if (host.alive) return { managed: true, crashed: false, pid: host.pid, startedAt: host.startedAt, hosted: true };
  }
  let record;
  try {
    record = JSON.parse(d.fs.readFileSync(pidFile(id, d.cwd), "utf8"));
  } catch {
    return { managed: false, crashed: false };
  }
  const alive = d.isAlive(record.pid);
  return { managed: alive, crashed: !alive, pid: record.pid, startedAt: record.startedAt };
}

function removePidFile(id, d) {
  try {
    d.fs.unlinkSync(pidFile(id, d.cwd));
  } catch {
    /* nothing to remove */
  }
}

function friendlySpawnError(error, command) {
  if (error?.code === "ENOENT") {
    return command.label === "AI engine"
      ? "Python was not found. Create the virtual environment in services/ai-engine (python -m venv .venv, then pip install -r requirements.txt), or set AI_ENGINE_PYTHON in .env.local."
      : `Could not start the ${command.label}: ${command.file} was not found.`;
  }
  return `Could not start the ${command.label}: ${error?.message || "unknown error"}`;
}

/**
 * Start a program. `isUp(def)` is supplied by the caller (it knows how to probe each program).
 * Returns { id, status: already_running | starting | started, pid? }; throws SystemError when it should not or cannot.
 */
export async function startService(id, deps = {}) {
  const d = defaults(deps);
  const def = controllableDef(id, d);
  if (await d.isUp(def)) return { id, status: "already_running" };

  if (id === SERVICE_ID.WORKER && workerMode(d.env) === "embedded") {
    const result = await (d.startHost || startWorker)({ env: d.env });
    if (result.status === "waiting_for_redis") {
      throw new SystemError("Redis is not reachable, so the worker cannot start yet. The web server starts it by itself as soon as Redis is back.", { status: 503, code: "redis_down" });
    }
    if (result.status === "external") return { id, status: "already_running" };
    return { id, status: result.status === "started" ? "started" : "starting", pid: result.pid };
  }

  const managed = getManaged(id, d);
  if (managed.managed && d.now() - managed.startedAt < START_GRACE_MS) return { id, status: "starting", pid: managed.pid };
  if (managed.managed) {
    // alive but never became healthy: end it so the new one starts clean
    await d.killTree(managed.pid, d.platform);
    removePidFile(id, d);
  }
  if (def.port && id !== SERVICE_ID.WORKER && (await d.portInUse(def.port))) {
    throw new SystemError(
      `Port ${def.port} is already used by another program that is not answering as the ${def.label}. Close it (an old copy in a terminal?) or change the port in .env.local.`,
      { status: 409, code: "port_in_use" }
    );
  }

  const command = buildCommand(id, { env: d.env, cwd: d.cwd, platform: d.platform });
  d.fs.mkdirSync(runtimeDir(d.cwd), { recursive: true });
  const log = logFile(id, d.cwd);
  try {
    if (d.fs.statSync(log).size > MAX_LOG_BYTES) d.fs.unlinkSync(log);
  } catch {
    /* no log yet */
  }
  const fd = d.fs.openSync(log, "a");
  d.fs.writeSync(fd, `--- started from the web app at ${new Date(d.now()).toISOString()} ---\n`);

  const env = { ...d.env, FORCE_COLOR: "0" };
  delete env.NODE_OPTIONS; // the web app may carry debugger flags that would clash with the new program
  const child = d.spawn(command.file, command.args, { cwd: command.cwd, env, detached: true, stdio: ["ignore", fd, fd], windowsHide: true });
  const outcome = await new Promise((resolve) => {
    child.once("error", (error) => resolve({ error }));
    child.once("spawn", () => resolve({}));
  });
  d.fs.closeSync(fd);
  if (outcome.error) {
    const message = friendlySpawnError(outcome.error, command);
    d.fs.appendFileSync(log, `${message}\n`);
    throw new SystemError(message, { status: 500, code: "spawn_failed" });
  }
  child.unref();
  d.fs.writeFileSync(pidFile(id, d.cwd), JSON.stringify({ pid: child.pid, startedAt: d.now() }));
  return { id, status: "started", pid: child.pid };
}

/**
 * Stop a program that was started from the app. One started from a terminal is not touched:
 * the app cannot know it is the right process, and the person at that terminal can.
 */
export async function stopService(id, deps = {}) {
  const d = defaults(deps);
  const def = controllableDef(id, d);
  const hosted = id === SERVICE_ID.WORKER && workerMode(d.env) === "embedded";
  const host = hosted ? (d.hostState || getHostState)({ env: d.env }) : null;
  if (hosted && host.alive) {
    // The web server owns it: stop it and keep it stopped (no automatic restart) until it is started again
    (d.stopHost || stopWorker)({ env: d.env });
    removePidFile(id, d);
    return { id, status: "stopped" };
  }
  const managed = getManaged(id, d);
  if (!managed.pid) {
    if (await d.isUp(def)) {
      throw new SystemError(`The ${def.label} was started from a terminal, so stop it there (Ctrl+C).`, { status: 409, code: "not_managed" });
    }
    return { id, status: "not_running" };
  }
  if (managed.managed) {
    // The number could have been reused by an unrelated program after a crash: only end a process of the right kind
    const name = await d.processName(managed.pid, d.platform);
    if (name && IMAGE[id] && !name.includes(IMAGE[id])) {
      removePidFile(id, d);
      return { id, status: "not_running", note: "The recorded process was gone; nothing was stopped." };
    }
    await d.killTree(managed.pid, d.platform);
  }
  // Stopped on purpose: the web server must not start it again by itself
  if (hosted) (d.stopHost || stopWorker)({ env: d.env });
  removePidFile(id, d);
  return { id, status: "stopped" };
}

const SECRET = /(gsk_[A-Za-z0-9]{10,}|sk-[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9._-]{8,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g;

/** The last lines a program wrote, with anything that looks like a key or token blanked out. */
export function readLogTail(id, { cwd = process.cwd(), maxLines = 80, maxBytes = 24000, fsApi = fs } = {}) {
  let text = "";
  try {
    const file = logFile(id, cwd);
    const size = fsApi.statSync(file).size;
    const fd = fsApi.openSync(file, "r");
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    fsApi.readSync(fd, buffer, 0, length, size - length);
    fsApi.closeSync(fd);
    text = buffer.toString("utf8");
  } catch {
    return [];
  }
  const lines = text.split("\n").map((line) => line.replace(/\r$/, "")).filter((line) => line.trim() !== "");
  return lines.slice(-maxLines).map((line) => line.replace(SECRET, "[hidden]").slice(0, 400));
}
