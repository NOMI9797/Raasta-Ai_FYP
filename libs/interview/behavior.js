// Candidate behaviour from the camera: where they look, how their head moves, how often they blink and
// what their face shows. The browser measures it live (app/interview/[token]/lib/behavior-tracker.js:
// MediaPipe face landmarks, only numbers leave the browser) and uploads small JSON batches. This module
// checks those batches and turns them into the summary the recruiter sees.
//
// These are signals, not verdicts. Facial expression readings are approximate (speaking moves the
// mouth, lighting and camera angle matter) and say nothing about honesty or competence.
// Relative imports only — runs in the hiring worker.
import { getObjectBuffer, listKeys } from "../hiring/storage";

export const BEHAVIOR_VERSION = 1;
export const behaviorPrefix = (interviewId) => `recordings/${interviewId}/behavior/`;
export const behaviorPartKey = (interviewId, part) => `${behaviorPrefix(interviewId)}${String(part).padStart(5, "0")}.json`;

// ─── Thresholds (degrees for head pose, 0..1 for iris position and expression scores) ───
// Gaze is measured against the candidate's own usual posture (see baselineOf): webcams sit above or
// below eye level and monitors are off to one side, so "straight ahead" is different for everyone.
// A real recording had a usual head pose of 7° left and 14° tipped, and the iris at 0.59 across the eye.
export const T = {
  gazeYaw: 18,          // gaze (head turn plus eye position) this far sideways from the usual: looking away
  gazePitch: 15,        // head tipped this far up or down from the usual
  irisDegPerUnit: 120,  // how many degrees of gaze one unit of iris position across the eye is worth
  lookAwayMinSec: 1.0,  // a look-away is at least this long
  happy: 0.35,          // smile
  surprise: 0.5,        // raised brows with wide eyes or an open jaw
  concern: 0.35,        // frown, or inner brows raised without a smile
  tense: 0.45,          // brows pulled down, nose wrinkled, lips pressed
  blink: 0.5,           // eyelids this closed (raised for people whose eyelids rest part-closed, see baselineOf)
  facesGapSec: 1.5,     // gap between samples that ends a stretch (page hidden, tracker paused)
  absentMinSec: 5,      // no face for this long is reported
  multiFaceMinSec: 3,   // a second face for this long is reported
  gestureDeg: { nod: 5, shake: 8 }, // smallest swing that counts as a nod or a shake
  gestureMaxSec: 1.2,   // a swing and its return happen within this time
};

const MAX_SAMPLES_PER_BATCH = 3000;
const COLUMNS = {
  f: [0, 4],              // faces seen
  yaw: [-90, 90], pitch: [-90, 90], roll: [-90, 90],
  gh: [0, 1], gv: [0, 1], // iris position in the eye: 0.5 is the middle
  bl: [0, 1], sm: [0, 1], fr: [0, 1], bu: [0, 1], bd: [0, 1], ew: [0, 1], jo: [0, 1], mp: [0, 1], ns: [0, 1], sq: [0, 1],
};
const NULLABLE = new Set(["yaw", "pitch", "roll", "gh", "gv", "bl", "sm", "fr", "bu", "bd", "ew", "jo", "mp", "ns", "sq"]);

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const avg = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const round = (v, d = 1) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Validate one uploaded batch: { v, startedAt, t: [ms since startedAt], f: [...], yaw: [...], ... }.
 * Returns a clean copy (values clamped, nulls kept where there was no face) or null when unusable.
 */
export function normaliseBatch(raw) {
  if (!raw || typeof raw !== "object" || raw.v !== BEHAVIOR_VERSION) return null;
  const startedAt = Number(raw.startedAt);
  if (!Number.isFinite(startedAt) || startedAt < 1e12) return null;
  if (!Array.isArray(raw.t) || raw.t.length === 0 || raw.t.length > MAX_SAMPLES_PER_BATCH) return null;
  const n = raw.t.length;
  const out = { v: BEHAVIOR_VERSION, startedAt, t: raw.t.map((x) => (isNum(x) && x >= 0 ? Math.round(x) : null)) };
  if (out.t.some((x) => x === null)) return null;
  for (const [key, [lo, hi]] of Object.entries(COLUMNS)) {
    const column = raw[key];
    if (!Array.isArray(column) || column.length !== n) return null;
    out[key] = column.map((x) => {
      if (x === null && NULLABLE.has(key)) return null;
      if (!isNum(x)) return NULLABLE.has(key) ? null : 0;
      return Math.round(clamp(x, lo, hi) * 1000) / 1000;
    });
  }
  return out;
}

/** Batches → one list of samples in time order. skewMs moves them from the candidate's clock to the server's. */
export function flattenBatches(batches, skewMs = 0) {
  const samples = [];
  for (const batch of batches) {
    for (let i = 0; i < batch.t.length; i += 1) {
      const sample = { at: batch.startedAt + batch.t[i] + skewMs };
      for (const key of Object.keys(COLUMNS)) sample[key] = batch[key][i];
      sample.face = batch.f[i] > 0;
      samples.push(sample);
    }
  }
  return samples.sort((a, b) => a.at - b.at);
}

/**
 * The candidate's clock may be off. Each stored batch carries the server's receive time; the median
 * difference between that and the batch's own last timestamp is the skew (plus a little upload time).
 * Anything over ten minutes is a broken clock or a replay, and is ignored.
 */
export function estimateSkew(stored) {
  const diffs = stored
    .filter((b) => isNum(b.receivedAt) && b.batch?.t?.length)
    .map((b) => b.receivedAt - (b.batch.startedAt + b.batch.t.at(-1)));
  if (!diffs.length) return 0;
  diffs.sort((a, b) => a - b);
  const median = diffs[Math.floor(diffs.length / 2)];
  return Math.abs(median) > 10 * 60 * 1000 ? 0 : Math.max(0, median - 2000);
}

// ─── The candidate's usual posture ───

export const ZERO_BASELINE = { yaw: 0, pitch: 0, gh: 0.5, bl: 0, n: 0 };
const MIN_BASELINE_SAMPLES = 30;
// A "usual" posture further than this from straight ahead is more likely a person who spent the
// interview looking elsewhere than a camera placed that way, so it is not trusted
const MAX_BASELINE = { yaw: 25, pitch: 25, gh: 0.2 };

function median(values) {
  const sorted = values.filter(isNum).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Where this candidate's head and eyes usually are while the face is in view: the median head pose and
 * iris position. Gaze and eye contact are measured as departures from it.
 */
export function baselineOf(samples) {
  const usable = samples.filter((s) => s.face && isNum(s.yaw) && isNum(s.pitch));
  if (usable.length < MIN_BASELINE_SAMPLES) return { ...ZERO_BASELINE };
  const open = usable.filter((s) => !isNum(s.bl) || s.bl < T.blink); // eyes shut distort the iris position
  const yaw = median(usable.map((s) => s.yaw));
  const pitch = median(usable.map((s) => s.pitch));
  const gh = median(open.map((s) => s.gh)) ?? 0.5;
  return {
    yaw: Math.abs(yaw) > MAX_BASELINE.yaw ? 0 : yaw,
    pitch: Math.abs(pitch) > MAX_BASELINE.pitch ? 0 : pitch,
    gh: Math.abs(gh - 0.5) > MAX_BASELINE.gh ? 0.5 : gh,
    bl: median(usable.map((s) => s.bl)) ?? 0,
    n: usable.length,
  };
}

/** Eyelids this closed count as a blink: fixed, or higher for people whose eyes rest part-closed. */
export function blinkThreshold(baseline) {
  return Math.min(0.75, Math.max(T.blink, (baseline?.bl ?? 0) + 0.25));
}

// ─── Per-sample classification ───

/**
 * Where the candidate is looking, relative to their usual posture: center | left | right | up | down |
 * no_face (as seen on the screen). Sideways uses the head turn plus where the eyes point; up and down
 * use the head tip only, because the iris position within the eye is unreliable whenever the eyelids move.
 */
export function classifyGaze(s, baseline = ZERO_BASELINE) {
  if (!s.face || !isNum(s.yaw) || !isNum(s.pitch)) return "no_face";
  const eyesShut = isNum(s.bl) && s.bl >= T.blink;
  const iris = isNum(s.gh) && !eyesShut ? s.gh - baseline.gh : 0;
  const gazeYaw = s.yaw - baseline.yaw + T.irisDegPerUnit * iris;
  const tip = s.pitch - baseline.pitch;
  const side = Math.abs(gazeYaw) > T.gazeYaw ? Math.sign(gazeYaw) : 0;
  const vertical = Math.abs(tip) > T.gazePitch ? Math.sign(tip) : 0;
  if (!side && !vertical) return "center";
  // The larger departure names the direction
  if (side && (!vertical || Math.abs(gazeYaw) / T.gazeYaw >= Math.abs(tip) / T.gazePitch)) return side > 0 ? "right" : "left";
  return vertical > 0 ? "down" : "up";
}

export const EXPRESSIONS = ["neutral", "happy", "surprised", "concerned", "tense"];

/** neutral | happy | surprised | concerned | tense, from the face's muscle movements. */
export function classifyExpression(s) {
  if (!s.face || !isNum(s.sm)) return null;
  if (s.sm >= T.happy) return "happy";
  if (s.bu >= T.surprise && (s.ew >= 0.3 || s.jo >= 0.3)) return "surprised";
  if (s.fr >= T.concern || (s.bu >= 0.4 && s.sm < 0.1 && s.bd < 0.2)) return "concerned";
  if (s.bd >= T.tense || s.ns >= T.tense || s.mp >= 0.5) return "tense";
  return "neutral";
}

// ─── Aggregation ───

const SAMPLE_FALLBACK_MS = 100; // length given to the last sample of a stretch when nothing follows it

/**
 * Stretches of consecutive samples where `test` holds, as [{ from, to }] in ms. A stretch ends where
 * the next sample (that no longer holds) begins; a gap in sampling ends it right after its last sample.
 */
function stretches(samples, test) {
  const out = [];
  let open = null;
  let previous = null;
  for (const s of samples) {
    const holds = test(s);
    const gap = previous && s.at - previous.at > T.facesGapSec * 1000;
    if (open && (!holds || gap)) {
      out.push({ from: open.from, to: gap ? previous.at + SAMPLE_FALLBACK_MS : s.at });
      open = null;
    }
    if (holds && !open) open = { from: s.at };
    previous = s;
  }
  if (open && previous) out.push({ from: open.from, to: previous.at + SAMPLE_FALLBACK_MS });
  return out;
}

const seconds = (ms) => ms / 1000;

/** How much time the samples cover: the gap to the next sample, but never over the sampling-gap limit. */
function weights(samples) {
  const out = new Array(samples.length).fill(0);
  for (let i = 0; i < samples.length; i += 1) {
    const next = samples[i + 1];
    const dt = next ? next.at - samples[i].at : 0;
    out[i] = dt > 0 && dt <= T.facesGapSec * 1000 ? dt : i > 0 ? Math.min(out[i - 1] || 100, 200) : 100;
  }
  return out;
}

function swings(values, minDeg, maxSec, times) {
  // Count back-and-forth movements: an extreme, then a return of at least minDeg within maxSec
  let count = 0;
  let anchor = null; // { v, at }
  let direction = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (!isNum(v)) {
      anchor = null;
      direction = 0;
      continue;
    }
    if (!anchor) {
      anchor = { v, at: times[i] };
      continue;
    }
    const delta = v - anchor.v;
    if (direction === 0 && Math.abs(delta) >= minDeg) {
      direction = Math.sign(delta);
      anchor = { v, at: times[i] };
    } else if (direction !== 0 && Math.sign(delta) === direction) {
      anchor = { v, at: times[i] };
    } else if (direction !== 0 && Math.abs(delta) >= minDeg) {
      if (times[i] - anchor.at <= maxSec * 1000) count += 1;
      direction = Math.sign(delta);
      anchor = { v, at: times[i] };
    }
  }
  return Math.floor(count / 2); // a nod or shake is a swing and its return
}

function summarise(samples, baseline) {
  const w = weights(samples);
  const total = w.reduce((a, b) => a + b, 0);
  const withFace = samples.map((s, i) => [s, w[i]]).filter(([s]) => s.face);
  const faceTime = withFace.reduce((a, [, x]) => a + x, 0);

  const directions = { center: 0, left: 0, right: 0, up: 0, down: 0, no_face: 0 };
  const expressionTime = Object.fromEntries(EXPRESSIONS.map((e) => [e, 0]));
  let expressionTotal = 0;
  samples.forEach((s, i) => {
    directions[classifyGaze(s, baseline)] += w[i];
    const e = classifyExpression(s);
    if (e) {
      expressionTime[e] += w[i];
      expressionTotal += w[i];
    }
  });

  const away = stretches(samples, (s) => s.face && classifyGaze(s, baseline) !== "center").filter((r) => seconds(r.to - r.from) >= T.lookAwayMinSec);
  const awaySec = away.reduce((a, r) => a + seconds(r.to - r.from), 0);

  // Blinks: closed-eye stretches, counted per time with a face
  const closed = blinkThreshold(baseline);
  const blinks = stretches(samples, (s) => s.face && isNum(s.bl) && s.bl >= closed).filter((r) => seconds(r.to - r.from) <= 1.0).length;

  // Head movement
  const faceSamples = samples.filter((s) => s.face && isNum(s.yaw) && isNum(s.pitch));
  const times = faceSamples.map((s) => s.at);
  let moved = 0;
  let movedTime = 0;
  for (let i = 1; i < faceSamples.length; i += 1) {
    const dt = faceSamples[i].at - faceSamples[i - 1].at;
    if (dt <= 0 || dt > T.facesGapSec * 1000) continue;
    moved += Math.abs(faceSamples[i].yaw - faceSamples[i - 1].yaw) + Math.abs(faceSamples[i].pitch - faceSamples[i - 1].pitch);
    movedTime += dt;
  }
  const degPerSec = movedTime > 0 ? moved / seconds(movedTime) : null;
  const std = (values) => {
    if (values.length < 2) return null;
    const m = avg(values);
    return Math.sqrt(avg(values.map((x) => (x - m) ** 2)));
  };

  const share = (key) => (expressionTotal ? expressionTime[key] / expressionTotal : null);
  const composed = share("neutral") != null ? share("neutral") + share("happy") : null;

  return {
    durationSec: round(seconds(total), 1),
    faceVisibleRate: total ? round(faceTime / total, 4) : 0,
    eyeContact: {
      score: faceTime ? round((directions.center / faceTime) * 100, 1) : null,
      attention: faceTime ? round(((directions.center + directions.up + directions.down) / faceTime) * 100, 1) : null,
      lookAwayCount: away.length,
      longestLookAwaySec: round(away.reduce((m, r) => Math.max(m, seconds(r.to - r.from)), 0), 1),
      totalLookAwaySec: round(awaySec, 1),
      distribution: Object.fromEntries(Object.entries(directions).map(([k, v]) => [k, total ? round((v / total) * 100, 1) : 0])),
    },
    head: {
      movementDegPerSec: round(degPerSec, 1),
      // 100 = very still, 0 = constantly moving (30 deg/s is a lot of fidgeting)
      stability: degPerSec == null ? null : Math.round(clamp(100 - (degPerSec / 30) * 100, 0, 100)),
      nods: swings(faceSamples.map((s) => s.pitch), T.gestureDeg.nod, T.gestureMaxSec, times),
      shakes: swings(faceSamples.map((s) => s.yaw), T.gestureDeg.shake, T.gestureMaxSec, times),
      yawStdDeg: round(std(faceSamples.map((s) => s.yaw)), 1),
      pitchStdDeg: round(std(faceSamples.map((s) => s.pitch)), 1),
      tiltAvgDeg: round(avg(faceSamples.filter((s) => isNum(s.roll)).map((s) => Math.abs(s.roll))), 1),
    },
    blinks: { count: blinks, perMin: faceTime ? round(blinks / (seconds(faceTime) / 60), 1) : null },
    expressions: {
      dominant: expressionTotal ? EXPRESSIONS.reduce((best, e) => (expressionTime[e] > expressionTime[best] ? e : best), "neutral") : null,
      distribution: expressionTotal ? Object.fromEntries(EXPRESSIONS.map((e) => [e, round(expressionTime[e] / expressionTotal, 4)])) : null,
      composure: composed == null ? null : Math.round(clamp(composed * 100, 0, 100)),
      smileRate: share("happy") == null ? null : round(share("happy"), 4),
    },
  };
}

/** Longer stretches with no face, or with a second face in view: reported to the recruiter as integrity signals. */
function integrityFlags(samples, startAt) {
  const rel = (ms) => round(seconds(ms - startAt), 1);
  const absent = stretches(samples, (s) => !s.face).filter((r) => seconds(r.to - r.from) >= T.absentMinSec);
  const multi = stretches(samples, (s) => s.f >= 2).filter((r) => seconds(r.to - r.from) >= T.multiFaceMinSec);
  const events = [
    ...absent.map((r) => ({ type: "face_absent", fromSec: rel(r.from), toSec: rel(r.to), at: new Date(r.from).toISOString(), durationSec: round(seconds(r.to - r.from), 1) })),
    ...multi.map((r) => ({ type: "multiple_faces", fromSec: rel(r.from), toSec: rel(r.to), at: new Date(r.from).toISOString(), durationSec: round(seconds(r.to - r.from), 1) })),
  ].sort((a, b) => a.fromSec - b.fromSec);
  return {
    faceAbsentCount: absent.length,
    faceAbsentSec: round(absent.reduce((a, r) => a + seconds(r.to - r.from), 0), 1),
    multipleFacesCount: multi.length,
    multipleFacesSec: round(multi.reduce((a, r) => a + seconds(r.to - r.from), 0), 1),
    events: events.slice(0, 50),
  };
}

/** One point every `everySec` for the charts: where they looked and what the face showed. */
function timeline(samples, startAt, baseline, everySec = 2) {
  const buckets = new Map();
  for (const s of samples) {
    const k = Math.floor(seconds(s.at - startAt) / everySec);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(s);
  }
  const mode = (list) => {
    const counts = new Map();
    list.forEach((x) => counts.set(x, (counts.get(x) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([k, list]) => ({
    t: k * everySec,
    gaze: mode(list.map((s) => classifyGaze(s, baseline))),
    expression: mode(list.map(classifyExpression).filter(Boolean)),
    yaw: round(avg(list.filter((s) => isNum(s.yaw)).map((s) => s.yaw)), 0),
    pitch: round(avg(list.filter((s) => isNum(s.pitch)).map((s) => s.pitch)), 0),
  }));
}

/**
 * Summary of a whole interview.
 * options.windows: [{ id, startAt, endAt }] — the candidate's answers, as epoch ms, for the
 *   per-answer view and the "while answering" figures.
 */
export function summariseBehavior(samples, { windows = [] } = {}) {
  if (!samples.length) return null;
  const startAt = samples[0].at;
  const baseline = baselineOf(samples);
  const overall = summarise(samples, baseline);

  const perAnswer = windows.map((win) => {
    const inside = samples.filter((s) => s.at >= win.startAt && s.at <= win.endAt);
    if (inside.length < 5) return { id: win.id, startSec: round(seconds(win.startAt - startAt), 1), samples: inside.length };
    const part = summarise(inside, baseline);
    return {
      id: win.id,
      startSec: round(seconds(win.startAt - startAt), 1),
      samples: inside.length,
      durationSec: part.durationSec,
      eyeContact: part.eyeContact.score,
      lookAwayCount: part.eyeContact.lookAwayCount,
      dominantExpression: part.expressions.dominant,
      headMovementDegPerSec: part.head.movementDegPerSec,
    };
  });

  const answering = windows.length
    ? summarise(samples.filter((s) => windows.some((win) => s.at >= win.startAt && s.at <= win.endAt)), baseline)
    : null;

  return {
    version: BEHAVIOR_VERSION,
    startedAt: new Date(startAt).toISOString(),
    sampleCount: samples.length,
    // Their usual head pose and eye position: gaze is measured as departures from it
    baseline: { yawDeg: round(baseline.yaw, 1), pitchDeg: round(baseline.pitch, 1), irisPosition: round(baseline.gh, 2), samples: baseline.n },
    ...overall,
    // The same measures over the moments the candidate was answering (null when there are too few samples)
    answering: answering && answering.durationSec >= 10
      ? { durationSec: answering.durationSec, eyeContact: answering.eyeContact, expressions: answering.expressions, head: answering.head }
      : null,
    integrity: integrityFlags(samples, startAt),
    perAnswer,
    timeline: timeline(samples, startAt, baseline),
  };
}

/** The candidate's answers as epoch windows (the behaviour track is keyed by time, not by recording position). */
export function answerWindows(turns) {
  return turns
    .filter((t) => t.speaker === "candidate" && t.startedAt && t.endedAt)
    .map((t) => ({ id: `turn-${t.seq}`, startAt: new Date(t.startedAt).getTime(), endAt: new Date(t.endedAt).getTime() }))
    .filter((win) => win.endAt > win.startAt);
}

/**
 * Read every uploaded batch for an interview: { stored: [{ receivedAt, batch }], unavailable }.
 * `stored` is empty when there is nothing (camera off, tracking disabled, or the model could not
 * load in the candidate's browser, in which case `unavailable` says why).
 * deps: { list, read } — injectable for tests.
 */
export async function loadBehavior(interviewId, { list = listKeys, read = getObjectBuffer } = {}) {
  let keys = [];
  try {
    keys = (await list(behaviorPrefix(interviewId))).filter((k) => /\/\d+\.json$/.test(k)).sort();
  } catch {
    return { stored: [], unavailable: null };
  }
  const stored = [];
  let unavailable = null;
  for (const key of keys) {
    try {
      const doc = JSON.parse((await read(key)).toString("utf8"));
      const batch = normaliseBatch(doc.batch);
      if (batch) stored.push({ receivedAt: Number(doc.receivedAt), batch });
      else if (typeof doc.unavailable === "string") unavailable = doc.unavailable;
    } catch {
      // a damaged part is skipped; the rest still counts
    }
  }
  return { stored, unavailable: stored.length ? null : unavailable };
}

export async function loadBehaviorBatches(interviewId, deps) {
  return (await loadBehavior(interviewId, deps)).stored;
}
