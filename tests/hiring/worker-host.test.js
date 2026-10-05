/* global globalThis */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BREAKER_MAX, READY_MS, THROTTLE_MS, ensureWorker, getHostState, newHostState, startWorker, startWorkerHost, stopWorker } from "../../libs/system/worker-host";
import { workerMode } from "../../libs/system/features";
import { enqueue } from "../../libs/hiring/queue";
import { SERVICE_ID, getServiceDefs } from "../../libs/system/services";
import { SystemError, getManaged, startService, stopService } from "../../libs/system/supervisor";

// A host with a fake clock, fake processes and a fake Redis
function harness(extra = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "raasta-host-"));
  const clock = { t: 1_000_000 };
  const spawned = [];
  const killed = [];
  const timers = [];
  const logs = [];
  const flags = { redis: true, otherWorker: false };
  const deps = {
    env: { NODE_ENV: "development" },
    cwd,
    platform: "linux",
    state: newHostState(),
    fs: { ...fs, existsSync: (p) => String(p).endsWith("cli.mjs") || fs.existsSync(p) },
    now: () => clock.t,
    isRedisUp: async () => flags.redis,
    isWorkerActive: async () => flags.otherWorker,
    setTimer: (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; },
    kill: (child) => { killed.push(child.pid); child.emit("exit", null, "SIGTERM"); },
    log: (m) => logs.push(m),
    spawn: (file, args, options) => {
      const child = new EventEmitter();
      child.pid = 7000 + spawned.length;
      spawned.push({ file, args, options, child });
      return child;
    },
    ...extra,
  };
  return { cwd, clock, deps, spawned, killed, timers, logs, flags };
}

const settle = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

test("mode: the web server runs the worker unless told otherwise", () => {
  assert.equal(workerMode({}), "embedded");
  assert.equal(workerMode({ HIRING_WORKER_MODE: "external" }), "external");
  assert.equal(workerMode({ HIRING_WORKER_MODE: " OFF " }), "off");
  assert.equal(workerMode({ HIRING_WORKER_MODE: "nonsense" }), "embedded");
});

test("ensure: starts the worker as a child of the server, with the fixed command and the parent id", async () => {
  const h = harness();
  const result = await ensureWorker({ reason: "test" }, h.deps);
  assert.equal(result.status, "started");
  const [call] = h.spawned;
  assert.equal(call.file, process.execPath);
  assert.ok(call.args[0].endsWith(path.join("tsx", "dist", "cli.mjs")));
  assert.equal(call.args[1], "workers/hiring-worker.js");
  assert.equal(call.options.detached, undefined);
  assert.equal(call.options.env.HIRING_WORKER_PARENT_PID, String(process.pid));
  assert.equal(call.options.env.NODE_OPTIONS, undefined);
  assert.match(fs.readFileSync(path.join(h.cwd, ".runtime", "worker.log"), "utf8"), /started by the web server/);
  assert.equal(getHostState(h.deps).alive, true);
});

test("ensure: asking again does not start a second one, and says starting then running", async () => {
  const h = harness();
  await ensureWorker({}, h.deps);
  assert.equal((await ensureWorker({}, h.deps)).status, "starting");
  h.clock.t += READY_MS + 1;
  assert.equal((await ensureWorker({}, h.deps)).status, "running");
  assert.equal(h.spawned.length, 1);
});

test("ensure: concurrent questions share one start", async () => {
  const h = harness();
  const results = await Promise.all([ensureWorker({}, h.deps), ensureWorker({}, h.deps), ensureWorker({}, h.deps)]);
  assert.equal(h.spawned.length, 1);
  assert.ok(results.every((r) => ["started", "starting"].includes(r.status)));
});

test("ensure: a worker run by someone else is left alone, and Redis down means wait", async () => {
  const other = harness();
  other.flags.otherWorker = true;
  assert.equal((await ensureWorker({}, other.deps)).status, "external");
  assert.equal(other.spawned.length, 0);

  const down = harness();
  down.flags.redis = false;
  assert.equal((await ensureWorker({}, down.deps)).status, "waiting_for_redis");
  assert.equal(down.spawned.length, 0);
  down.flags.redis = true;
  down.clock.t += THROTTLE_MS + 1;
  assert.equal((await ensureWorker({}, down.deps)).status, "started");
});

test("ensure: external and off modes never start anything", async () => {
  for (const [mode, status] of [["external", "external"], ["off", "disabled"]]) {
    const h = harness({ env: { HIRING_WORKER_MODE: mode } });
    assert.equal((await ensureWorker({}, h.deps)).status, status);
    assert.equal(h.spawned.length, 0);
  }
});

test("restart: it is started again after a pause that grows, and the host gives up after five quick stops", async () => {
  const h = harness();
  await ensureWorker({}, h.deps);
  const crashAndWait = async (index) => {
    h.spawned[index].child.emit("exit", 1, null);
    assert.equal(getHostState(h.deps).alive, false);
    const timer = h.timers[h.timers.length - 1];
    h.clock.t += timer.ms + 1;
    timer.fn();
    await settle();
    return timer.ms;
  };
  assert.equal(await crashAndWait(0), 1000);
  assert.equal(await crashAndWait(1), 2000);
  assert.equal(await crashAndWait(2), 5000);
  assert.equal(await crashAndWait(3), 10000);
  assert.equal(h.spawned.length, BREAKER_MAX);

  // the fifth start was the last allowed inside the window; when it stops too, the host stops trying
  await crashAndWait(4);
  const state = getHostState(h.deps);
  assert.equal(state.gaveUp, true);
  assert.equal(h.spawned.length, BREAKER_MAX);
  assert.ok(h.logs.some((l) => /not trying again/.test(l)));

  // a person pressing Start does not have to wait for the pause to end
  assert.equal((await startWorker(h.deps)).status, "started");
  assert.equal(h.spawned.length, BREAKER_MAX + 1);
  assert.equal(getHostState(h.deps).gaveUp, false);
});

test("restart: a worker that ran for a while and then stops is restarted quickly", async () => {
  const h = harness();
  await ensureWorker({}, h.deps);
  h.clock.t += 10 * 60 * 1000;
  h.spawned[0].child.emit("exit", 1, null);
  assert.equal(h.timers[h.timers.length - 1].ms, 1000);
});

test("stop: the worker is ended and stays stopped until it is started again", async () => {
  const h = harness();
  await ensureWorker({}, h.deps);
  assert.deepEqual(stopWorker(h.deps), { stopped: true });
  assert.deepEqual(h.killed, [7000]);
  assert.equal(h.timers.length, 0);
  assert.equal((await ensureWorker({}, h.deps)).status, "paused");
  assert.equal(getHostState(h.deps).desired, false);
  assert.equal((await startWorker(h.deps)).status, "started");
  assert.equal(getHostState(h.deps).desired, true);
});

test("an error while starting is logged and handled like an exit", async () => {
  const h = harness();
  await ensureWorker({}, h.deps);
  h.spawned[0].child.emit("error", new Error("spawn ENOENT"));
  assert.equal(getHostState(h.deps).alive, false);
  assert.match(fs.readFileSync(path.join(h.cwd, ".runtime", "worker.log"), "utf8"), /Could not start the worker: spawn ENOENT/);
  assert.equal(h.timers.length, 1);
});

test("server start: registers the queue hook, so queueing a job makes sure a worker exists", async () => {
  const h = harness();
  const before = globalThis.__raastaEnqueueHook;
  delete globalThis.__raastaEnqueueHook;
  try {
    startWorkerHost(h.deps);
    assert.equal(typeof globalThis.__raastaEnqueueHook, "function");
    await settle();
    assert.equal(h.spawned.length, 1);
    clearInterval(h.deps.state.watchdog);

    // the queue calls the hook; a worker that already runs is not started twice
    const redis = { xadd: async () => "1-0", zadd: async () => 1 };
    await enqueue("screen-candidate", { candidateId: "c1" }, {}, redis);
    await settle();
    assert.equal(h.spawned.length, 1);

    // and if the worker has died in the meantime, queueing wakes it
    h.spawned[0].child.emit("exit", 1, null);
    h.clock.t += THROTTLE_MS + 1;
    await enqueue("send-invite", { candidateId: "c1" }, {}, redis);
    await settle();
    assert.equal(h.spawned.length, 2);
  } finally {
    if (before) globalThis.__raastaEnqueueHook = before;
    else delete globalThis.__raastaEnqueueHook;
  }
});

test("queueing never fails because the hook does", async () => {
  const before = globalThis.__raastaEnqueueHook;
  globalThis.__raastaEnqueueHook = () => { throw new Error("hook broke"); };
  try {
    const redis = { xadd: async () => "9-0", zadd: async () => 1 };
    assert.deepEqual(await enqueue("ping", {}, {}, redis), { id: "9-0" });
  } finally {
    if (before) globalThis.__raastaEnqueueHook = before;
    else delete globalThis.__raastaEnqueueHook;
  }
});

// ─── The Setup guide's view of it ───

test("supervisor: Start asks the host; Redis down is explained; a worker run elsewhere counts as running", async () => {
  const h = harness();
  const deps = { ...h.deps, isUp: async () => false, startHost: () => ensureWorker({ force: true }, h.deps), stopHost: () => stopWorker(h.deps), hostState: () => getHostState(h.deps) };
  const started = await startService(SERVICE_ID.WORKER, deps);
  assert.equal(started.status, "started");
  assert.equal(getManaged(SERVICE_ID.WORKER, deps).hosted, true);

  const down = harness();
  down.flags.redis = false;
  const downDeps = { ...down.deps, isUp: async () => false, startHost: () => ensureWorker({ force: true }, down.deps), hostState: () => getHostState(down.deps) };
  await assert.rejects(startService(SERVICE_ID.WORKER, downDeps), (e) => e instanceof SystemError && e.code === "redis_down" && e.status === 503);

  const elsewhere = harness();
  assert.equal((await startService(SERVICE_ID.WORKER, { ...elsewhere.deps, isUp: async () => true })).status, "already_running");
});

test("supervisor: Stop ends the worker the server runs and keeps it stopped", async () => {
  const h = harness();
  await ensureWorker({}, h.deps);
  const deps = { ...h.deps, isUp: async () => true, stopHost: () => stopWorker(h.deps), hostState: () => getHostState(h.deps) };
  assert.deepEqual(await stopService(SERVICE_ID.WORKER, deps), { id: "worker", status: "stopped" });
  assert.deepEqual(h.killed, [7000]);
  assert.equal(getHostState(h.deps).desired, false);
});

test("the worker card can be controlled only when the server runs it", () => {
  const embedded = getServiceDefs({}).find((s) => s.id === "worker");
  assert.equal(embedded.controllable, true);
  assert.equal(embedded.hosted, true);
  const external = getServiceDefs({ HIRING_WORKER_MODE: "external" }).find((s) => s.id === "worker");
  assert.equal(external.controllable, false);
  assert.equal(external.hosted, false);
});

// ─── Telling workers apart ───

test("another worker counts, our own and a dead web server's do not", async () => {
  const { isExternalWorkerActive } = await import("../../libs/system/worker-host");
  const alivePids = new Set([4000]);
  const options = { pid: 3000, isAlive: (pid) => alivePids.has(pid), activeMs: 30000 };
  // started by hand or by Docker: counts while recent
  assert.equal(isExternalWorkerActive([{ name: "ZAIN-PC-1234", idleMs: 500 }], options), true);
  assert.equal(isExternalWorkerActive([{ name: "ZAIN-PC-1234", idleMs: 31000 }], options), false);
  // our own worker may have just died: its entry is still recent but must not stop a restart
  assert.equal(isExternalWorkerActive([{ name: "web-3000", idleMs: 100 }], options), false);
  // another web server's worker counts only while that server is alive
  assert.equal(isExternalWorkerActive([{ name: "web-4000", idleMs: 100 }], options), true);
  assert.equal(isExternalWorkerActive([{ name: "web-5000", idleMs: 100 }], options), false);
  assert.equal(isExternalWorkerActive([], options), false);
  assert.equal(isExternalWorkerActive(undefined, options), false);
});

test("the worker the server starts gets a name that says so", async () => {
  const { hostedWorkerId } = await import("../../libs/system/worker-host");
  const h = harness();
  await ensureWorker({}, h.deps);
  assert.equal(h.spawned[0].options.env.WORKER_ID, hostedWorkerId());
  assert.equal(hostedWorkerId(42), "web-42");
});

test("a missing worker program is reported once and nothing is started", async () => {
  const h = harness({ fs: { ...fs, existsSync: () => false } });
  assert.equal((await ensureWorker({}, h.deps)).status, "unavailable");
  assert.equal(h.spawned.length, 0);
  assert.ok(h.logs.some((l) => /node_modules\/tsx is missing/.test(l)));
});
