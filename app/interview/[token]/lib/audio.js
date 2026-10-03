// Browser audio for the interview room: mic → PCM16 16 kHz frames (AudioWorklet), level meter,
// and playback of the interviewer's voice (WAV from the engine, or speechSynthesis).

export function browserSupport() {
  if (typeof window === "undefined") return { ok: true };
  const missing = [];
  if (!navigator.mediaDevices?.getUserMedia) missing.push("getUserMedia");
  if (typeof window.AudioWorkletNode === "undefined") missing.push("AudioWorklet");
  if (typeof window.MediaRecorder === "undefined") missing.push("MediaRecorder");
  if (typeof window.WebSocket === "undefined") missing.push("WebSocket");
  return { ok: missing.length === 0, missing };
}

export const MEDIA_CONSTRAINTS = (recordVideo) => ({
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: recordVideo ? { width: 640, height: 360 } : false,
});

export function createAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  return new Ctx({ latencyHint: "interactive" });
}

/** RMS level 0..1 from an AnalyserNode (for the mic meter). */
export function readLevel(analyser, buffer) {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

const WORKLET_TIMEOUT_MS = 5000;
const FRAME_MS = 40;

async function loadWorklet(ctx) {
  if (!ctx.audioWorklet || typeof window.AudioWorkletNode === "undefined") throw new Error("AudioWorklet unavailable");
  let timer;
  try {
    await Promise.race([
      ctx.audioWorklet.addModule("/worklets/pcm16-downsampler.js"),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("AudioWorklet timed out")), WORKLET_TIMEOUT_MS); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  return new AudioWorkletNode(ctx, "pcm16-downsampler", { processorOptions: { frameMs: FRAME_MS } });
}

/**
 * Mic → onFrame(ArrayBuffer of Int16 PCM, 16 kHz, 40 ms).
 * Uses the AudioWorklet; if it is unavailable or never loads (seen on some locked-down machines),
 * falls back to a ScriptProcessorNode with the same downsampling.
 * Returns { analyser, mode, setEnabled(bool), close() }.
 */
export async function startMicPipeline(ctx, stream, onFrame) {
  const source = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  // Processing nodes only run while connected to the graph: route them through a silent gain
  const silent = ctx.createGain();
  silent.gain.value = 0;
  silent.connect(ctx.destination);

  let node;
  let mode = "worklet";
  let enabled = true;
  try {
    node = await loadWorklet(ctx);
    node.port.onmessage = (event) => onFrame(event.data);
  } catch {
    mode = "script-processor";
    const { createFramer } = await import("./pcm");
    const framer = createFramer(ctx.sampleRate, FRAME_MS, onFrame);
    node = ctx.createScriptProcessor(2048, 1, 1);
    node.onaudioprocess = (event) => {
      if (enabled) framer(event.inputBuffer.getChannelData(0));
    };
  }
  source.connect(node);
  node.connect(silent);

  return {
    analyser,
    mode,
    setEnabled(value) {
      enabled = value;
      node.port?.postMessage({ enabled: value });
    },
    close() {
      if (node.port) node.port.onmessage = null;
      else node.onaudioprocess = null;
      try {
        source.disconnect();
        node.disconnect();
        silent.disconnect();
      } catch {
        // already disconnected
      }
    },
  };
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function pickVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  return voices.find((v) => /^en(-|_)/i.test(v.lang) && /natural|google|microsoft/i.test(v.name))
    || voices.find((v) => /^en/i.test(v.lang))
    || null;
}

/**
 * Speak one interviewer utterance. Resolves when playback ends (or is stopped).
 * Returns { done: Promise, stop() }.
 */
export function speak(ctx, { audio, text }) {
  let stopFn = () => {};
  const done = new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (!finished) {
        finished = true;
        resolve();
      }
    };
    if (audio) {
      ctx.decodeAudioData(base64ToArrayBuffer(audio))
        .then((buffer) => {
          const node = ctx.createBufferSource();
          node.buffer = buffer;
          node.connect(ctx.destination);
          node.onended = finish;
          stopFn = () => {
            try { node.stop(); } catch { /* not started */ }
            finish();
          };
          node.start();
        })
        .catch(() => speakText(text, finish, (fn) => { stopFn = fn; }));
    } else {
      speakText(text, finish, (fn) => { stopFn = fn; });
    }
  });
  return { done, stop: () => stopFn() };
}

function speakText(text, finish, setStop) {
  if (!window.speechSynthesis) {
    // No speech at all: give the candidate time to read the text
    const timer = setTimeout(finish, Math.max(2000, text.split(/\s+/).length * 350));
    setStop(() => { clearTimeout(timer); finish(); });
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang || "en-US";
  utterance.rate = 1;
  utterance.onend = finish;
  utterance.onerror = finish;
  // Chrome can drop onend for long utterances: fall back on an estimate
  const safety = setTimeout(finish, Math.max(4000, text.split(/\s+/).length * 600 + 3000));
  utterance.addEventListener("end", () => clearTimeout(safety));
  setStop(() => { window.speechSynthesis.cancel(); clearTimeout(safety); finish(); });
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

/** Short test tone through the same output the interviewer uses. */
export function playTestTone(ctx) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 523.25;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.85);
}
