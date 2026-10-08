// The browser-side half of behaviour tracking: from a face-landmarker result to the numbers we keep.
// Landmarks and blendshapes are made up, so the geometry is checked against known poses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { COLUMN_KEYS, emptySample, expressionScores, gazeRatios, headPose, sampleFromResult, toBatch } from "../../app/interview/[token]/lib/behavior-features";
import { classifyGaze, normaliseBatch } from "../../libs/interview/behavior";

const rad = (deg) => (deg * Math.PI) / 180;

/** Column-major 4x4 matrix for a head turned by yaw/pitch (degrees): the face points along (sin yaw, -sin pitch, cos yaw·cos pitch). */
function matrix(yawDeg, pitchDeg, rollDeg = 0) {
  const y = rad(yawDeg), p = rad(pitchDeg), r = rad(rollDeg);
  // forward = third column; up = second column
  const forward = [Math.sin(y) * Math.cos(p), -Math.sin(p), Math.cos(y) * Math.cos(p)];
  const up = [Math.sin(r), Math.cos(r), 0];
  return { data: [1, 0, 0, 0, up[0], up[1], up[2], 0, forward[0], forward[1], forward[2], 0, 0, 0, 0, 1] };
}

test("head pose: facing the camera is zero; turning right and looking down are positive", () => {
  const front = headPose(matrix(0, 0));
  assert.ok(Math.abs(front.yaw) < 0.01 && Math.abs(front.pitch) < 0.01 && Math.abs(front.roll) < 0.01);
  const right = headPose(matrix(30, 0));
  assert.ok(Math.abs(right.yaw - 30) < 0.01, `yaw ${right.yaw}`);
  const down = headPose(matrix(0, 20));
  assert.ok(Math.abs(down.pitch - 20) < 0.01, `pitch ${down.pitch}`);
  assert.ok(Math.abs(headPose(matrix(0, 0, 12)).roll - 12) < 0.01);
  assert.equal(headPose(null), null);
  assert.equal(headPose({ data: [1, 2] }), null);
});

/** 478 landmarks: eyes as small boxes, irises at a chosen position (0..1 across the eye). */
function landmarks({ iris = 0.5, irisV = 0.5 } = {}) {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const eye = (irisIdx, inner, outer, top, bottom, x0) => {
    lm[inner] = { x: x0, y: 0.4, z: 0 };
    lm[outer] = { x: x0 + 0.1, y: 0.4, z: 0 };
    lm[top] = { x: x0 + 0.05, y: 0.39, z: 0 };
    lm[bottom] = { x: x0 + 0.05, y: 0.41, z: 0 };
    for (const i of irisIdx) lm[i] = { x: x0 + 0.1 * iris, y: 0.39 + 0.02 * irisV, z: 0 };
  };
  eye([468, 469, 470, 471, 472], 362, 263, 386, 374, 0.55);
  eye([473, 474, 475, 476, 477], 133, 33, 159, 145, 0.35);
  return lm;
}

test("gaze: iris position across the eye, averaged over both eyes", () => {
  const mid = gazeRatios(landmarks());
  assert.ok(Math.abs(mid.h - 0.5) < 1e-6 && Math.abs(mid.v - 0.5) < 1e-6);
  const side = gazeRatios(landmarks({ iris: 0.85, irisV: 0.2 }));
  assert.ok(Math.abs(side.h - 0.85) < 1e-6 && Math.abs(side.v - 0.2) < 1e-6);
  assert.equal(gazeRatios(landmarks().slice(0, 100)), null, "no iris landmarks, no gaze");
});

test("expression scores: left and right averaged, brows take the stronger of inner and outer", () => {
  const scores = expressionScores([
    { categoryName: "mouthSmileLeft", score: 0.8 }, { categoryName: "mouthSmileRight", score: 0.4 },
    { categoryName: "browInnerUp", score: 0.2 }, { categoryName: "browOuterUpLeft", score: 0.6 }, { categoryName: "browOuterUpRight", score: 0.6 },
    { categoryName: "jawOpen", score: 0.3 }, { categoryName: "eyeBlinkLeft", score: 1 }, { categoryName: "eyeBlinkRight", score: 0 },
  ]);
  assert.ok(Math.abs(scores.sm - 0.6) < 1e-9);
  assert.equal(scores.bu, 0.6);
  assert.equal(scores.jo, 0.3);
  assert.equal(scores.bl, 0.5);
  assert.equal(scores.fr, 0);
  assert.equal(Object.keys(expressionScores(undefined)).length, 10);
});

test("a result becomes one sample; no face becomes an empty one", () => {
  const sample = sampleFromResult({
    faceLandmarks: [landmarks({ iris: 0.5 })],
    facialTransformationMatrixes: [matrix(10, -5, 3)],
    faceBlendshapes: [{ categories: [{ categoryName: "mouthSmileLeft", score: 0.5 }, { categoryName: "mouthSmileRight", score: 0.5 }] }],
  });
  assert.equal(sample.f, 1);
  assert.equal(sample.yaw, 10);
  assert.equal(sample.pitch, -5);
  assert.equal(sample.roll, 3);
  assert.equal(sample.gh, 0.5);
  assert.equal(sample.sm, 0.5);
  assert.deepEqual(emptySample(0), { f: 0, yaw: null, pitch: null, roll: null, gh: null, gv: null, bl: null, sm: null, fr: null, bu: null, bd: null, ew: null, jo: null, mp: null, ns: null, sq: null });
  assert.deepEqual(sampleFromResult({ faceLandmarks: [] }), emptySample(0));
  assert.deepEqual(sampleFromResult(null), emptySample(0));
  // The head pose and the server agree on what "looking right" means
  assert.equal(classifyGaze({ ...sample, face: true, yaw: 35, pitch: 0 }), "right");
});

test("batches built in the browser are accepted by the server's validation", () => {
  const samples = [0, 1, 2].map((i) => ({ at: 1_767_000_000_000 + i * 100, ...emptySample(i === 1 ? 0 : 1), ...(i === 1 ? {} : { yaw: i, pitch: 0, roll: 0, gh: 0.5, gv: 0.5, bl: 0, sm: 0.1, fr: 0, bu: 0, bd: 0, ew: 0, jo: 0, mp: 0, ns: 0, sq: 0 }) }));
  const batch = toBatch(samples, 1_767_000_000_000);
  assert.deepEqual(Object.keys(batch).sort(), ["v", "startedAt", "t", ...COLUMN_KEYS].sort());
  assert.deepEqual(batch.t, [0, 100, 200]);
  const clean = normaliseBatch(batch);
  assert.ok(clean);
  assert.equal(clean.yaw[1], null, "a sample without a face keeps null");
  assert.deepEqual(clean.f, [1, 0, 1]);
});
