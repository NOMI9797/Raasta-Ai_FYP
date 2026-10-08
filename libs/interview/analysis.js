// Stage 2, part 1: assemble the recording and analyse it (docs/ai-hiring/11-stage2-evaluation.md §1).
//
// What is measured, and where it runs:
//   recording   joined from the uploaded parts with ffmpeg in this process (media-tools.js); the Python
//               AI engine is only a fallback when ffmpeg isn't available here
//   pace, fluency  from the audio and the transcript, in Node (voice-metrics.js)
//   eye contact, head movement, expressions  from the camera track the candidate's browser uploaded
//               (behavior.js); the AI engine's video analysis is only used when there is no track
//   tone of voice  the speech-emotion model in the AI engine (optional)
// Each analysis is independent: a failure is recorded in analysis.errors and never stops the others.
// Relative imports only — runs in the hiring worker.
import { and, asc, eq, like, sql } from "drizzle-orm";
import { db } from "../db";
import { interviewTurns, interviews } from "../schema";
import { listKeys } from "../hiring/storage";
import { createAnalysisClient } from "./analysis-client";
import { MediaToolError, concatInStorage, decodeStoredAudio } from "./media-tools";
import { analyseTranscriptOnly, analyseVoice } from "./voice-metrics";
import { answerWindows, estimateSkew, flattenBatches, loadBehavior, summariseBehavior } from "./behavior";

export const ANALYSIS_VERSION = 2;
export const RECORDING_WAIT_MS = 10 * 60 * 1000; // then continue with what was uploaded
export const KINDS = ["audio", "video"];
export const RECORDING_ERROR_PREFIX = "recording_failed";

export function recordingPrefix(interviewId, kind) {
  return `recordings/${interviewId}/${kind}/`;
}

export function recordingKey(interviewId, kind) {
  return `recordings/${interviewId}/${kind}.webm`;
}

/** The recording could not be put together. retryable: false means trying again can't help (no ffmpeg, damaged data). */
export class RecordingError extends Error {
  constructor(message, { retryable = true } = {}) {
    super(message);
    this.name = "RecordingError";
    this.retryable = retryable;
  }
}

/**
 * Join the parts under prefix into outKey: ffmpeg here first, then the AI engine if ffmpeg isn't
 * installed on this machine.
 */
async function joinRecordingParts(prefix, outKey, { list, client }) {
  try {
    return await concatInStorage(prefix, outKey, { list });
  } catch (error) {
    if (!(error instanceof MediaToolError) || error.code !== "ffmpeg_missing") throw error;
    try {
      return await client.concat(prefix, outKey);
    } catch (engineError) {
      throw new MediaToolError(`${error.message} The AI engine couldn't join it either (${engineError.message}).`, { code: "ffmpeg_missing" });
    }
  }
}

function defaults(deps = {}) {
  const database = deps.database || db;
  const client = deps.client || createAnalysisClient();
  const list = deps.list || listKeys;
  return {
    database,
    client,
    list,
    now: deps.now || (() => new Date()),
    faceEnabled: deps.faceEnabled ?? process.env.FACE_ANALYSIS_ENABLED === "true",
    concat: deps.concat || ((prefix, outKey) => joinRecordingParts(prefix, outKey, { list, client })),
    decode: deps.decode || ((key) => decodeStoredAudio(key)),
    loadBehavior: deps.loadBehavior || ((interviewId) => loadBehavior(interviewId, { list })),
  };
}

async function partKeys(list, interviewId, kind) {
  try {
    return (await list(recordingPrefix(interviewId, kind))).filter((k) => /\/\d+\.webm$/.test(k));
  } catch {
    return [];
  }
}

/**
 * Join the uploaded parts of each kind (or only `kind`) into recordings/{id}/{kind}.webm.
 * recording_status becomes complete once audio (and video, if any parts exist) is assembled,
 * or failed when nothing could be assembled. Idempotent. A failure is written to the interview's
 * error message so the recruiter sees why, and removed again once the recording is complete.
 * options.strict: throw a RecordingError when a join failed, so the worker retries (or gives up
 * at once when retrying can't help). The analysis calls it without, and carries on with what exists.
 */
export async function assembleRecording(interviewId, { kind = null, strict = false } = {}, deps) {
  const d = defaults(deps);
  const [interview] = await d.database.select({ id: interviews.id }).from(interviews).where(eq(interviews.id, interviewId)).limit(1);
  if (!interview) return { skipped: "not found" };

  const KEY_COLUMN = { audio: "recordingAudioKey", video: "recordingVideoKey" };
  const hasParts = {};
  const errors = {};
  const causes = [];
  for (const k of KINDS) {
    const parts = await partKeys(d.list, interviewId, k);
    hasParts[k] = parts.length > 0;
    if (!hasParts[k] || (kind && kind !== k)) continue;
    try {
      const result = await d.concat(recordingPrefix(interviewId, k), recordingKey(interviewId, k));
      // Write only this kind's key: the audio and video jobs run concurrently
      await d.database.update(interviews)
        .set({ [KEY_COLUMN[k]]: result.outKey, updatedAt: d.now() })
        .where(eq(interviews.id, interviewId));
    } catch (error) {
      errors[k] = error.message;
      causes.push(error);
    }
  }

  // Status computed in one statement from the row's current keys, so the concurrent audio and
  // video jobs can't overwrite each other's result; "complete" is never downgraded.
  const noVideo = !hasParts.video;
  const failedNow = (!hasParts.audio && !hasParts.video) || Object.keys(errors).length > 0;
  const [row] = await d.database.update(interviews).set({
    recordingStatus: sql`case
      when ${interviews.recordingAudioKey} is not null and (${noVideo}::boolean or ${interviews.recordingVideoKey} is not null) then 'complete'
      when ${interviews.recordingStatus} = 'complete' then 'complete'
      when ${failedNow}::boolean and ${interviews.recordingAudioKey} is null and ${interviews.recordingVideoKey} is null then 'failed'
      else 'uploading' end`,
    updatedAt: d.now(),
  }).where(eq(interviews.id, interviewId))
    .returning({ status: interviews.recordingStatus, audio: interviews.recordingAudioKey, video: interviews.recordingVideoKey });

  if (Object.keys(errors).length) {
    const message = `${RECORDING_ERROR_PREFIX}: ${Object.entries(errors).map(([k, m]) => `${k}: ${m}`).join("; ")}`.slice(0, 300);
    await d.database.update(interviews).set({ errorMessage: message }).where(eq(interviews.id, interviewId));
  } else if (row.status === "complete") {
    await d.database.update(interviews).set({ errorMessage: null })
      .where(and(eq(interviews.id, interviewId), like(interviews.errorMessage, `${RECORDING_ERROR_PREFIX}%`)));
  }

  if (strict && causes.length) {
    const hopeless = causes.every((e) => e instanceof MediaToolError && ["ffmpeg_missing", "no_header"].includes(e.code));
    throw new RecordingError(Object.values(errors).join("; "), { retryable: !hopeless });
  }
  return { interviewId, status: row.status, keys: { audio: row.audio, video: row.video }, errors };
}

/**
 * Candidate answer spans on the recording timeline: [{ id, startMs, endMs, text }].
 * offsetMs counts from the interview start without the time spent disconnected (the recorder
 * isn't running then either); interviews saved before that rule are approximate after a reload.
 */
export function buildSegments(turns) {
  return turns
    .filter((t) => t.speaker === "candidate" && t.offsetMs != null)
    .map((t) => {
      const startMs = Math.max(0, Math.round(t.offsetMs));
      const lengthMs = t.endedAt && t.startedAt ? new Date(t.endedAt) - new Date(t.startedAt) : 0;
      return { id: `turn-${t.seq}`, startMs, endMs: startMs + Math.max(0, Math.round(lengthMs)), text: t.text || "" };
    })
    .filter((s) => s.endMs > s.startMs);
}

/** Tab switches: count and total hidden seconds (hidden → visible pairs; an open one runs to endedAt). */
export function summariseIntegrity(events, endedAt) {
  const list = (Array.isArray(events) ? events : [])
    .filter((e) => e && e.at)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  let hiddenSince = null;
  let count = 0;
  let hiddenMs = 0;
  for (const e of list) {
    if (e.type === "tab_hidden" && hiddenSince === null) {
      hiddenSince = new Date(e.at).getTime();
      count += 1;
    } else if (e.type === "tab_visible" && hiddenSince !== null) {
      hiddenMs += Math.max(0, new Date(e.at).getTime() - hiddenSince);
      hiddenSince = null;
    }
  }
  if (hiddenSince !== null && endedAt) hiddenMs += Math.max(0, new Date(endedAt).getTime() - hiddenSince);
  return {
    tabHiddenCount: count,
    tabHiddenSec: Math.round(hiddenMs / 1000),
    micMutedCount: list.filter((e) => e.type === "mic_muted").length,
    offlineCount: list.filter((e) => e.type === "net_offline").length,
    // Times the interviewer had to remind the candidate that the interview is English only
    languageNoticeCount: list.filter((e) => e.type === "non_english_speech").length,
  };
}

/** The worker gave up: analysis_status failed (the error is kept for the recruiter, without media content). */
export async function markAnalysisFailed(interviewId, message, deps) {
  const d = defaults(deps);
  await d.database.update(interviews)
    .set({ analysisStatus: "failed", errorMessage: `analysis_failed: ${String(message).slice(0, 300)}`, updatedAt: d.now() })
    .where(eq(interviews.id, interviewId));
}

function pick(object, keys) {
  return object ? Object.fromEntries(keys.filter((k) => k in object).map((k) => [k, object[k]])) : null;
}

/**
 * Eye contact in the shape the communication score reads. While the candidate is answering is what
 * matters to an interviewer; when there are too few answering samples the whole interview is used.
 */
export function gazeFromBehavior(behavior) {
  if (!behavior) return null;
  const scope = behavior.answering ? "answering" : "interview";
  const eye = behavior.answering ? behavior.answering.eyeContact : behavior.eyeContact;
  return {
    eyeContactScore: eye.score,
    attentionScore: eye.attention,
    lookAwayCount: eye.lookAwayCount,
    longestLookAwaySec: eye.longestLookAwaySec,
    faceDetectionRate: behavior.faceVisibleRate,
    scope,
    source: "camera",
  };
}

/**
 * Analyse a completed interview. Returns
 *   { waiting: true } — the recording is still uploading (the caller re-queues), or
 *   { analysis } — stored in interviews.analysis with analysis_status complete.
 * options.force: re-run even if already complete.
 */
export async function analyseInterview(interviewId, { force = false } = {}, deps) {
  const d = defaults(deps);
  let [interview] = await d.database.select().from(interviews).where(eq(interviews.id, interviewId)).limit(1);
  if (!interview) return { skipped: "not found" };
  if (interview.status !== "completed") return { skipped: `interview is ${interview.status}` };
  // The recruiter deleted the recording: keep the stored scores instead of recomputing from nothing
  if (interview.recordingStatus === "deleted") return { skipped: "recording deleted", analysis: interview.analysis };
  if (interview.analysisStatus === "complete" && !force) return { skipped: "already analysed", analysis: interview.analysis };

  const endedAt = new Date(interview.endedAt || interview.updatedAt).getTime();
  const waitedLongEnough = d.now().getTime() - endedAt >= RECORDING_WAIT_MS;
  // Parts may still be arriving (status none/uploading): wait. A failed join won't fix itself by waiting.
  if (interview.recordingStatus !== "complete" && interview.recordingStatus !== "failed" && !waitedLongEnough) {
    return { waiting: true };
  }
  if (interview.recordingStatus !== "complete") {
    // Assemble whatever was uploaded (the final part may never come, or an earlier join failed)
    await assembleRecording(interviewId, {}, deps);
    [interview] = await d.database.select().from(interviews).where(eq(interviews.id, interviewId)).limit(1);
  }

  await d.database.update(interviews).set({ analysisStatus: "processing", updatedAt: d.now() }).where(eq(interviews.id, interviewId));

  const turns = await d.database.select().from(interviewTurns)
    .where(eq(interviewTurns.interviewId, interviewId))
    .orderBy(asc(interviewTurns.seq));
  const segments = buildSegments(turns);
  const audioKey = interview.recordingAudioKey;
  const videoKey = interview.recordingVideoKey;

  const errors = {};
  const run = async (name, enabled, call) => {
    if (!enabled.ok) {
      errors[name] = enabled.reason;
      return null;
    }
    try {
      return await call();
    } catch (error) {
      errors[name] = error.code === "disabled" ? "disabled" : error.message;
      return null;
    }
  };
  const hasAudio = audioKey ? { ok: true } : { ok: false, reason: "no audio recording" };
  const hasSegments = segments.length ? { ok: true } : { ok: false, reason: "no answer segments" };

  // Speaking pace and fluency: from the recording here; the AI engine's analysis if decoding fails;
  // the transcript alone (filler words only) when there is no usable audio at all
  let voice = await run("voice", hasAudio.ok ? hasSegments : hasAudio, async () => {
    try {
      const { samples, rate } = await d.decode(audioKey);
      return analyseVoice({ samples, rate, segments });
    } catch (error) {
      try {
        return await d.client.voice(audioKey, segments);
      } catch (engineError) {
        throw new Error(`${error.message}; AI engine: ${engineError.message}`);
      }
    }
  });
  if (!voice) voice = analyseTranscriptOnly(segments);

  // Behaviour from the camera track the browser uploaded
  const track = await d.loadBehavior(interviewId).catch(() => ({ stored: [], unavailable: null }));
  let behavior = null;
  if (track.stored.length) {
    const samples = flattenBatches(track.stored.map((s) => s.batch), estimateSkew(track.stored));
    behavior = summariseBehavior(samples, { windows: answerWindows(turns) });
  } else {
    errors.behavior = track.unavailable
      ? `camera tracking couldn't start in the candidate's browser (${track.unavailable})`
      : "no camera tracking data";
  }

  const [emotion, videoGaze, face] = await Promise.all([
    run("emotion", hasAudio.ok ? hasSegments : hasAudio, () => d.client.emotion(audioKey, segments)),
    // The AI engine's video analysis is the fallback for interviews without a camera track
    behavior ? null : run("gaze", videoKey ? { ok: true } : { ok: false, reason: "no video recording" }, () => d.client.gaze(videoKey)),
    run("face", d.faceEnabled ? (videoKey ? { ok: true } : { ok: false, reason: "no video recording" }) : { ok: false, reason: "disabled" }, () => d.client.face(videoKey)),
  ]);
  const gaze = behavior ? gazeFromBehavior(behavior) : videoGaze && { ...pick(videoGaze, ["eyeContactScore", "attentionScore", "lookAwayCount", "longestLookAwaySec", "faceDetectionRate"]), source: "video" };
  if (behavior) delete errors.gaze;

  const media = !audioKey && !videoKey ? "missing" : interview.recordingStatus === "complete" ? "ok" : "partial";
  const analysis = {
    voice: voice ? pick(voice.overall, ["source", "estimated", "wpm", "pauseRatio", "pauseCount", "longPauses", "longestPauseSec", "fillerPerMin", "fillerTop", "jitter", "shimmer", "pitchMean", "durationSec", "hasTranscript"]) : null,
    voiceSegments: voice?.segments || [],
    emotion: emotion ? pick(emotion, ["dominant", "distribution", "confidenceAvg"]) : null,
    emotionSegments: emotion?.segments || [],
    gaze,
    gazeTimeline: behavior ? [] : videoGaze?.timeline || [],
    behavior,
    face: face ? pick(face, ["dominant", "distribution", "facesAnalyzed"]) : null,
    integrity: summariseIntegrity(interview.integrityEvents, interview.endedAt),
    media,
    segments: segments.length,
    errors,
    version: ANALYSIS_VERSION,
    analysedAt: d.now().toISOString(),
  };

  await d.database.update(interviews).set({ analysis, analysisStatus: "complete", updatedAt: d.now() }).where(eq(interviews.id, interviewId));
  return { interviewId, candidateId: interview.candidateId, analysis };
}
