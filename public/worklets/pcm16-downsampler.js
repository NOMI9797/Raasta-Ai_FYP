/* global sampleRate */
// Raasta AI Interviewer — microphone → PCM16 mono 16 kHz frames (docs/ai-hiring/10-interview-room.md).
// Downsamples by averaging, clamps to [-1, 1], converts to Int16 and posts one frame every
// frameMs (default 40 ms) as a transferable ArrayBuffer. Same algorithm as
// app/interview/[token]/lib/pcm.js (the fallback path); worklets can't import bundle code.

const TARGET_RATE = 16000;

// Pure helpers (also loaded by the unit tests)
function createDownsampler(inputRate, targetRate) {
  const ratio = inputRate / targetRate;
  let carry = [];      // input samples not yet consumed
  let position = 0;    // fractional read position into carry
  return function downsample(input) {
    const data = carry.length ? carry.concat(Array.from(input)) : Array.from(input);
    const out = [];
    while (position + ratio <= data.length) {
      const start = Math.floor(position);
      const end = Math.floor(position + ratio);
      let sum = 0;
      for (let i = start; i < end; i += 1) sum += data[i];
      out.push(end > start ? sum / (end - start) : data[start]);
      position += ratio;
    }
    const consumed = Math.floor(position);
    carry = data.slice(consumed);
    position -= consumed;
    return out;
  };
}

function floatToInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

if (typeof registerProcessor === "function") {
  class Pcm16Downsampler extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const frameMs = (options && options.processorOptions && options.processorOptions.frameMs) || 40;
      this.frameSamples = Math.round((TARGET_RATE * frameMs) / 1000);
      this.downsample = createDownsampler(sampleRate, TARGET_RATE);
      this.pending = [];
      this.enabled = true;
      this.port.onmessage = (event) => {
        if (event.data && typeof event.data.enabled === "boolean") this.enabled = event.data.enabled;
      };
    }

    process(inputs) {
      const channel = inputs[0] && inputs[0][0];
      if (!channel || !this.enabled) return true;
      const samples = this.downsample(channel);
      for (let i = 0; i < samples.length; i += 1) this.pending.push(samples[i]);
      while (this.pending.length >= this.frameSamples) {
        const frame = floatToInt16(this.pending.splice(0, this.frameSamples));
        this.port.postMessage(frame.buffer, [frame.buffer]);
      }
      return true;
    }
  }
  registerProcessor("pcm16-downsampler", Pcm16Downsampler);
}

if (typeof module !== "undefined") module.exports = { createDownsampler, floatToInt16, TARGET_RATE };
