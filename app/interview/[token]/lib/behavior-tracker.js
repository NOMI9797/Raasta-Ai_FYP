// Live camera behaviour tracking for the interview room: MediaPipe face landmarks run in the
// browser on the candidate's own camera, and only small JSON batches of numbers are uploaded
// (head pose, gaze, facial muscle scores). No frame or image is ever sent by this module.
// If the model can't load (blocked, offline, unsupported GPU), the interview carries on and the
// recruiter's report says tracking was unavailable.
import { sampleFromResult, toBatch } from "./behavior-features";

const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/mediapipe/face_landmarker.task";
const FLUSH_MS = 15 * 1000;
const MIN_INTERVAL_MS = 100;   // 10 samples a second at best
const MAX_INTERVAL_MS = 400;
const MAX_BUFFER = 2400;       // 4 minutes at 10 Hz: if uploads stall, keep the newest

/** Load the face model. Tries the GPU first, then the CPU. Resolves a landmarker, or throws. */
export async function loadFaceLandmarker({ numFaces = 2 } = {}) {
  const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_PATH, delegate },
    runningMode: "VIDEO",
    numFaces,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
  try {
    return await FaceLandmarker.createFromOptions(fileset, options("GPU"));
  } catch {
    return FaceLandmarker.createFromOptions(fileset, options("CPU"));
  }
}

function hiddenVideo(stream) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream(stream.getVideoTracks());
  return video;
}

/**
 * createBehaviorTracker({ stream, queue, firstPart, onState }) → { start(), stop() }
 * Samples go to the upload queue as kind "behavior" (JSON). onState(status): loading | running | unavailable.
 */
export function createBehaviorTracker({ stream, queue, firstPart = 0, onState = () => {} }) {
  let landmarker = null;
  let video = null;
  let timer = null;
  let flushTimer = null;
  let stopped = false;
  let samples = [];
  let part = firstPart;
  let startedAt = Date.now();
  let lastVideoTime = -1;
  let lastStamp = 0;
  let inferenceMs = 0;

  function flush({ final = false } = {}) {
    if (!samples.length && !final) return;
    const body = samples.length ? toBatch(samples, startedAt) : null;
    samples = [];
    if (!body) return;
    queue.add({ kind: "behavior", part: part++, final, blob: new Blob([JSON.stringify(body)], { type: "application/json" }) });
  }

  function tick() {
    if (stopped) return;
    // A hidden tab gets no new video frames; leave a gap instead of recording "no face"
    if (!document.hidden && video && video.readyState >= 2 && video.videoWidth > 0 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      try {
        const began = performance.now();
        const stamp = Math.max(lastStamp + 1, Math.round(began));
        lastStamp = stamp;
        const result = landmarker.detectForVideo(video, stamp);
        inferenceMs = inferenceMs ? inferenceMs * 0.8 + (performance.now() - began) * 0.2 : performance.now() - began;
        samples.push({ at: Date.now(), ...sampleFromResult(result) });
        if (samples.length > MAX_BUFFER) samples.splice(0, samples.length - MAX_BUFFER);
      } catch {
        // one bad frame is not worth stopping for
      }
    }
    // Slow machines sample less often rather than starve the recording and the audio
    const interval = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, inferenceMs * 2.5));
    timer = setTimeout(tick, interval);
  }

  return {
    async start() {
      if (!stream?.getVideoTracks().length) {
        onState("unavailable", { reason: "no camera" });
        return false;
      }
      onState("loading");
      try {
        landmarker = await loadFaceLandmarker();
        if (stopped) {
          landmarker.close();
          return false;
        }
        video = hiddenVideo(stream);
        await video.play();
      } catch (error) {
        const reason = String(error?.message || error).slice(0, 160);
        // Tell the server why there is no track, so the report can say so
        queue.add({ kind: "behavior", part: part++, final: false, blob: new Blob([JSON.stringify({ v: 1, unavailable: reason })], { type: "application/json" }) });
        onState("unavailable", { reason });
        return false;
      }
      startedAt = Date.now();
      flushTimer = setInterval(() => flush(), FLUSH_MS);
      onState("running");
      tick();
      return true;
    },
    /** Upload what is left. Safe to call more than once. */
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      clearInterval(flushTimer);
      flush({ final: true });
      try { landmarker?.close(); } catch { /* already closed */ }
      if (video) {
        video.pause();
        video.srcObject = null;
      }
    },
  };
}
