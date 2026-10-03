// Interview room helpers: PCM worklet maths, upload queue, rate limiter, token and recording-part helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import worklet from "../../public/worklets/pcm16-downsampler.js";
import { UploadQueue } from "../../app/interview/[token]/lib/upload-queue";
import * as pcm from "../../app/interview/[token]/lib/pcm";
import { rateLimit } from "../../libs/hiring/rate-limit";
import { ACCESS_ERRORS, AccessError, isWellFormedToken, nextRecordingParts, recordingPartKey } from "../../libs/interview/public-access";
import { createInviteToken } from "../../libs/interview/tokens";

const { createDownsampler, floatToInt16 } = worklet;

test("worklet: 48 kHz → 16 kHz by averaging, across 128-sample render quanta", () => {
  const down = createDownsampler(48000, 16000);
  const out = [];
  // 10 ms of a ramp, delivered in AudioWorklet-sized blocks of 128 samples
  const input = Array.from({ length: 480 }, (_, i) => i / 480);
  for (let i = 0; i < input.length; i += 128) out.push(...down(input.slice(i, i + 128)));
  assert.equal(out.length, 160);
  // Each output is the mean of 3 inputs
  assert.ok(Math.abs(out[0] - (0 + 1 + 2) / 3 / 480) < 1e-9);
  assert.ok(Math.abs(out[159] - (477 + 478 + 479) / 3 / 480) < 1e-9);
});

test("worklet: 44.1 kHz input keeps the right output rate", () => {
  const down = createDownsampler(44100, 16000);
  let n = 0;
  for (let i = 0; i < 44100; i += 128) n += down(new Float32Array(Math.min(128, 44100 - i)).fill(0.1)).length;
  assert.ok(Math.abs(n - 16000) <= 1, `got ${n}`);
});

test("worklet: Int16 conversion clamps", () => {
  assert.deepEqual(Array.from(floatToInt16([0, 1, -1, 2, -2, 0.5])), [0, 32767, -32768, 32767, -32768, 16384]);
});

test("fallback framer (lib/pcm.js) matches the worklet and emits 40 ms frames", () => {
  const input = Array.from({ length: 48000 }, (_, i) => Math.sin(i / 20) * 0.8);
  const viaWorklet = [];
  const wDown = createDownsampler(48000, 16000);
  for (let i = 0; i < input.length; i += 128) viaWorklet.push(...wDown(input.slice(i, i + 128)));

  const frames = [];
  const framer = pcm.createFramer(48000, 40, (buffer) => frames.push(new Int16Array(buffer)));
  for (let i = 0; i < input.length; i += 2048) framer(input.slice(i, i + 2048));
  assert.equal(frames.length, 25); // 1 s → 25 × 40 ms
  assert.ok(frames.every((f) => f.length === 640));
  const flat = frames.flatMap((f) => Array.from(f));
  assert.deepEqual(flat, Array.from(floatToInt16(viaWorklet)));
});

function fakeFetch(script) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, part: init.body.get("part"), final: init.body.get("final"), kind: init.body.get("kind") });
    const next = script.shift() ?? 200;
    if (next === "throw") throw new Error("offline");
    return { ok: next >= 200 && next < 300, status: next };
  };
  return { impl, calls };
}

test("upload queue: sequential, retries with backoff, gives up after 3 retries", async () => {
  const { impl, calls } = fakeFetch([200, "throw", 503, 200, 500, 500, 500, 500, 200]);
  const sleeps = [];
  const queue = new UploadQueue("tok", { fetchImpl: impl, sleep: async (ms) => sleeps.push(ms) });
  queue.add({ kind: "audio", part: 0, blob: new Blob(["a"]) });
  queue.add({ kind: "audio", part: 1, blob: new Blob(["b"]) });
  queue.add({ kind: "video", part: 0, blob: new Blob(["c"]) });
  queue.add({ kind: "audio", part: 2, final: true, blob: new Blob(["d"]) });
  await queue.drain();
  assert.deepEqual(calls.map((c) => `${c.kind}${c.part}`), ["audio0", "audio1", "audio1", "audio1", "video0", "video0", "video0", "video0", "audio2"]);
  assert.equal(calls.at(-1).final, "true");
  assert.match(calls[0].url, /^\/api\/interview\/tok\/upload$/);
  assert.deepEqual(sleeps, [1000, 2000, 1000, 2000, 4000]);
  assert.deepEqual(queue.status(), { pending: 0, uploaded: 3, failed: 1 });
});

test("upload queue: a 4xx (other than 408/429) is not retried", async () => {
  const { impl, calls } = fakeFetch([413]);
  const queue = new UploadQueue("tok", { fetchImpl: impl, sleep: async () => {} });
  queue.add({ kind: "audio", part: 0, blob: new Blob(["x"]) });
  await queue.drain();
  assert.equal(calls.length, 1);
  assert.equal(queue.status().failed, 1);
});

function fakeRedis() {
  const store = new Map();
  const ttls = new Map();
  return {
    async incr(k) { store.set(k, (store.get(k) || 0) + 1); return store.get(k); },
    async expire(k, s) { ttls.set(k, s); return 1; },
    async ttl(k) { return ttls.has(k) ? ttls.get(k) : -1; },
  };
}

test("rate limit: allows up to the limit, then reports retry-after; fails open without Redis", async () => {
  const redis = fakeRedis();
  const results = [];
  for (let i = 0; i < 4; i += 1) results.push(await rateLimit("rl:x", { limit: 3, windowSec: 60 }, redis));
  assert.deepEqual(results.map((r) => r.allowed), [true, true, true, false]);
  assert.equal(results[3].retryAfterSec, 60);
  const broken = { incr: async () => { throw new Error("down"); } };
  assert.equal((await rateLimit("rl:y", { limit: 1, windowSec: 60 }, broken)).allowed, true);
});

test("tokens: invite tokens are well-formed; junk is rejected before any lookup", () => {
  const { token } = createInviteToken();
  assert.equal(isWellFormedToken(token), true);
  for (const bad of ["", "short", "../../etc/passwd", "a".repeat(200), "has space in it 1234567890", null]) {
    assert.equal(isWellFormedToken(bad), false);
  }
});

test("access errors map to the documented status codes", () => {
  assert.equal(new AccessError("not_found").status, 404);
  assert.equal(new AccessError("expired").status, 410);
  assert.equal(new AccessError("cancelled").status, 410);
  assert.equal(new AccessError("completed").status, 409);
  assert.equal(new AccessError("rate_limited", { retryAfterSec: 30 }).retryAfterSec, 30);
  assert.equal(ACCESS_ERRORS.cancelled.message, ACCESS_ERRORS.not_found.message, "replaced and cancelled links read the same");
});

test("recording parts: key format and continuing after a reload", async () => {
  assert.equal(recordingPartKey("iv1", "audio", 7), "recordings/iv1/audio/00007.webm");
  const list = async (prefix) => (prefix.endsWith("audio/")
    ? ["recordings/iv1/audio/00000.webm", "recordings/iv1/audio/00003.webm", "recordings/iv1/audio/00003.webm.meta.json"]
    : []);
  assert.deepEqual(await nextRecordingParts("iv1", { list }), { audio: 4, video: 0 });
  assert.deepEqual(await nextRecordingParts("iv1", { list: async () => { throw new Error("down"); } }), { audio: 0, video: 0 });
});
