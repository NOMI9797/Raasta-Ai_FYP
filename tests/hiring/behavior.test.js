// Camera behaviour: batch validation, per-sample classification and the interview summary.
// Tracks are synthetic, so the right answers are known in advance.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BEHAVIOR_VERSION, ZERO_BASELINE, answerWindows, baselineOf, behaviorPartKey, blinkThreshold, classifyExpression, classifyGaze,
  estimateSkew, flattenBatches, loadBehaviorBatches, normaliseBatch, summariseBehavior,
} from "../../libs/interview/behavior";

const START = Date.parse("2026-01-01T10:00:00Z");
const BLANK = { f: 1, yaw: 0, pitch: 0, roll: 0, gh: 0.5, gv: 0.5, bl: 0, sm: 0, fr: 0, bu: 0, bd: 0, ew: 0, jo: 0, mp: 0, ns: 0, sq: 0 };

/** A batch of `seconds` of samples at 10 Hz; fn(second) returns the fields that differ from a calm, centred face. */
function batch(seconds, fn = () => ({}), { startedAt = START, hz = 10, from = 0 } = {}) {
  const n = Math.round(seconds * hz);
  const cols = { v: BEHAVIOR_VERSION, startedAt, t: [] };
  for (const k of Object.keys(BLANK)) cols[k] = [];
  for (let i = 0; i < n; i += 1) {
    const sec = from + i / hz;
    const s = { ...BLANK, ...fn(sec) };
    cols.t.push(Math.round(sec * 1000));
    for (const k of Object.keys(BLANK)) cols[k].push(s[k]);
  }
  return cols;
}
const run = (b, options) => summariseBehavior(flattenBatches([normaliseBatch(b)]), options);

test("batches: wrong version, mismatched columns and silly timestamps are refused; values are clamped", () => {
  const good = batch(1);
  assert.ok(normaliseBatch(good));
  assert.equal(normaliseBatch({ ...good, v: 99 }), null);
  assert.equal(normaliseBatch({ ...good, yaw: [0, 1] }), null, "columns must be as long as the timestamps");
  assert.equal(normaliseBatch({ ...good, startedAt: 5 }), null);
  assert.equal(normaliseBatch(null), null);
  const wild = normaliseBatch({ ...good, sm: good.sm.map(() => 7), yaw: good.yaw.map(() => 400) });
  assert.equal(wild.sm[0], 1);
  assert.equal(wild.yaw[0], 90);
  const noFace = normaliseBatch({ ...good, f: good.f.map(() => 0), yaw: good.yaw.map(() => null) });
  assert.equal(noFace.yaw[0], null, "no face keeps null, not zero");
});

test("gaze: head turn, eye movement and tilt are told apart", () => {
  const at = (o) => classifyGaze({ ...BLANK, face: true, ...o });
  assert.equal(at({}), "center");
  assert.equal(at({ yaw: 30 }), "right");
  assert.equal(at({ yaw: -30 }), "left");
  assert.equal(at({ gh: 0.75 }), "right", "eyes moved with the head still");
  assert.equal(at({ pitch: -25 }), "up");
  assert.equal(at({ pitch: 25 }), "down");
  assert.equal(at({ gv: 0.8 }), "center", "the iris position up or down is unreliable (eyelids move it), so it is not used");
  assert.equal(at({ yaw: 10, gh: 0.55, gv: 0.45 }), "center", "small movements are still eye contact");
  assert.equal(classifyGaze({ ...BLANK, face: false }), "no_face");
});

test("expressions: smile, surprise, concern and tension; none without a face", () => {
  const at = (o) => classifyExpression({ ...BLANK, face: true, ...o });
  assert.equal(at({}), "neutral");
  assert.equal(at({ sm: 0.6 }), "happy");
  assert.equal(at({ bu: 0.7, ew: 0.5 }), "surprised");
  assert.equal(at({ fr: 0.5 }), "concerned");
  assert.equal(at({ bu: 0.5, sm: 0.02, bd: 0 }), "concerned", "raised inner brows with no smile");
  assert.equal(at({ bd: 0.6 }), "tense");
  assert.equal(classifyExpression({ ...BLANK, face: false }), null);
});

test("summary: eye contact, look-aways, absence and a second face over a 60 s track", () => {
  const b = batch(60, (t) => {
    if (t >= 10 && t < 14) return { yaw: 35 };                // looked right 4 s
    if (t >= 30 && t < 33) return { yaw: -35 };               // looked left 3 s
    if (t >= 40 && t < 47) return { f: 0, yaw: null, pitch: null, roll: null, gh: null, gv: null, bl: null, sm: null, fr: null, bu: null, bd: null, ew: null, jo: null, mp: null, ns: null, sq: null }; // gone 7 s
    if (t >= 50 && t < 55) return { f: 2 };                   // a second face 5 s
    return {};
  });
  const s = run(b);
  assert.equal(s.eyeContact.lookAwayCount, 2);
  assert.equal(s.eyeContact.longestLookAwaySec, 4);
  assert.equal(s.faceVisibleRate, 0.8833);
  // 60 s total, 7 s without a face: centred for 60 - 7 - 7 = 46 s of the 53 s with a face
  assert.equal(s.eyeContact.score, 86.8);
  assert.equal(s.integrity.faceAbsentCount, 1);
  assert.equal(s.integrity.faceAbsentSec, 7);
  assert.equal(s.integrity.multipleFacesCount, 1);
  assert.deepEqual(s.integrity.events.map((e) => e.type), ["face_absent", "multiple_faces"]);
  assert.ok(s.timeline.length >= 29);
});

test("summary: blinks, nods and shakes, and a still head versus a restless one", () => {
  const blinky = run(batch(60, (t) => (Math.floor(t * 10) % 40 < 2 ? { bl: 0.9 } : {}))); // a 200 ms blink every 4 s
  assert.equal(blinky.blinks.count, 15);
  assert.equal(blinky.blinks.perMin, 15);

  const nodding = run(batch(30, (t) => ({ pitch: Math.floor(t * 2) % 2 ? 8 : -8 }))); // down/up once a second
  assert.ok(nodding.head.nods >= 10, `nods ${nodding.head.nods}`);
  const shaking = run(batch(30, (t) => ({ yaw: Math.floor(t * 2) % 2 ? 12 : -12 })));
  assert.ok(shaking.head.shakes >= 10, `shakes ${shaking.head.shakes}`);

  const still = run(batch(30, () => ({ yaw: 1, pitch: 1 })));
  assert.equal(still.head.nods, 0);
  assert.equal(still.head.stability, 100);
  assert.ok(nodding.head.stability < 70);
});

test("summary: expression shares, composure and smile rate", () => {
  const s = run(batch(100, (t) => (t < 20 ? { sm: 0.7 } : t < 30 ? { bd: 0.7 } : {})));
  assert.equal(s.expressions.dominant, "neutral");
  assert.equal(s.expressions.distribution.happy, 0.2);
  assert.equal(s.expressions.distribution.tense, 0.1);
  assert.equal(s.expressions.composure, 90);
  assert.equal(s.expressions.smileRate, 0.2);
});

test("per-answer windows: eye contact is measured over the answers only", () => {
  const b = batch(60, (t) => (t >= 42 ? { yaw: 40 } : {})); // facing the screen for 42 s, then turned away for 18 s
  const s = run(b, { windows: [{ id: "turn-1", startAt: START + 5000, endAt: START + 25000 }, { id: "turn-2", startAt: START + 44000, endAt: START + 58000 }] });
  assert.equal(s.perAnswer[0].eyeContact, 100);
  assert.equal(s.perAnswer[1].eyeContact, 0);
  assert.equal(s.answering.eyeContact.score, 58.8); // 20 s of the 34 s spent answering
  assert.equal(s.eyeContact.score, 70);
  assert.equal(run(batch(60)).answering, null);
});

test("usual posture: a camera that is off to one side or below the eyes is not 'looking away'", () => {
  // The offsets of a real recording: head 7° to one side and 14° tipped, iris at 0.59 across the eye
  const usual = { yaw: -7, pitch: -14, gh: 0.59 };
  const samples = flattenBatches([normaliseBatch(batch(30, () => usual))]);
  const base = baselineOf(samples);
  assert.equal(base.yaw, -7);
  assert.equal(base.pitch, -14);
  assert.equal(base.gh, 0.59);
  const at = (o, b = base) => classifyGaze({ ...BLANK, ...usual, face: true, ...o }, b);
  assert.equal(at({}), "center", "their usual posture is eye contact");
  assert.equal(at({}, ZERO_BASELINE), "center", "even without a baseline it is within the tolerance");
  assert.equal(at({ yaw: -7 + 30 }), "right", "a real turn away");
  assert.equal(at({ yaw: -7 - 30 }), "left");
  assert.equal(at({ pitch: -14 + 25 }), "down");
  assert.equal(at({ pitch: -14 - 25 }), "up");
  // Head turned a little but eyes still on the screen: not a look-away
  assert.equal(at({ yaw: -7 + 12, gh: 0.59 - 0.1 }), "center");
  // Eyes shut: the iris position is ignored, the head decides
  assert.equal(at({ gh: 0.2, bl: 0.9 }), "center");
  const wholeRun = summariseBehavior(samples);
  assert.equal(wholeRun.eyeContact.score, 100);
  assert.deepEqual(wholeRun.baseline, { yawDeg: -7, pitchDeg: -14, irisPosition: 0.59, samples: 300 });
});

test("usual posture: not trusted when it is far from straight ahead, or from too little data", () => {
  const far = flattenBatches([normaliseBatch(batch(30, () => ({ yaw: 40, pitch: -30 })))]);
  const b = baselineOf(far);
  assert.equal(b.yaw, 0);
  assert.equal(b.pitch, 0);
  assert.equal(classifyGaze({ ...BLANK, face: true, yaw: 40, pitch: 0 }, b), "right", "someone who spent the interview looking sideways is still looking sideways");
  assert.deepEqual(baselineOf(flattenBatches([normaliseBatch(batch(2, () => ({ yaw: 10 })))])), ZERO_BASELINE);
  assert.deepEqual(baselineOf([]), ZERO_BASELINE);
});

test("blinks: people whose eyelids rest part-closed need a higher bar than 0.5", () => {
  assert.equal(blinkThreshold(ZERO_BASELINE), 0.5);
  assert.ok(Math.abs(blinkThreshold({ bl: 0.33 }) - 0.58) < 1e-9);
  assert.equal(blinkThreshold({ bl: 0.9 }), 0.75);
  // Resting at 0.33 with a real blink (0.9) every 4 s: only the blinks count
  const s = run(batch(60, (t) => (Math.floor(t * 10) % 40 < 2 ? { bl: 0.9 } : { bl: 0.55 })));
  assert.equal(s.blinks.count, 15);
});

test("answer windows come from the turns' own timestamps; empty ones are dropped", () => {
  const turns = [
    { seq: 3, speaker: "candidate", startedAt: new Date(START + 1000), endedAt: new Date(START + 9000) },
    { seq: 4, speaker: "ai", startedAt: new Date(START), endedAt: null },
    { seq: 5, speaker: "candidate", startedAt: new Date(START + 2000), endedAt: new Date(START + 2000) },
  ];
  assert.deepEqual(answerWindows(turns), [{ id: "turn-3", startAt: START + 1000, endAt: START + 9000 }]);
});

test("clock skew: the median gap between a batch's own end and the server's receive time", () => {
  const stored = [10, 20, 30].map((sec, i) => ({ receivedAt: START + 90_000 + sec * 1000 + i * 10, batch: normaliseBatch(batch(sec, () => ({}), { startedAt: START })) }));
  // The candidate's clock is 90 s behind: every batch arrives ~90 s "late"
  const skew = estimateSkew(stored);
  assert.ok(skew > 85_000 && skew < 95_000, String(skew));
  assert.equal(estimateSkew([]), 0);
  assert.equal(estimateSkew([{ receivedAt: START + 3600_000 * 5, batch: normaliseBatch(batch(5)) }]), 0, "an hours-long skew is not believed");
  const flat = flattenBatches([normaliseBatch(batch(1))], 5000);
  assert.equal(flat[0].at, START + 5000);
});

test("loading: parts are read in order, damaged ones skipped, no parts means no track", async () => {
  const docs = {
    [behaviorPartKey("iv", 0)]: JSON.stringify({ receivedAt: START + 15000, batch: batch(5) }),
    [behaviorPartKey("iv", 1)]: "{not json",
    [behaviorPartKey("iv", 2)]: JSON.stringify({ receivedAt: START + 30000, batch: { v: 9 } }),
  };
  const list = async (prefix) => Object.keys(docs).filter((k) => k.startsWith(prefix));
  const read = async (key) => Buffer.from(docs[key]);
  const stored = await loadBehaviorBatches("iv", { list, read });
  assert.equal(stored.length, 1);
  assert.deepEqual(await loadBehaviorBatches("other", { list: async () => [], read }), []);
  assert.deepEqual(await loadBehaviorBatches("iv", { list: async () => { throw new Error("storage down"); }, read }), []);
});
