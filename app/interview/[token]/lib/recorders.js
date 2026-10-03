// Interview recording: an audio-only recorder and (if enabled) a video+audio recorder, 10 s parts
// uploaded through the UploadQueue. The last part of each kind is uploaded with final=true.

const TIMESLICE_MS = 10 * 1000;

function pickType(candidates) {
  if (typeof MediaRecorder === "undefined") return null;
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

function startOne(stream, { kind, mimeType, bitsPerSecond, queue, firstPart = 0 }) {
  const options = {};
  if (mimeType) options.mimeType = mimeType;
  if (bitsPerSecond) options.bitsPerSecond = bitsPerSecond;
  const recorder = new MediaRecorder(stream, options);
  let part = firstPart;
  let held = null; // keep one part back so the last one can be marked final

  recorder.ondataavailable = (event) => {
    if (!event.data || event.data.size === 0) return;
    if (held) queue.add({ kind, part: part++, blob: held });
    held = event.data;
  };
  const stopped = new Promise((resolve) => {
    recorder.onstop = () => {
      // Always send a final part so the server knows the recording is complete
      queue.add({ kind, part: part++, final: true, blob: held || new Blob([], { type: "video/webm" }) });
      held = null;
      resolve();
    };
  });
  recorder.start(TIMESLICE_MS);
  return {
    stop() {
      if (recorder.state !== "inactive") recorder.stop();
      return stopped;
    },
  };
}

/**
 * Start recording. firstPart: { audio, video } — continue numbering after a page reload.
 * Returns { stop(): Promise } — resolves when the final parts are queued.
 */
export function startRecorders(stream, { recordVideo, queue, firstPart = {} }) {
  const recorders = [];
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length) {
    recorders.push(startOne(new MediaStream(audioTracks), {
      kind: "audio",
      mimeType: pickType(["audio/webm;codecs=opus", "audio/webm"]),
      queue,
      firstPart: firstPart.audio || 0,
    }));
  }
  if (recordVideo && stream.getVideoTracks().length) {
    recorders.push(startOne(stream, {
      kind: "video",
      mimeType: pickType(["video/webm;codecs=vp8,opus", "video/webm"]),
      bitsPerSecond: 1_000_000,
      queue,
      firstPart: firstPart.video || 0,
    }));
  }
  return {
    stop: () => Promise.all(recorders.map((r) => r.stop())),
  };
}
