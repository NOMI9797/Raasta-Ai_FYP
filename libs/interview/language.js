// The interview is conducted in English only. This module notices when a candidate speaks Urdu (or
// another language of the region) so the Raasta AI Interviewer can say so, instead of scoring a
// garbled transcript as an answer.
//
// Speech recognition runs as English (STT_LANGUAGE), so Urdu speech reaches the interview as one of:
//   - Urdu or Hindi script (rare: only when a recogniser is not held to English);
//   - Romanised Urdu words ("mera naam Ali hai", "nahi, bilkul theek hai");
//   - low-confidence English-looking nonsense (the common case): only the audio gives it away.
// So there are two checks: plain rules on the text (cheap, run on every final), and, for the doubtful
// ones, a language identification of the audio (deps.detectLanguage, Whisper). Either alone is not enough.
// Relative imports only — runs in the interview engine.

// ───────────────────────────── text rules ─────────────────────────────

const REGIONAL_SCRIPT = /[\p{Script=Arabic}\p{Script=Devanagari}]/u;

// Romanised Urdu / Hindi words that are not English words, so a hit means something. Words that are
// also English ("the", "main", "to", "he", "me", "kar", "sab") are deliberately left out.
const ROMAN_MARKERS = new Set((
  "hai hain hoon hun hoga hogi honge tha thi thay nahi nahin nahe kya kyun kyu kyunke kyunki kaise kaisay kahan kaun kab " +
  "aap aapka aapki aapke apna apni apne mera meri mere mujhe mujhko tumhara tumhari hamara hamari hamare tumhe humein " +
  "yeh woh aur lekin magar bhi abhi bohat bohot bahut zyada thoda acha accha achha theek thik haan jee ji " +
  "karna karta karti karte kiya kia kiye raha rahi rahe wala wali wale kuch isliye iska uska unka inka mein " +
  "chahiye chahta chahti samajh samjha shukriya inshallah mashallah alhamdulillah bilkul matlab yaar sahi pehle phir baad " +
  "kaam naam saal liye saath wajah zaroor shayad kabhi hamesha agar lagta lagti dekho suno bolo batao bataya"
).split(/\s+/));

const tokens = (text) => String(text || "").toLowerCase().match(/[a-z]+/g) || [];

/**
 * Does this transcript read as Urdu?
 * @returns {{ urdu: boolean, via: "script"|"roman"|null, hits: number, suspicious: boolean }}
 *   urdu: sure enough to act on without hearing the audio; suspicious: worth identifying the audio.
 */
export function detectUrdu(text) {
  const value = String(text || "");
  const letters = value.match(/\p{L}/gu) || [];
  if (letters.length < 2) return { urdu: false, via: null, hits: 0, suspicious: false };

  const regional = letters.filter((ch) => REGIONAL_SCRIPT.test(ch)).length;
  if (regional >= 2 && regional / letters.length >= 0.3) return { urdu: true, via: "script", hits: regional, suspicious: true };

  const words = tokens(value);
  const hits = words.filter((w) => ROMAN_MARKERS.has(w)).length;
  const urdu = hits >= 3 || (hits >= 2 && words.length <= 4) || (hits >= 2 && hits / words.length >= 0.4);
  return { urdu, via: urdu ? "roman" : null, hits, suspicious: hits >= 1 };
}

// ───────────────────────────── audio identification ─────────────────────────────

// Whisper names the language it heard. These are the languages of the region a candidate could be
// answering in; the set is deliberately narrow, because Whisper sometimes labels accented English as
// some unrelated language and a wrong reminder is worse than a missed one.
const REGIONAL_LANGUAGES = new Set([
  "urdu", "ur", "hindi", "hi", "punjabi", "pa", "sindhi", "sd", "pashto", "ps", "persian", "fa", "arabic", "ar",
]);

export function isRegionalLanguage(language) {
  return REGIONAL_LANGUAGES.has(String(language || "").trim().toLowerCase());
}

/** Whisper's answer for a stretch of audio is non-English speech of the region. */
export function isNonEnglishVerdict({ language, text } = {}) {
  if (isRegionalLanguage(language)) return true;
  return detectUrdu(text).urdu;
}

// Deepgram scores a transcript 0–1; clear English is well above this, speech in another language
// run through an English recogniser falls well below it
export const DEFAULT_CHECK_CONFIDENCE = 0.8;

/** Should the audio behind this transcript be identified? */
export function worthIdentifying({ text, confidence = null, threshold = DEFAULT_CHECK_CONFIDENCE }) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  if (detectUrdu(text).suspicious) return true;
  return typeof confidence === "number" && confidence < threshold && words >= 2;
}

// ───────────────────────────── the audio the engine just heard ─────────────────────────────

const BYTES_PER_SAMPLE = 2; // PCM signed 16-bit little-endian, mono

/**
 * The most recent audio of one speech-recognition stream, so the stretch behind a transcript can be
 * cut out and identified. Offsets are milliseconds from the start of the stream, like the
 * recogniser's own timings.
 */
export class AudioTail {
  constructor({ sampleRate = 16000, keepMs = 30000 } = {}) {
    this.sampleRate = sampleRate;
    this.bytesPerMs = (sampleRate * BYTES_PER_SAMPLE) / 1000;
    this.keepBytes = Math.round(keepMs * this.bytesPerMs);
    this.frames = [];
    this.startByte = 0;  // stream position of the first kept byte
    this.endByte = 0;    // stream position after the last byte
  }

  write(frame) {
    if (!frame?.length) return;
    this.frames.push(Buffer.from(frame));
    this.endByte += frame.length;
    while (this.endByte - this.startByte > this.keepBytes && this.frames.length > 1) {
      this.startByte += this.frames.shift().length;
    }
  }

  /** The audio between two stream times (clipped to what is kept), or null when nothing is left of it. */
  slice(startMs, endMs, { padMs = 150 } = {}) {
    const from = Math.max(this.startByte, Math.floor(Math.max(0, startMs - padMs) * this.bytesPerMs));
    const to = Math.min(this.endByte, Math.ceil((endMs + padMs) * this.bytesPerMs));
    const start = from - (from % BYTES_PER_SAMPLE);
    const end = to - (to % BYTES_PER_SAMPLE);
    if (end - start < this.bytesPerMs * 400) return null;
    const all = Buffer.concat(this.frames);
    return all.subarray(start - this.startByte, end - this.startByte);
  }
}

// ───────────────────────────── what the interviewer says ─────────────────────────────

/** Name for the notice: Urdu (and Hindi, which Whisper often hears for the same speech) is called Urdu. */
export function noticeLanguage(language) {
  return ["urdu", "ur", "hindi", "hi"].includes(String(language || "").trim().toLowerCase()) ? "urdu" : null;
}

/**
 * The reminder. The first one is friendly; later ones are firmer, because the candidate was told.
 * @param {number} count which reminder this is (1-based)
 * @param {string|null} language "urdu" when known; anything else is "another language"
 */
export function languageNoticeText({ firstName, count = 1, language = null }) {
  const name = firstName && firstName !== "there" ? `${firstName}, ` : "";
  const spoke = language === "urdu" ? "in Urdu" : "in a language other than English";
  if (count <= 1) {
    return `${name}I noticed you spoke ${spoke}. This interview is conducted in English only, so please answer in English.`;
  }
  if (count === 2) {
    return `${name}I need to remind you again: this interview is conducted in English only. Answers in any other language can't be evaluated, so please continue in English.`;
  }
  return `${name}please answer in English. The interview is conducted in English only, and I can't evaluate answers in another language.`;
}

/** A short reminder tacked onto the next question when the candidate switched language mid-answer. */
export function languageReminderText() {
  return "A quick reminder: please keep your answers in English.";
}
