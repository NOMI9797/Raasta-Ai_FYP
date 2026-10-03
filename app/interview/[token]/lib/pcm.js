// PCM helpers for the fallback mic path (ScriptProcessorNode). The AudioWorklet in
// public/worklets/pcm16-downsampler.js uses the same algorithm (worklets can't import bundle code).

export const TARGET_RATE = 16000;

/** Downsample by averaging; keeps the fractional position across calls. */
export function createDownsampler(inputRate, targetRate = TARGET_RATE) {
  const ratio = inputRate / targetRate;
  let carry = [];
  let position = 0;
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

/** Clamp to [-1, 1] and convert to Int16. */
export function floatToInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** Collects downsampled samples and emits fixed-size Int16 frames (40 ms = 640 samples at 16 kHz). */
export function createFramer(inputRate, frameMs, onFrame) {
  const downsample = createDownsampler(inputRate);
  const frameSamples = Math.round((TARGET_RATE * frameMs) / 1000);
  let pending = [];
  return (input) => {
    pending = pending.concat(downsample(input));
    while (pending.length >= frameSamples) {
      onFrame(floatToInt16(pending.splice(0, frameSamples)).buffer);
    }
  };
}
