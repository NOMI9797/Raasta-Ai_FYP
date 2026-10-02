// Fallback speech-to-text: buffer PCM, cut on 700 ms of low energy or at 15 s, send each chunk as a
// WAV to Groq Whisper (docs/ai-hiring/09-interview-engine.md). Finals only, no partials.
// Relative imports only.
import { transcribe as groqTranscribe } from "../../ai/llm";

const BYTES_PER_SAMPLE = 2; // PCM signed 16-bit little-endian, mono
const ACTIVITY_EVERY_MS = 250;

export function pcmToWav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function frameRms(pcm) {
  const samples = Math.floor(pcm.length / BYTES_PER_SAMPLE);
  if (!samples) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const v = pcm.readInt16LE(i * BYTES_PER_SAMPLE) / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / samples);
}

/**
 * createWhisperStt({ onFinal, onError, onClose }) → { write(pcm), keepAlive(), close() }
 * onFinal(text, { startMs, endMs }) — offsets from the start of the stream.
 */
export function createWhisperStt(
  { onFinal, onError, onClose, onActivity },
  { transcribe = groqTranscribe, sampleRate = 16000, silenceMs = 700, maxChunkMs = 15000, rmsThreshold = 0.015, prerollMs = 300 } = {}
) {
  const bytesPerMs = (sampleRate * BYTES_PER_SAMPLE) / 1000;
  let chunks = [];        // frames of the current utterance
  let chunkBytes = 0;
  let preroll = [];       // recent quiet frames kept so word onsets aren't clipped
  let prerollBytes = 0;
  let speaking = false;
  let silentMs = 0;
  let streamMs = 0;       // ms of audio received so far
  let chunkStartMs = 0;
  let closed = false;
  let lastActivityMs = -Infinity; // stream time of the last onActivity
  let queue = Promise.resolve(); // transcriptions are emitted in order

  function cut() {
    if (!chunkBytes) return;
    const pcm = Buffer.concat(chunks);
    const startMs = chunkStartMs;
    const endMs = Math.round(chunkStartMs + pcm.length / bytesPerMs);
    chunks = [];
    chunkBytes = 0;
    speaking = false;
    silentMs = 0;
    queue = queue.then(async () => {
      try {
        const text = (await transcribe({ wavBuffer: pcmToWav(pcm, sampleRate) }))?.trim();
        if (text && !closed) onFinal?.(text, { startMs, endMs });
      } catch (error) {
        onError?.(error);
      }
    });
  }

  return {
    write(frame) {
      if (closed || !frame?.length) return;
      const buf = Buffer.from(frame);
      const ms = buf.length / bytesPerMs;
      const loud = frameRms(buf) >= rmsThreshold;
      streamMs += ms;

      if (!speaking) {
        if (!loud) {
          preroll.push(buf);
          prerollBytes += buf.length;
          while (prerollBytes / bytesPerMs > prerollMs && preroll.length > 1) prerollBytes -= preroll.shift().length;
          return;
        }
        speaking = true;
        chunkStartMs = Math.max(0, Math.round(streamMs - ms - prerollBytes / bytesPerMs));
        chunks = [...preroll];
        chunkBytes = prerollBytes;
        preroll = [];
        prerollBytes = 0;
      }
      chunks.push(buf);
      chunkBytes += buf.length;
      silentMs = loud ? 0 : silentMs + ms;
      // No partial transcripts here, so report that the candidate is talking (silence timers use it)
      if (loud && streamMs - lastActivityMs >= ACTIVITY_EVERY_MS) {
        lastActivityMs = streamMs;
        onActivity?.();
      }
      if (silentMs >= silenceMs || chunkBytes / bytesPerMs >= maxChunkMs) cut();
    },
    keepAlive() {},
    /** The candidate pressed "I've finished": transcribe what is buffered now. */
    async flush() {
      if (closed) return;
      cut();
      await queue;
    },
    async close() {
      if (closed) return;
      cut();
      await queue;
      closed = true;
      onClose?.();
    },
    /** Resolves once queued transcriptions are done (tests). */
    drain: () => queue,
  };
}
