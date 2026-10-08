// Turns one MediaPipe face-landmarker result into the handful of numbers the interview records:
// head pose, where the eyes point, and a few facial muscle scores. No image ever leaves the browser.
// Pure functions (no DOM), so they are unit-tested with made-up landmarks.
// Conventions match libs/interview/behavior.js: yaw > 0 is toward the screen's right, pitch > 0 is down.

// Landmark indices of the face mesh with iris refinement (same as the AI engine's gaze analysis)
const EYES = [
  { iris: [468, 469, 470, 471, 472], inner: 362, outer: 263, top: 386, bottom: 374 },
  { iris: [473, 474, 475, 476, 477], inner: 133, outer: 33, top: 159, bottom: 145 },
];

const DEG = 180 / Math.PI;
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

export const COLUMN_KEYS = ["f", "yaw", "pitch", "roll", "gh", "gv", "bl", "sm", "fr", "bu", "bd", "ew", "jo", "mp", "ns", "sq"];

export function emptySample(faces = 0) {
  const sample = { f: faces };
  for (const key of COLUMN_KEYS) if (key !== "f") sample[key] = null;
  return sample;
}

/** Head pose in degrees from MediaPipe's column-major 4x4 face transformation matrix. */
export function headPose(matrix) {
  const d = matrix?.data || matrix;
  if (!d || d.length < 16) return null;
  // Third column: where the face points. Second column: the face's up direction.
  const fx = d[8], fy = d[9], fz = d[10];
  const ux = d[4], uy = d[5];
  const norm = Math.hypot(fx, fy, fz);
  if (!norm) return null;
  return {
    yaw: Math.atan2(fx, fz) * DEG,
    pitch: -Math.atan2(fy, Math.hypot(fx, fz)) * DEG,
    roll: Math.atan2(ux, uy) * DEG,
  };
}

function irisRatio(landmarks, eye) {
  const need = Math.max(...eye.iris, eye.inner, eye.outer, eye.top, eye.bottom);
  if (landmarks.length <= need) return null;
  const mean = (axis) => eye.iris.reduce((sum, i) => sum + landmarks[i][axis], 0) / eye.iris.length;
  const width = Math.abs(landmarks[eye.outer].x - landmarks[eye.inner].x);
  const height = Math.abs(landmarks[eye.bottom].y - landmarks[eye.top].y);
  if (width < 1e-4 || height < 1e-4) return null;
  return {
    h: (mean("x") - Math.min(landmarks[eye.inner].x, landmarks[eye.outer].x)) / width,
    v: (mean("y") - Math.min(landmarks[eye.top].y, landmarks[eye.bottom].y)) / height,
  };
}

/** Iris position in the eye, both eyes averaged: 0.5 is the middle. */
export function gazeRatios(landmarks) {
  const ratios = EYES.map((eye) => irisRatio(landmarks, eye)).filter(Boolean);
  if (!ratios.length) return null;
  return { h: ratios.reduce((a, r) => a + r.h, 0) / ratios.length, v: ratios.reduce((a, r) => a + r.v, 0) / ratios.length };
}

/** Blendshape categories → the scores we keep (left and right averaged). */
export function expressionScores(categories) {
  const score = {};
  for (const c of categories || []) score[c.categoryName] = c.score;
  const pair = (name) => ((score[`${name}Left`] ?? 0) + (score[`${name}Right`] ?? 0)) / 2;
  return {
    bl: pair("eyeBlink"),
    sm: pair("mouthSmile"),
    fr: pair("mouthFrown"),
    bu: Math.max(score.browInnerUp ?? 0, pair("browOuterUp")),
    bd: pair("browDown"),
    ew: pair("eyeWide"),
    jo: score.jawOpen ?? 0,
    mp: pair("mouthPress"),
    ns: pair("noseSneer"),
    sq: pair("eyeSquint"),
  };
}

/** One sample from a FaceLandmarkerResult. No face → a sample with f = 0 and nulls. */
export function sampleFromResult(result) {
  const faces = result?.faceLandmarks?.length || 0;
  if (!faces) return emptySample(0);
  const sample = emptySample(faces);
  const pose = headPose(result.facialTransformationMatrixes?.[0]);
  if (pose) {
    sample.yaw = r1(pose.yaw);
    sample.pitch = r1(pose.pitch);
    sample.roll = r1(pose.roll);
  }
  const gaze = gazeRatios(result.faceLandmarks[0]);
  if (gaze) {
    sample.gh = r2(gaze.h);
    sample.gv = r2(gaze.v);
  }
  const scores = expressionScores(result.faceBlendshapes?.[0]?.categories);
  for (const [key, value] of Object.entries(scores)) sample[key] = r2(value);
  return sample;
}

/** Samples [{ at, ...fields }] → the column-oriented JSON batch the server expects. */
export function toBatch(samples, startedAt) {
  const batch = { v: 1, startedAt, t: [] };
  for (const key of COLUMN_KEYS) batch[key] = [];
  for (const s of samples) {
    batch.t.push(Math.max(0, Math.round(s.at - startedAt)));
    for (const key of COLUMN_KEYS) batch[key].push(s[key] ?? (key === "f" ? 0 : null));
  }
  return batch;
}
