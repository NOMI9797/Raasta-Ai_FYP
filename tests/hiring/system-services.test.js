import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import {
  FEATURE_NEEDS, SERVICE_ID, START_ORDER, aiEngineTarget, checkConfig, engineTarget, getServiceDefs, parseTarget, probeHttp, probePort, workerFromOverview,
} from "../../libs/system/services";
import { SystemError, buildCommand, controlEnabled, getManaged, readLogTail, startService, stopService } from "../../libs/system/supervisor";
import { SERVICE_STATE, describeService, summarise } from "../../libs/system/status";
import { buildGuidance } from "../../libs/system/guidance";
import { canUseSystem } from "../../libs/system/access";

const def = (id, env = {}) => getServiceDefs(env).find((s) => s.id === id);

test("addresses: the engine and AI engine come from the settings, and only local ones can be started", () => {
  assert.equal(engineTarget({}).healthUrl, "http://localhost:8090/health");
  assert.equal(engineTarget({ INTERVIEW_ENGINE_PORT: "9100" }).port, 9100);
  const remote = engineTarget({ NEXT_PUBLIC_INTERVIEW_WS_URL: "wss://engine.example.com/ws" });
  assert.equal(remote.healthUrl, "https://engine.example.com:443/health");
  assert.equal(remote.local, false);
  assert.equal(aiEngineTarget({}).healthUrl, "http://localhost:8000/health");
  assert.equal(aiEngineTarget({ AI_ENGINE_URL: "http://10.0.0.5:8000" }).local, false);
  assert.equal(parseTarget("not a url", "http://localhost:1").port, 1);
  assert.equal(def(SERVICE_ID.ENGINE, { NEXT_PUBLIC_INTERVIEW_WS_URL: "wss://engine.example.com/ws" }).controllable, false);
  assert.equal(def(SERVICE_ID.WORKER).controllable, true);
  assert.equal(def(SERVICE_ID.WEB).controllable, false);
});

test("start order puts the worker last, and each feature lists what it needs", () => {
  assert.deepEqual(START_ORDER, ["ai-engine", "engine", "worker"]);
  assert.deepEqual(FEATURE_NEEDS.agent, ["worker"]);
  assert.ok(FEATURE_NEEDS.invites.includes("engine") && FEATURE_NEEDS.invites.includes("ai-engine"));
});

test("probeHttp: up on a good answer, down with a reason otherwise, and never throws", async () => {
  const ok = await probeHttp("http://x/health", { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ activeSessions: 2 }) }) });
  assert.equal(ok.up, true);
  assert.equal(ok.body.activeSessions, 2);
  const refused = await probeHttp("http://x", { fetchImpl: async () => { throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }); } });
  assert.deepEqual([refused.up, refused.error], [false, "ECONNREFUSED"]);
  const bad = await probeHttp("http://x", { fetchImpl: async () => ({ ok: false, status: 503, json: async () => { throw new Error("no json"); } }) });
  assert.deepEqual([bad.up, bad.status], [false, 503]);
  const slow = await probeHttp("http://x", { timeoutMs: 20, fetchImpl: (url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))) });
  assert.equal(slow.error, "timeout");
});

test("probePort sees a listening port and a free one", async () => {
  const server = net.createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  assert.equal(await probePort(port), true);
  await new Promise((resolve) => server.close(resolve));
  assert.equal(await probePort(port), false);
});

test("worker liveness comes from the queue overview", () => {
  assert.deepEqual(workerFromOverview({ worker: { active: true, seen: true, lastSeenMs: 800 }, waiting: 3, deadTotal: 1 }), { up: true, seen: true, lastSeenMs: 800, waiting: 3, failed: 1 });
  assert.equal(workerFromOverview(null).up, false);
  assert.equal(workerFromOverview({ worker: { active: false, seen: true, lastSeenMs: 999999 }, waiting: 2 }).up, false);
});

test("config checks report yes or no, never the value, and mail is optional", () => {
  const checks = checkConfig({ GROQ_API_KEY: "gsk_secretvalue123456", AI_ENGINE_TOKEN: "  ", INTERVIEW_TICKET_SECRET: "x" });
  assert.deepEqual(checks.map((c) => [c.id, c.ok]), [["groq", true], ["ai-token", false], ["ticket", true], ["mail", false]]);
  assert.equal(checks.find((c) => c.id === "mail").optional, true);
  assert.ok(!JSON.stringify(checks).includes("secretvalue"));
});

test("control is on in development, off in production, and the flag decides either way", () => {
  assert.equal(controlEnabled({ NODE_ENV: "development" }), true);
  assert.equal(controlEnabled({ NODE_ENV: "production" }), false);
  assert.equal(controlEnabled({ NODE_ENV: "production", SERVICE_CONTROL: "true" }), true);
  assert.equal(controlEnabled({ NODE_ENV: "development", SERVICE_CONTROL: "false" }), false);
});

test("only admins and recruiters can use the system screens", () => {
  assert.equal(canUseSystem({ role: "admin", modes: [] }), true);
  assert.equal(canUseSystem({ role: "recruiter", modes: ["recruiter"] }), true);
  assert.equal(canUseSystem({ role: "sales_operator", modes: ["sales"] }), false);
  assert.equal(canUseSystem({ role: "recruiter", modes: null }), false);
  assert.equal(canUseSystem(null), false);
});

// ─── Supervisor (fake spawn, real files in a temp folder) ───

function harness(extra = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "raasta-sys-"));
  const spawned = [];
  const killed = [];
  const alive = new Set();
  const deps = {
    env: { NODE_ENV: "development", NODE_OPTIONS: "--inspect=9229" },
    cwd,
    platform: "win32",
    isUp: async () => false,
    portInUse: async () => false,
    isAlive: (pid) => alive.has(pid),
    processName: async () => "node.exe",
    killTree: async (pid) => { killed.push(pid); alive.delete(pid); },
    now: () => 1_000_000,
    spawn: (file, args, options) => {
      const child = new EventEmitter();
      child.pid = 4242;
      child.unref = () => {};
      spawned.push({ file, args, options });
      alive.add(4242);
      setImmediate(() => child.emit("spawn"));
      return child;
    },
    ...extra,
  };
  return { cwd, deps, spawned, killed, alive };
}

test("start: runs the fixed command detached, records the pid and a log header, and drops debugger flags", async () => {
  const h = harness();
  const result = await startService(SERVICE_ID.ENGINE, h.deps);
  assert.deepEqual(result, { id: "engine", status: "started", pid: 4242 });
  const [call] = h.spawned;
  assert.equal(call.file, process.execPath);
  assert.ok(call.args[0].endsWith(path.join("tsx", "dist", "cli.mjs")));
  assert.equal(call.args[1], "services/interview-engine/index.js");
  assert.equal(call.options.detached, true);
  assert.equal(call.options.windowsHide, true);
  assert.equal(call.options.cwd, h.cwd);
  assert.equal(call.options.env.NODE_OPTIONS, undefined);
  assert.equal(call.options.env.FORCE_COLOR, "0");
  assert.deepEqual({ ...getManaged("engine", h.deps) }, { managed: true, crashed: false, pid: 4242, startedAt: 1_000_000 });
  assert.match(readLogTail("engine", { cwd: h.cwd })[0], /started from the web app/);
});

test("start: nothing happens when it is already up or already starting", async () => {
  const up = harness({ isUp: async () => true });
  assert.equal((await startService(SERVICE_ID.ENGINE, up.deps)).status, "already_running");
  assert.equal(up.spawned.length, 0);

  const h = harness();
  await startService(SERVICE_ID.ENGINE, h.deps);
  const again = await startService(SERVICE_ID.ENGINE, h.deps);
  assert.deepEqual([again.status, again.pid], ["starting", 4242]);
  assert.equal(h.spawned.length, 1);
});

test("start: one that never became healthy is ended and started again after the grace period", async () => {
  const h = harness();
  await startService(SERVICE_ID.ENGINE, h.deps);
  h.deps.now = () => 1_000_000 + 120 * 1000;
  const result = await startService(SERVICE_ID.ENGINE, h.deps);
  assert.equal(result.status, "started");
  assert.deepEqual(h.killed, [4242]);
  assert.equal(h.spawned.length, 2);
});

test("start: refused when control is off, for the web app, for a remote program, and for an unknown id", async () => {
  const prod = harness({ env: { NODE_ENV: "production" } });
  await assert.rejects(startService(SERVICE_ID.ENGINE, prod.deps), (e) => e instanceof SystemError && e.code === "control_disabled" && e.status === 403);
  const h = harness();
  await assert.rejects(startService(SERVICE_ID.WEB, h.deps), (e) => e.code === "not_controllable");
  await assert.rejects(startService("rm -rf", h.deps), (e) => e.code === "unknown_service" && e.status === 404);
  const remote = harness({ env: { NODE_ENV: "development", AI_ENGINE_URL: "http://10.0.0.5:8000" } });
  await assert.rejects(startService(SERVICE_ID.AI_ENGINE, remote.deps), (e) => e.code === "not_controllable" && /another machine/.test(e.message));
  assert.equal(h.spawned.length + prod.spawned.length + remote.spawned.length, 0);
});

test("start: a port held by another program is reported, not fought over", async () => {
  const taken = harness({ portInUse: async () => true });
  await assert.rejects(startService(SERVICE_ID.ENGINE, taken.deps), (e) => e.code === "port_in_use" && e.status === 409 && /8090/.test(e.message));
});

test("start: a missing Python is explained and leaves no pid file behind", async () => {
  const h = harness({
    spawn: () => {
      const child = new EventEmitter();
      setImmediate(() => child.emit("error", Object.assign(new Error("spawn python ENOENT"), { code: "ENOENT" })));
      return child;
    },
  });
  await assert.rejects(startService(SERVICE_ID.AI_ENGINE, h.deps), (e) => e.code === "spawn_failed" && /Python was not found/.test(e.message));
  assert.equal(getManaged("ai-engine", h.deps).managed, false);
  assert.match(readLogTail("ai-engine", { cwd: h.cwd }).pop(), /Python was not found/);
});

test("stop: ends the program it started and forgets it; a terminal one is left alone", async () => {
  const h = harness();
  await startService(SERVICE_ID.ENGINE, h.deps);
  assert.deepEqual(await stopService(SERVICE_ID.ENGINE, h.deps), { id: "engine", status: "stopped" });
  assert.deepEqual(h.killed, [4242]);
  assert.equal(getManaged("engine", h.deps).crashed, false);

  const terminal = harness({ isUp: async () => true });
  await assert.rejects(stopService(SERVICE_ID.ENGINE, terminal.deps), (e) => e.code === "not_managed" && /terminal/.test(e.message));
  assert.equal((await stopService(SERVICE_ID.ENGINE, harness().deps)).status, "not_running");
});

test("stop: a recycled process number is never killed", async () => {
  const h = harness({ processName: async () => "chrome.exe" });
  await startService(SERVICE_ID.ENGINE, h.deps);
  const result = await stopService(SERVICE_ID.ENGINE, h.deps);
  assert.equal(result.status, "not_running");
  assert.deepEqual(h.killed, []);
});

test("a program that died on its own is seen as crashed until it is started again", async () => {
  const h = harness();
  await startService(SERVICE_ID.ENGINE, h.deps);
  h.alive.delete(4242);
  assert.deepEqual(getManaged("engine", h.deps), { managed: false, crashed: true, pid: 4242, startedAt: 1_000_000 });
});

test("commands: the AI engine prefers its own virtual environment, binds to this machine only, and the setting overrides it", () => {
  const env = { AI_ENGINE_URL: "http://localhost:8123" };
  const withVenv = buildCommand("ai-engine", { env, cwd: "/p", platform: "win32", exists: () => true });
  assert.ok(withVenv.file.endsWith(path.join(".venv", "Scripts", "python.exe")));
  assert.deepEqual(withVenv.args, ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8123"]);
  assert.ok(withVenv.cwd.endsWith(path.join("services", "ai-engine")));
  assert.equal(buildCommand("ai-engine", { env: {}, cwd: "/p", platform: "win32", exists: () => false }).file, "python");
  assert.equal(buildCommand("ai-engine", { env: {}, cwd: "/p", platform: "linux", exists: () => false }).file, "python3");
  assert.equal(buildCommand("ai-engine", { env: { AI_ENGINE_PYTHON: "C:/py/python.exe" }, cwd: "/p", exists: () => true }).file, "C:/py/python.exe");
  assert.throws(() => buildCommand("web", {}), SystemError);
});

test("logs: only the last lines, with keys and tokens blanked out", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "raasta-log-"));
  fs.mkdirSync(path.join(cwd, ".runtime"));
  const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
  lines.push("key gsk_abcdefghijklmnop1234 and Authorization: Bearer abcdefgh12345678 done");
  fs.writeFileSync(path.join(cwd, ".runtime", "worker.log"), lines.join("\n"));
  const tail = readLogTail("worker", { cwd, maxLines: 5 });
  assert.equal(tail.length, 5);
  assert.equal(tail[4], "key [hidden] and Authorization: [hidden] done");
  assert.deepEqual(readLogTail("engine", { cwd }), []);
});

// ─── What the screen shows ───

const worker = def(SERVICE_ID.WORKER);
const describe = (over = {}) => describeService({
  def: worker, probe: { up: false }, managed: { managed: false, crashed: false }, infraDown: [], canControl: true, now: 1_000_000, ...over,
});

test("states: running, starting, not responding, crashed, stopped", () => {
  assert.equal(describe({ probe: { up: true }, extras: { waiting: 2 } }).state, SERVICE_STATE.RUNNING);
  assert.match(describe({ probe: { up: true }, extras: { waiting: 2 } }).detail, /2 waiting/);
  assert.equal(describe({ managed: { managed: true, pid: 1, startedAt: 999_000 } }).state, SERVICE_STATE.STARTING);
  assert.equal(describe({ managed: { managed: true, pid: 1, startedAt: 1_000_000 - 200 * 1000 } }).state, SERVICE_STATE.NOT_RESPONDING);
  assert.equal(describe({ managed: { managed: false, crashed: true } }).state, SERVICE_STATE.CRASHED);
  const stopped = describe({ extras: { waiting: 3 } });
  assert.equal(stopped.state, SERVICE_STATE.STOPPED);
  assert.match(stopped.detail, /3 jobs are waiting for it/);
});

test("buttons: start is offered only when it can work", () => {
  assert.equal(describe().canStart, true);
  assert.equal(describe({ canControl: false }).canStart, false);
  assert.equal(describe({ infraDown: ["redis"] }).canStart, false);
  assert.deepEqual(describe({ infraDown: ["redis"] }).blockedBy, ["redis"]);
  assert.equal(describe({ probe: { up: true } }).canStart, false);
  assert.equal(describe({ probe: { up: true } }).canStop, false);
  assert.equal(describe({ probe: { up: true }, managed: { managed: true, pid: 5, startedAt: 1 } }).canStop, true);
  assert.equal(describe({ def: def(SERVICE_ID.WEB), probe: { up: true } }).canStart, false);
  assert.equal(describe({ def: def(SERVICE_ID.ENGINE, { NEXT_PUBLIC_INTERVIEW_WS_URL: "wss://e.example.com/ws" }) }).canStart, false);
  const running = describe({ def: def(SERVICE_ID.ENGINE), probe: { up: true }, extras: { activeSessions: 2 } });
  assert.match(running.detail, /2 interviews in progress/);
  assert.equal(running.activeSessions, 2);
});

test("summary: blocked by Postgres or Redis, degraded by a stopped program or a missing setting, else ready", () => {
  const svc = (id, state) => ({ id, label: id, state });
  const all = (state) => [svc("web", "running"), svc("worker", state), svc("engine", "running"), svc("ai-engine", "running")];
  const up = [{ id: "postgres", label: "Postgres", up: true }, { id: "redis", label: "Redis", up: true }];
  const config = [{ id: "groq", ok: true }, { id: "mail", ok: false, optional: true }];
  assert.equal(summarise({ infra: up, services: all("running"), config }).overall, "ready");
  const degraded = summarise({ infra: up, services: all("stopped"), config });
  assert.equal(degraded.overall, "degraded");
  assert.deepEqual(degraded.stopped, ["worker"]);
  assert.equal(summarise({ infra: up, services: all("running"), config: [{ id: "groq", ok: false }] }).overall, "degraded");
  const blocked = summarise({ infra: [{ id: "redis", label: "Redis (job queue)", up: false }], services: all("running"), config });
  assert.equal(blocked.overall, "blocked");
  assert.match(blocked.summary, /Redis/);
});

// ─── What to do next ───

const none = { jobs: 0, publishedJobs: 0, platformAccounts: 0, applicants: 0, shortlisted: 0, interviewsDone: 0, pendingApprovals: 0, agents: 0 };
const everything = ["worker", "engine", "ai-engine"];

test("guidance: a new recruiter is told to start the programs first, then create a job, publish it, and wait for applicants", () => {
  let g = buildGuidance({ counts: none, running: [] });
  assert.equal(g.next.id, "programs");
  assert.match(g.next.detail, /hiring worker, the interview engine, the AI engine/);
  g = buildGuidance({ counts: none, running: everything });
  assert.equal(g.next.id, "job");
  g = buildGuidance({ counts: { ...none, jobs: 1 }, running: everything });
  assert.equal(g.next.id, "publish");
  g = buildGuidance({ counts: { ...none, jobs: 1, publishedJobs: 1 }, running: everything });
  assert.equal(g.next.id, "applicants");
  g = buildGuidance({ counts: { ...none, jobs: 1, publishedJobs: 1, applicants: 4, shortlisted: 1 }, running: everything });
  assert.equal(g.next.id, "interviews");
  assert.match(g.steps.find((s) => s.id === "applicants").detail, /4 applicants so far, 1 shortlisted/);
});

test("guidance: platforms and the agent are optional and never block the next step", () => {
  const g = buildGuidance({ counts: { ...none, jobs: 1 }, running: everything });
  assert.equal(g.steps.find((s) => s.id === "platforms").optional, true);
  assert.equal(g.steps.find((s) => s.id === "agent").optional, true);
  assert.equal(g.next.id, "publish");
});

test("guidance: waiting approvals and a stopped worker with jobs waiting are called out", () => {
  const g = buildGuidance({ counts: { ...none, pendingApprovals: 2 }, running: ["engine"], waitingJobs: 3 });
  assert.deepEqual(g.attention.map((a) => a.id), ["approvals", "worker-waiting"]);
  assert.match(g.attention[0].title, /2 requests are waiting for you/);
  assert.match(g.attention[1].title, /3 jobs are waiting for the hiring worker/);
  assert.deepEqual(buildGuidance({ counts: none, running: everything, waitingJobs: 3 }).attention, []);
  assert.equal(buildGuidance({ counts: { ...none, jobs: 1, publishedJobs: 1, applicants: 1, interviewsDone: 1 }, running: everything }).next, null);
});

test("labels in a sentence keep acronyms and lower-case the rest", async () => {
  const { sentenceName } = await import("../../libs/system/features");
  assert.equal(sentenceName("AI engine"), "AI engine");
  assert.equal(sentenceName("Hiring worker"), "hiring worker");
  assert.equal(sentenceName("Interview engine"), "interview engine");
});

test("the worker the web server runs explains itself: paused, restarting, gave up, waiting for Redis, running", () => {
  const host = (over) => ({ mode: "embedded", desired: true, alive: false, lastExit: null, gaveUp: false, lastStatus: null, ...over });
  const card = (h, probe = { up: false }, managed = { managed: false, crashed: false }) => describe({ probe, managed, extras: { host: h } });

  const paused = card(host({ desired: false }));
  assert.equal(paused.state, SERVICE_STATE.STOPPED);
  assert.match(paused.detail, /will not start it again until you press Start/);
  assert.equal(paused.canStart, true);

  const restarting = card(host({ lastExit: { code: 1, at: 1 } }));
  assert.equal(restarting.state, SERVICE_STATE.STARTING);
  assert.match(restarting.detail, /starting it again/);
  assert.equal(restarting.canStart, false);

  const gaveUp = card(host({ gaveUp: true }));
  assert.equal(gaveUp.state, SERVICE_STATE.CRASHED);
  assert.match(gaveUp.detail, /paused its attempts/);
  assert.equal(gaveUp.canStart, true);

  assert.match(card(host({ lastStatus: "waiting_for_redis" })).detail, /Waiting for Redis/);
  assert.match(card(host({ lastStatus: "unavailable" })).detail, /npm install/);

  const running = card(host({ alive: true }), { up: true }, { managed: true, pid: 9, startedAt: 1 });
  assert.equal(running.state, SERVICE_STATE.RUNNING);
  assert.match(running.detail, /Run by the web server\.$/);
  assert.equal(running.hosted, true);
  assert.equal(running.canStop, true);
});
