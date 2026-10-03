// Stage 2 analysis helpers: answer segments, integrity summary, ai-engine client.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSegments, recordingKey, recordingPrefix, summariseIntegrity } from "../../libs/interview/analysis";
import { createAnalysisClient, EngineError } from "../../libs/interview/analysis-client";

test("segments: candidate turns only, on the recording timeline, with text", () => {
  const t0 = Date.parse("2026-01-01T10:00:00Z");
  const turns = [
    { seq: 1, speaker: "ai", kind: "greeting", offsetMs: 0, startedAt: new Date(t0), text: "Hello" },
    { seq: 3, speaker: "candidate", kind: "answer", offsetMs: 5200.4, startedAt: new Date(t0 + 5200), endedAt: new Date(t0 + 14700), text: "My answer" },
    { seq: 4, speaker: "candidate", kind: "answer", offsetMs: 20000, startedAt: new Date(t0 + 20000), endedAt: new Date(t0 + 20000), text: "" }, // zero length
    { seq: 5, speaker: "candidate", kind: "answer", offsetMs: null, startedAt: new Date(t0), endedAt: new Date(t0 + 1000), text: "no offset" },
  ];
  assert.deepEqual(buildSegments(turns), [{ id: "turn-3", startMs: 5200, endMs: 14700, text: "My answer" }]);
});

test("integrity: tab switches counted with hidden time; an open one runs to the end", () => {
  const at = (s) => new Date(Date.parse("2026-01-01T10:00:00Z") + s * 1000).toISOString();
  const summary = summariseIntegrity([
    { type: "tab_visible", at: at(1) },
    { type: "tab_hidden", at: at(10) },
    { type: "tab_visible", at: at(22) },
    { type: "mic_muted", at: at(30) },
    { type: "tab_hidden", at: at(50) },
  ], at(60));
  assert.deepEqual(summary, { tabHiddenCount: 2, tabHiddenSec: 22, micMutedCount: 1, offlineCount: 0 });
  assert.deepEqual(summariseIntegrity(null, null), { tabHiddenCount: 0, tabHiddenSec: 0, micMutedCount: 0, offlineCount: 0 });
});

test("recording keys", () => {
  assert.equal(recordingPrefix("iv", "audio"), "recordings/iv/audio/");
  assert.equal(recordingKey("iv", "video"), "recordings/iv/video.webm");
});

test("analysis client: bearer token, storage keys, emotion gets spans only; errors carry a code", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    if (url.endsWith("/analyze/face")) return new Response(JSON.stringify({ detail: "Face analysis is disabled" }), { status: 501 });
    if (url.endsWith("/analyze/gaze")) return new Response("{}", { status: 503 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const client = createAnalysisClient({ baseUrl: "http://engine:8000/", token: "t0k", fetchImpl });
  const segments = [{ id: "turn-3", startMs: 0, endMs: 1000, text: "secret answer" }];
  await client.concat("recordings/iv/audio/", "recordings/iv/audio.webm");
  await client.voice("recordings/iv/audio.webm", segments);
  await client.emotion("recordings/iv/audio.webm", segments);
  assert.deepEqual(calls.map((c) => c.url), ["http://engine:8000/media/concat", "http://engine:8000/analyze/voice", "http://engine:8000/analyze/emotion"]);
  assert.ok(calls.every((c) => c.auth === "Bearer t0k"));
  assert.equal(calls[1].body.segments[0].text, "secret answer", "voice uses the answer text for WPM and fillers");
  assert.deepEqual(calls[2].body.segments, [{ id: "turn-3", startMs: 0, endMs: 1000 }]);

  await assert.rejects(client.face("recordings/iv/video.webm"), (e) => e instanceof EngineError && e.code === "disabled" && e.status === 501);
  await assert.rejects(client.gaze("recordings/iv/video.webm"), (e) => e.code === "unavailable");
  const down = createAnalysisClient({ fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(down.voice("k", segments), (e) => e.code === "unavailable");
});
