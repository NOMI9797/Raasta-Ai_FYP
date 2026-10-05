// Stage 2, part 1: assemble the recording and analyse it (docs/ai-hiring/11-stage2-evaluation.md §1).
// Each ai-engine analysis is independent: a failure is recorded in analysis.errors, never fatal.
// Relative imports only — runs in the hiring worker.
import { asc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { interviewTurns, interviews } from "../schema";
import { listKeys } from "../hiring/storage";
import { createAnalysisClient } from "./analysis-client";

export const ANALYSIS_VERSION = 1;
export const RECORDING_WAIT_MS = 10 * 60 * 1000; // then continue with what was uploaded
export const KINDS = ["audio", "video"];

export function recordingPrefix(interviewId, kind) {
  return `recordings/${interviewId}/${kind}/`;
}

export function recordingKey(interviewId, kind) {
  return `recordings/${interviewId}/${kind}.webm`;
}

function defaults(deps = {}) {
  return {
    database: deps.database || db,
    client: deps.client || createAnalysisClient(),
    list: deps.list || listKeys,
    now: deps.now || (() => new Date()),
    faceEnabled: deps.faceEnabled ?? process.env.FACE_ANALYSIS_ENABLED === "true",
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
 * or failed when nothing could be assembled. Idempotent.
 */
export async function assembleRecording(interviewId, { kind = null } = {}, deps) {
  const d = defaults(deps);
  const [interview] = await d.database.select({ id: interviews.id }).from(interviews).where(eq(interviews.id, interviewId)).limit(1);
  if (!interview) return { skipped: "not found" };

  const KEY_COLUMN = { audio: "recordingAudioKey", video: "recordingVideoKey" };
  const hasParts = {};
  const errors = {};
  for (const k of KINDS) {
    const parts = await partKeys(d.list, interviewId, k);
    hasParts[k] = parts.length > 0;
    if (!hasParts[k] || (kind && kind !== k)) continue;
    try {
      const result = await d.client.concat(recordingPrefix(interviewId, k), recordingKey(interviewId, k));
      // Write only this kind's key: the audio and video jobs run concurrently
      await d.database.update(interviews)
        .set({ [KEY_COLUMN[k]]: result.outKey, updatedAt: d.now() })
        .where(eq(interviews.id, interviewId));
    } catch (error) {
      errors[k] = error.message;
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
  return { interviewId, status: row.status, keys: { audio: row.audio, video: row.video }, errors };
}

/**
 * Candidate answer spans on the recording timeline: [{ id, startMs, endMs, text }].
 * offsetMs counts from the interview start; spans are approximate after a reconnect.
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
  if (interview.recordingStatus !== "complete" && !waitedLongEnough) {
    // Uploads may still be finishing; the parts are assembled when the final one arrives
    return { waiting: true };
  }
  if (interview.recordingStatus !== "complete") {
    // Waited long enough: assemble whatever was uploaded (the final part may never come)
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
  const hasVideo = videoKey ? { ok: true } : { ok: false, reason: "no video recording" };

  const [voice, emotion, gaze, face] = await Promise.all([
    run("voice", hasAudio.ok ? hasSegments : hasAudio, () => d.client.voice(audioKey, segments)),
    run("emotion", hasAudio.ok ? hasSegments : hasAudio, () => d.client.emotion(audioKey, segments)),
    run("gaze", hasVideo, () => d.client.gaze(videoKey)),
    run("face", d.faceEnabled ? hasVideo : { ok: false, reason: "disabled" }, () => d.client.face(videoKey)),
  ]);

  const media = !audioKey && !videoKey ? "missing" : interview.recordingStatus === "complete" ? "ok" : "partial";
  const analysis = {
    voice: voice ? pick(voice.overall, ["wpm", "pauseRatio", "pauseCount", "longPauses", "longestPauseSec", "fillerPerMin", "fillerTop", "jitter", "shimmer", "pitchMean", "durationSec", "hasTranscript"]) : null,
    voiceSegments: voice?.segments || [],
    emotion: emotion ? pick(emotion, ["dominant", "distribution", "confidenceAvg"]) : null,
    emotionSegments: emotion?.segments || [],
    gaze: gaze ? pick(gaze, ["eyeContactScore", "attentionScore", "lookAwayCount", "longestLookAwaySec", "faceDetectionRate"]) : null,
    gazeTimeline: gaze?.timeline || [],
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
