// Recording assembly and interview analysis, end to end with a fake database and fake media:
// what is measured from where, and what happens when a piece is missing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { interviewTurns, interviews } from "../../libs/schema";
import { RecordingError, analyseInterview, assembleRecording, gazeFromBehavior } from "../../libs/interview/analysis";
import { MediaToolError } from "../../libs/interview/media-tools";
import { communicationScore } from "../../libs/hiring/final-evaluator";
import { BEHAVIOR_VERSION, normaliseBatch } from "../../libs/interview/behavior";

const START = Date.parse("2026-01-01T10:00:00Z");

/** Just enough of the query builder for these two functions. update().set() applies plain values to the row. */
function fakeDb({ interview, turns = [] }) {
  const row = { id: "iv1", candidateId: "c1", status: "completed", recordingStatus: "uploading", recordingAudioKey: null, recordingVideoKey: null, analysisStatus: "pending", errorMessage: null, integrityEvents: [], endedAt: new Date(START + 900_000), updatedAt: new Date(START + 900_000), ...interview };
  const rowsFor = (table) => (table === interviews ? [row] : table === interviewTurns ? turns : []);
  const reader = (table) => {
    const q = { where: () => q, limit: async () => rowsFor(table), orderBy: async () => rowsFor(table) };
    return q;
  };
  return {
    row,
    select: () => ({ from: (table) => reader(table) }),
    update: () => ({
      set: (values) => {
        for (const [key, value] of Object.entries(values)) {
          if (value && typeof value === "object" && "queryChunks" in value) row.recordingStatus = row.recordingAudioKey ? "complete" : "failed"; // the SQL case expression
          else row[key] = value;
        }
        const after = { returning: async () => [{ status: row.recordingStatus, audio: row.recordingAudioKey, video: row.recordingVideoKey }], then: (resolve) => resolve() };
        return { where: () => after };
      },
    }),
  };
}

const listing = (keys) => async (prefix) => keys.filter((k) => k.startsWith(prefix));
const partKeys = (kind, n) => Array.from({ length: n }, (_, i) => `recordings/iv1/${kind}/${String(i).padStart(5, "0")}.webm`);

test("assembly: each kind is joined with its own prefix and the keys are saved; the status becomes complete", async () => {
  const database = fakeDb({});
  const joined = [];
  const result = await assembleRecording("iv1", {}, {
    database,
    list: listing([...partKeys("audio", 3), ...partKeys("video", 2)]),
    concat: async (prefix, outKey) => { joined.push([prefix, outKey]); return { outKey, parts: 1 }; },
  });
  assert.deepEqual(joined, [["recordings/iv1/audio/", "recordings/iv1/audio.webm"], ["recordings/iv1/video/", "recordings/iv1/video.webm"]]);
  assert.equal(database.row.recordingAudioKey, "recordings/iv1/audio.webm");
  assert.equal(database.row.recordingVideoKey, "recordings/iv1/video.webm");
  assert.equal(result.status, "complete");
  assert.equal(database.row.errorMessage, null);
});

test("assembly: a failure is written where the recruiter can see it, and a strict run throws so the worker retries", async () => {
  const database = fakeDb({});
  const transient = () => Promise.reject(new Error("storage timeout"));
  await assert.rejects(
    assembleRecording("iv1", { strict: true }, { database, list: listing(partKeys("audio", 2)), concat: transient }),
    (e) => e instanceof RecordingError && e.retryable === true && /storage timeout/.test(e.message),
  );
  assert.match(database.row.errorMessage, /^recording_failed: audio: storage timeout/);
  assert.equal(database.row.recordingStatus, "failed");

  // Not strict (the analysis calls it this way): reports the errors and carries on
  const quiet = await assembleRecording("iv1", {}, { database, list: listing(partKeys("audio", 2)), concat: transient });
  assert.deepEqual(Object.keys(quiet.errors), ["audio"]);
});

test("assembly: no ffmpeg anywhere can't be fixed by retrying, so the worker is told not to", async () => {
  const database = fakeDb({});
  const concat = () => Promise.reject(new MediaToolError("ffmpeg is not installed", { code: "ffmpeg_missing" }));
  await assert.rejects(
    assembleRecording("iv1", { strict: true }, { database, list: listing(partKeys("audio", 2)), concat }),
    (e) => e instanceof RecordingError && e.retryable === false,
  );
});

test("assembly: a later success clears the recorded problem", async () => {
  const database = fakeDb({ interview: { errorMessage: "recording_failed: audio: earlier problem" } });
  await assembleRecording("iv1", {}, { database, list: listing(partKeys("audio", 1)), concat: async (p, o) => ({ outKey: o }) });
  assert.equal(database.row.errorMessage, null);
});

// ─── analysis ───

const RATE = 16000;
/** 2 s of quiet, then speech (loud bursts) with a 2.5 s pause in the middle, then quiet. Two 'answers' of text. */
function fakeAudio() {
  const samples = new Float32Array(RATE * 30);
  const speak = (from, to) => { for (let i = Math.round(from * RATE); i < Math.round(to * RATE); i += 1) samples[i] = 0.2 * Math.sin(i / 8); };
  speak(5, 9);
  speak(11.5, 15);
  return { samples, rate: RATE };
}
const TURNS = [
  { seq: 2, speaker: "candidate", kind: "answer", offsetMs: 5000, startedAt: new Date(START + 5000), endedAt: new Date(START + 24000), text: "um I would use Express and TypeScript for the routes and controllers and services in layers" },
];

function trackBatch(seconds, startedAt = START) {
  const n = seconds * 10;
  const cols = { v: BEHAVIOR_VERSION, startedAt, t: Array.from({ length: n }, (_, i) => i * 100) };
  for (const k of ["f"]) cols[k] = Array(n).fill(1);
  for (const k of ["yaw", "pitch", "roll", "bl", "sm", "fr", "bu", "bd", "ew", "jo", "mp", "ns", "sq"]) cols[k] = Array(n).fill(0);
  cols.gh = Array(n).fill(0.5);
  cols.gv = Array(n).fill(0.5);
  return normaliseBatch(cols);
}

const noEngine = (calls = []) => ({
  voice: async () => { calls.push("voice"); throw new Error("engine down"); },
  emotion: async () => { calls.push("emotion"); throw Object.assign(new Error("ai-engine unreachable"), { code: "unavailable" }); },
  gaze: async () => { calls.push("gaze"); throw new Error("engine down"); },
  face: async () => { calls.push("face"); throw new Error("disabled"); },
});

test("analysis: pace and fluency come from the recording, eye contact from the camera track, with the engine down", async () => {
  const database = fakeDb({ interview: { recordingStatus: "complete", recordingAudioKey: "recordings/iv1/audio.webm", recordingVideoKey: "recordings/iv1/video.webm" }, turns: TURNS });
  const calls = [];
  const { analysis } = await analyseInterview("iv1", {}, {
    database,
    client: noEngine(calls),
    decode: async () => fakeAudio(),
    loadBehavior: async () => ({ stored: [{ receivedAt: START + 30_000, batch: trackBatch(30) }], unavailable: null }),
  });
  assert.equal(analysis.version, 2);
  assert.equal(analysis.voice.source, "audio");
  assert.ok(analysis.voice.wpm > 0, "words per minute measured");
  assert.equal(analysis.voice.longPauses, 1, "the 2.5 s pause in the middle of the answer, not the silence around it");
  assert.equal(analysis.voice.fillerTop[0], "um");
  assert.equal(analysis.gaze.source, "camera");
  assert.equal(analysis.gaze.eyeContactScore, 100);
  assert.equal(analysis.behavior.faceVisibleRate, 1);
  assert.ok(!calls.includes("gaze"), "the AI engine's video analysis isn't needed when there is a camera track");
  assert.ok(!("gaze" in analysis.errors));
  assert.match(analysis.errors.emotion, /unreachable/);
  assert.equal(database.row.analysisStatus, "complete");

  const score = communicationScore(analysis);
  assert.ok(score.score > 0);
  assert.equal(score.components.eyeContact, 100);
  assert.equal(score.components.composure, 100, "no tone-of-voice model: composure comes from the face");
  assert.equal(score.sources.composure, "face");
});

test("analysis: no audio at all still rates what the words show, and says what is missing", async () => {
  const database = fakeDb({ interview: { recordingStatus: "failed" }, turns: TURNS });
  let decoded = 0;
  const { analysis } = await analyseInterview("iv1", {}, {
    database,
    client: noEngine(),
    list: listing([]),
    decode: async () => { decoded += 1; return fakeAudio(); },
    loadBehavior: async () => ({ stored: [], unavailable: null }),
  });
  assert.equal(decoded, 0);
  assert.equal(analysis.voice.source, "transcript");
  assert.equal(analysis.voice.estimated, true);
  assert.equal(analysis.voice.wpm, null);
  assert.equal(analysis.errors.voice, "no audio recording");
  assert.equal(analysis.errors.behavior, "no camera tracking data");
  assert.equal(analysis.gaze, null);
  assert.equal(analysis.media, "missing");
  assert.ok(communicationScore(analysis).score !== null, "fluency from filler words is still a rating");
});

test("analysis: a camera that could not start is explained", async () => {
  const database = fakeDb({ interview: { recordingStatus: "complete", recordingAudioKey: "a", recordingVideoKey: "v" }, turns: TURNS });
  const { analysis } = await analyseInterview("iv1", {}, {
    database, client: noEngine(), decode: async () => fakeAudio(),
    loadBehavior: async () => ({ stored: [], unavailable: "Failed to fetch face_landmarker.task" }),
  });
  assert.match(analysis.errors.behavior, /couldn't start in the candidate's browser \(Failed to fetch/);
  assert.equal(analysis.behavior, null);
});

test("analysis: without a camera track the AI engine's video analysis is the fallback", async () => {
  const database = fakeDb({ interview: { recordingStatus: "complete", recordingAudioKey: "a", recordingVideoKey: "v" }, turns: TURNS });
  const client = { ...noEngine(), gaze: async () => ({ eyeContactScore: 70, attentionScore: 90, lookAwayCount: 2, longestLookAwaySec: 3, faceDetectionRate: 0.9, timeline: [{ t: 0, direction: "center" }], extra: 1 }) };
  const { analysis } = await analyseInterview("iv1", {}, { database, client, decode: async () => fakeAudio(), loadBehavior: async () => ({ stored: [], unavailable: null }) });
  assert.deepEqual(analysis.gaze, { eyeContactScore: 70, attentionScore: 90, lookAwayCount: 2, longestLookAwaySec: 3, faceDetectionRate: 0.9, source: "video" });
  assert.equal(analysis.gazeTimeline.length, 1);
});

test("analysis: when decoding fails the AI engine's voice analysis is tried before giving up on the audio", async () => {
  const database = fakeDb({ interview: { recordingStatus: "complete", recordingAudioKey: "a" }, turns: TURNS });
  const client = { ...noEngine(), voice: async () => ({ overall: { source: undefined, wpm: 140, pauseRatio: 0.1, fillerPerMin: 1 }, segments: [] }) };
  const { analysis } = await analyseInterview("iv1", {}, {
    database, client,
    decode: async () => { throw new MediaToolError("ffmpeg is not installed", { code: "ffmpeg_missing" }); },
    loadBehavior: async () => ({ stored: [], unavailable: null }),
  });
  assert.equal(analysis.voice.wpm, 140);
  assert.ok(!("voice" in analysis.errors));
});

test("analysis: waits while parts are still arriving, but not after a failed join", async () => {
  const soon = new Date(START + 900_000);
  const uploading = fakeDb({ interview: { recordingStatus: "uploading" }, turns: TURNS });
  assert.deepEqual(await analyseInterview("iv1", {}, { database: uploading, now: () => new Date(soon.getTime() + 60_000), client: noEngine() }), { waiting: true });

  const failed = fakeDb({ interview: { recordingStatus: "failed" }, turns: TURNS });
  const result = await analyseInterview("iv1", {}, { database: failed, now: () => new Date(soon.getTime() + 60_000), client: noEngine(), list: listing([]), loadBehavior: async () => ({ stored: [], unavailable: null }) });
  assert.ok(result.analysis, "a failed join is not waited out");
});

test("gaze from the camera uses the answering figures when there are enough, else the whole interview", () => {
  const eye = (score) => ({ score, attention: score + 5, lookAwayCount: 1, longestLookAwaySec: 2 });
  assert.deepEqual(gazeFromBehavior({ eyeContact: eye(60), answering: { eyeContact: eye(80) }, faceVisibleRate: 0.9 }), { eyeContactScore: 80, attentionScore: 85, lookAwayCount: 1, longestLookAwaySec: 2, faceDetectionRate: 0.9, scope: "answering", source: "camera" });
  assert.equal(gazeFromBehavior({ eyeContact: eye(60), answering: null, faceVisibleRate: 1 }).scope, "interview");
  assert.equal(gazeFromBehavior(null), null);
});
