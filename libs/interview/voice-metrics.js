// Speaking pace and fluency from the candidate's recording: pauses, filler words, words per minute.
// Same definitions as the AI engine's voice analysis (services/ai-engine/core/voice.py), computed in
// Node so the communication score doesn't depend on the Python service being up. Pitch-based
// measures (jitter, shimmer) need the Python side and feed no score, so they are left null here.
// Relative imports only — runs in the hiring worker.

const FRAME_SEC = 0.025;
const HOP_SEC = 0.01;
const MIN_PAUSE_SEC = 0.2;
export const LONG_PAUSE_SEC = 2.0;
const SILENCE_FRACTION = 0.1;     // frames below this share of the loud-speech level are silence
const ABSOLUTE_FLOOR = 0.008;     // RMS below this is never speech (room noise)
const MIN_LOUD_RUN_FRAMES = 4;    // a click shorter than 40 ms isn't speech
// An answer's window starts a little early and ends where the answer was saved. The saved end
// already includes the silence that finished the answer, so a recording that started a few
// seconds before the engine's clock is still covered.
const WINDOW_LEAD_SEC = 0.5;

const FILLERS = {
  um: ["um", "umm", "ummm"],
  uh: ["uh", "uhh", "uhhh"],
  ah: ["ah", "ahh", "ahhh"],
  hmm: ["hmm", "hmmm", "hm"],
  like: ["like"],
  you_know: ["you know", "ya know"],
  well: ["well"],
  so: ["so"],
  actually: ["actually"],
  er: ["er", "err"],
  erm: ["erm"],
};
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const FILLER_PATTERNS = Object.entries(FILLERS).map(([name, variants]) => [name, variants.map((v) => new RegExp(`(?<![a-z'])${escape(v)}(?![a-z'])`, "g"))]);

export function countFillers(text) {
  if (!text) return { total: 0, breakdown: {} };
  const lower = String(text).toLowerCase();
  const breakdown = {};
  for (const [name, patterns] of FILLER_PATTERNS) {
    const n = patterns.reduce((sum, p) => sum + (lower.match(p)?.length || 0), 0);
    if (n) breakdown[name] = n;
  }
  return { total: Object.values(breakdown).reduce((a, b) => a + b, 0), breakdown };
}

export const countWords = (text) => String(text || "").split(/\s+/).filter(Boolean).length;

/** Per-frame RMS (25 ms frames, 10 ms hop). */
export function frameRms(samples, rate) {
  const frame = Math.max(1, Math.round(FRAME_SEC * rate));
  const hop = Math.max(1, Math.round(HOP_SEC * rate));
  const frames = Math.max(0, Math.floor((samples.length - frame) / hop) + 1);
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    const start = f * hop;
    for (let i = 0; i < frame; i += 1) sum += samples[start + i] * samples[start + i];
    rms[f] = Math.sqrt(sum / frame);
  }
  return rms;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/**
 * Speech within one stretch of audio: which part is voiced, and the pauses inside it.
 * Silence before the first word and after the last one is not a pause (it is the candidate
 * thinking, or waiting for the interviewer), so only the voiced span is measured.
 * Returns { spanSec, pauseSec, pauseCount, longPauses, longestPauseSec, hasSpeech }.
 */
export function analyseSpeech(samples, rate) {
  const empty = { spanSec: 0, pauseSec: 0, pauseCount: 0, longPauses: 0, longestPauseSec: 0, hasSpeech: false };
  const rms = frameRms(samples, rate);
  if (!rms.length) return empty;
  const loudLevel = percentile(rms, 90);
  if (loudLevel < ABSOLUTE_FLOOR * 1.5) return empty;
  const threshold = Math.max(percentile(rms, 10), SILENCE_FRACTION * loudLevel, ABSOLUTE_FLOOR);

  // Loud frames, minus runs too short to be speech
  const loud = new Uint8Array(rms.length);
  let runStart = -1;
  for (let i = 0; i <= rms.length; i += 1) {
    const isLoud = i < rms.length && rms[i] >= threshold;
    if (isLoud && runStart < 0) runStart = i;
    if (!isLoud && runStart >= 0) {
      if (i - runStart >= MIN_LOUD_RUN_FRAMES) loud.fill(1, runStart, i);
      runStart = -1;
    }
  }
  const first = loud.indexOf(1);
  const last = loud.lastIndexOf(1);
  if (first < 0) return empty;

  const pauses = [];
  let silentFrom = -1;
  for (let i = first; i <= last + 1; i += 1) {
    const silent = i <= last && !loud[i];
    if (silent && silentFrom < 0) silentFrom = i;
    if (!silent && silentFrom >= 0) {
      const length = (i - silentFrom) * HOP_SEC;
      if (length >= MIN_PAUSE_SEC) pauses.push(length);
      silentFrom = -1;
    }
  }
  return {
    spanSec: (last - first + 1) * HOP_SEC + (FRAME_SEC - HOP_SEC),
    pauseSec: pauses.reduce((a, b) => a + b, 0),
    pauseCount: pauses.length,
    longPauses: pauses.filter((p) => p >= LONG_PAUSE_SEC).length,
    longestPauseSec: pauses.length ? Math.max(...pauses) : 0,
    hasSpeech: true,
  };
}

const round = (value, digits) => (value == null ? null : Math.round(value * 10 ** digits) / 10 ** digits);

/**
 * Overall and per-answer metrics. segments: [{ id, startMs, endMs, text }] — the candidate's answers
 * on the recording timeline. Same shape as the AI engine's voice result: { overall, segments }.
 */
export function analyseVoice({ samples, rate = 16000, segments = [] }) {
  const slice = (startMs, endMs) => {
    const from = Math.max(0, Math.round((startMs / 1000 - WINDOW_LEAD_SEC) * rate));
    const to = Math.min(samples.length, Math.round((endMs / 1000) * rate));
    return to > from ? samples.subarray(from, to) : samples.subarray(0, 0);
  };

  const per = [];
  const total = { span: 0, pause: 0, count: 0, long: 0, longest: 0, words: 0, fillers: 0, text: [], breakdown: {} };
  for (const seg of segments) {
    const speech = analyseSpeech(slice(seg.startMs, seg.endMs), rate);
    const text = String(seg.text || "").trim();
    const fillers = countFillers(text);
    const speakingSec = speech.spanSec - speech.pauseSec;
    per.push({
      id: seg.id,
      durationSec: round(speech.spanSec, 2),
      wpm: speech.hasSpeech && text && speakingSec > 0 ? round((countWords(text) / speakingSec) * 60, 2) : null,
      fillerCount: text ? fillers.total : null,
      pauseRatio: speech.spanSec > 0 ? round(speech.pauseSec / speech.spanSec, 4) : 0,
    });
    // Words are only counted against audio in which speech was actually found
    if (!speech.hasSpeech) continue;
    total.span += speech.spanSec;
    total.pause += speech.pauseSec;
    total.count += speech.pauseCount;
    total.long += speech.longPauses;
    total.longest = Math.max(total.longest, speech.longestPauseSec);
    if (text) {
      total.text.push(text);
      total.words += countWords(text);
      total.fillers += fillers.total;
      for (const [name, n] of Object.entries(fillers.breakdown)) total.breakdown[name] = (total.breakdown[name] || 0) + n;
    }
  }

  const speakingSec = total.span - total.pause;
  const minutes = total.span / 60;
  const hasTranscript = total.text.length > 0;
  const top = Object.entries(total.breakdown).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name);
  return {
    overall: {
      source: "audio",
      durationSec: round(total.span, 2),
      wpm: hasTranscript && speakingSec > 0 ? round((total.words / speakingSec) * 60, 2) : null,
      pauseRatio: total.span > 0 ? round(total.pause / total.span, 4) : null,
      pauseCount: total.count,
      longPauses: total.long,
      longestPauseSec: round(total.longest, 3),
      fillerPerMin: hasTranscript && minutes > 0 ? round(total.fillers / minutes, 2) : null,
      fillerTop: top,
      jitter: null,
      shimmer: null,
      pitchMean: null,
      hasTranscript,
    },
    segments: per,
  };
}

const ASSUMED_WPM = 130; // typical conversational pace, only used when there is no audio to measure

/**
 * Without any audio only the words themselves can be judged: filler words. Pace and pauses need
 * the recording, so they stay null (and the communication score leaves them out). The filler
 * rate per minute is an estimate from an assumed pace, and is flagged as one.
 */
export function analyseTranscriptOnly(segments = []) {
  const texts = segments.map((s) => String(s.text || "").trim()).filter(Boolean);
  if (!texts.length) return null;
  const joined = texts.join(" ");
  const fillers = countFillers(joined);
  const top = Object.entries(fillers.breakdown).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name);
  const per100 = (fillers.total / Math.max(1, countWords(joined))) * 100;
  return {
    overall: {
      source: "transcript",
      estimated: true,
      durationSec: null,
      wpm: null,
      pauseRatio: null,
      pauseCount: null,
      longPauses: null,
      longestPauseSec: null,
      fillerPerMin: round((per100 * ASSUMED_WPM) / 100, 2),
      fillerTop: top,
      jitter: null,
      shimmer: null,
      pitchMean: null,
      hasTranscript: true,
    },
    segments: [],
  };
}
