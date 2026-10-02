// Picks the speech-to-text adapter: Deepgram when DEEPGRAM_API_KEY is set, else chunked Whisper.
// Relative imports only.
import { createDeepgramStt } from "./deepgram";
import { createWhisperStt } from "./whisper-chunked";

export function sttProvider() {
  return process.env.DEEPGRAM_API_KEY ? "deepgram" : "whisper";
}

export function createStt(handlers, options = {}) {
  return sttProvider() === "deepgram" ? createDeepgramStt(handlers, options) : createWhisperStt(handlers, options);
}
