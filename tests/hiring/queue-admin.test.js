import { test } from "node:test";
import assert from "node:assert/strict";
import { QueueAdminError, WORKER_ACTIVE_MS, getQueueOverview, retryDeadLetter } from "../../libs/hiring/queue-admin";
import { DELAYED, GROUP, STREAM } from "../../libs/hiring/queue";

const flat = (object) => Object.entries(object).flat();

// Just the commands the queue admin uses, over in-memory data
function fakeRedis({ streamLength = 0, group = null, consumers = [], delayed = 0, dead = [], noStreamKey = false } = {}) {
  const deadList = [...dead]; // [id, [field, value, ...]] oldest first
  const calls = [];
  return {
    calls,
    deadList,
    xlen: async (key) => (key === STREAM ? streamLength : deadList.length),
    zcard: async (key) => (key === DELAYED ? delayed : 0),
    xinfo: async (kind) => {
      if (noStreamKey) throw new Error("ERR no such key");
      if (kind === "GROUPS") return group ? [flat({ name: GROUP, ...group })] : [];
      return consumers.map((c) => flat(c));
    },
    xrevrange: async (key, hi, lo, c, count) => deadList.slice().reverse().slice(0, count),
    xrange: async (key, from, to) => deadList.filter(([id]) => id === from && id === to),
    xdel: async (key, id) => {
      const i = deadList.findIndex(([entryId]) => entryId === id);
      if (i < 0) return 0;
      deadList.splice(i, 1);
      return 1;
    },
    xadd: async (key, id, ...fields) => {
      calls.push(["xadd", key, fields]);
      deadList.push([`9999999999999-${deadList.length}`, fields]);
    },
  };
}

const deadEntry = (id, type, error, payload = { candidateId: "c1" }) => [id, flat({
  type, payload: JSON.stringify(payload), attempt: "3", originalId: "1-0", error, failedAt: "2026-10-04T10:00:00.000Z",
})];

test("overview: waiting, in flight, delayed, failed jobs and an active worker", async () => {
  const redis = fakeRedis({
    streamLength: 120, delayed: 2,
    group: { pending: 1, lag: 4, consumers: 1 },
    consumers: [{ name: "w1", pending: 1, idle: 800 }],
    dead: [deadEntry("100-0", "screen-candidate", "LLM request failed"), deadEntry("200-0", "send-invite", "Candidate can't be invited")],
  });
  const o = await getQueueOverview({ redis });
  assert.equal(o.waiting, 4);
  assert.equal(o.inFlight, 1);
  assert.equal(o.delayed, 2);
  assert.equal(o.streamLength, 120);
  assert.deepEqual(o.worker, { seen: true, active: true, consumers: 1, lastSeenMs: 800 });
  assert.equal(o.deadTotal, 2);
  assert.deepEqual(o.dead.map((d) => d.id), ["200-0", "100-0"]); // newest first
  assert.deepEqual(o.dead[1], {
    id: "100-0", type: "screen-candidate", attempt: 3, error: "LLM request failed",
    failedAt: "2026-10-04T10:00:00.000Z", originalId: "1-0", payload: { candidateId: "c1" },
  });
});

test("overview: a worker that stopped is seen but not active", async () => {
  const redis = fakeRedis({ group: { pending: 0, lag: 0, consumers: 1 }, consumers: [{ name: "w1", pending: 0, idle: WORKER_ACTIVE_MS + 1000 }] });
  const o = await getQueueOverview({ redis });
  assert.equal(o.worker.seen, true);
  assert.equal(o.worker.active, false);
});

test("overview: no consumer group means no worker ever ran, and everything is still waiting", async () => {
  const o = await getQueueOverview({ redis: fakeRedis({ streamLength: 16, group: null }) });
  assert.deepEqual(o.worker, { seen: false, active: false, consumers: 0, lastSeenMs: null });
  assert.equal(o.waiting, 16);
  assert.equal(o.inFlight, 0);
});

test("overview: a stream that was never created is an empty queue", async () => {
  const o = await getQueueOverview({ redis: fakeRedis({ noStreamKey: true }) });
  assert.equal(o.waiting, 0);
  assert.equal(o.worker.seen, false);
});

test("overview: waiting is unknown (null) when Redis doesn't report lag", async () => {
  const o = await getQueueOverview({ redis: fakeRedis({ streamLength: 9, group: { pending: 2, consumers: 1 }, consumers: [{ name: "w", pending: 2, idle: 10 }] }) });
  assert.equal(o.waiting, null);
});

test("overview: only the newest 50 failed jobs are listed, with the true total", async () => {
  const dead = Array.from({ length: 60 }, (_, i) => deadEntry(`${i + 1}-0`, "ping", "boom"));
  const o = await getQueueOverview({ redis: fakeRedis({ dead }) });
  assert.equal(o.dead.length, 50);
  assert.equal(o.deadTotal, 60);
  assert.equal(o.dead[0].id, "60-0");
});

test("retry: removes the failed job and queues it again as a fresh attempt", async () => {
  const redis = fakeRedis({ dead: [deadEntry("100-0", "screen-candidate", "boom", { candidateId: "abc" })] });
  const queued = [];
  const result = await retryDeadLetter("100-0", { redis, enqueueJob: async (...args) => queued.push(args) });
  assert.deepEqual(result, { retried: true, type: "screen-candidate" });
  assert.equal(redis.deadList.length, 0);
  assert.deepEqual(queued[0].slice(0, 3), ["screen-candidate", { candidateId: "abc" }, { attempt: 0 }]);
});

test("retry: a job that was already retried or never existed is refused", async () => {
  const redis = fakeRedis({ dead: [] });
  await assert.rejects(retryDeadLetter("100-0", { redis, enqueueJob: async () => {} }), (e) => e instanceof QueueAdminError && e.status === 404);
});

test("retry: two clicks queue the job once", async () => {
  const redis = fakeRedis({ dead: [deadEntry("100-0", "ping", "boom")] });
  // The second caller read the entry too, but lost the delete
  const realXdel = redis.xdel;
  let first = true;
  redis.xrange = async () => [deadEntry("100-0", "ping", "boom")];
  redis.xdel = async (...args) => (first ? ((first = false), realXdel(...args)) : 0);
  const queued = [];
  const enqueueJob = async (...args) => queued.push(args);
  await retryDeadLetter("100-0", { redis, enqueueJob });
  await assert.rejects(retryDeadLetter("100-0", { redis, enqueueJob }), (e) => e.code === "already_retried" && e.status === 409);
  assert.equal(queued.length, 1);
});

test("retry: if queueing fails the job goes back to the failed list", async () => {
  const redis = fakeRedis({ dead: [deadEntry("100-0", "ping", "boom")] });
  await assert.rejects(retryDeadLetter("100-0", { redis, enqueueJob: async () => { throw new Error("redis down"); } }), /redis down/);
  assert.equal(redis.deadList.length, 1);
  assert.equal(redis.deadList[0][1][redis.deadList[0][1].indexOf("type") + 1], "ping");
});

test("retry: ids must look like stream ids", async () => {
  for (const bad of [undefined, "", "abc", "1", "1-", "1-0; DROP", "-"]) {
    await assert.rejects(retryDeadLetter(bad, { redis: fakeRedis(), enqueueJob: async () => {} }), (e) => e.code === "invalid_id", String(bad));
  }
});
