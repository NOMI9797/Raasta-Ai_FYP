// Cleans a speech-to-text result before it becomes part of a candidate's answer.
// Speech models invent text on silence, keyboard noise and room echo: "Thank you.", "Bye.",
// "Mm-hmm.", or words in another language ("Olha aí", "ありがとうございました", "Время").
// None of that is the candidate speaking, and it must not reach the transcript or the scorer.
// Relative imports only — runs in the interview engine.

// Scripts that never belong in an English interview
const FOREIGN_SCRIPT = /[\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Thai}\p{Script=Hebrew}\p{Script=Greek}]/u;

// Whole sentences models produce out of nothing (compared without punctuation or case)
const PHANTOM_SENTENCES = new Set([
  "thank you", "thanks", "thank you very much", "thank you so much", "thank you for watching",
  "thanks for watching", "thank you for listening", "please subscribe", "like and subscribe",
  "bye", "bye bye", "goodbye", "see you next time", "see you later", "you", "the end",
  "mm hmm", "mhm", "uh huh", "mm", "hmm hmm",
  "subtitles by the amara org community",
  "obrigado", "obrigada", "olha", "olha ai", "e ai", "tchau", "gracias", "adios", "merci", "danke", "ciao",
]);

const SENTENCE_BREAK = /(?<=[.!?…])\s+/;
const REPEAT_LIMIT = 3; // a sentence said this many times in a row is a decoding loop, not speech

function plain(sentence) {
  return String(sentence || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isEnglish(language) {
  return !language || String(language).toLowerCase().startsWith("en");
}

/**
 * Returns the cleaned text, or "" when nothing real was said.
 * options.language: only English interviews get the foreign-script filter (STT_LANGUAGE).
 */
export function cleanTranscript(text, { language = process.env.STT_LANGUAGE || "en" } = {}) {
  let value = String(text || "").trim();
  if (!value) return "";

  if (isEnglish(language)) {
    value = value
      .split(/\s+/)
      .filter((word) => !FOREIGN_SCRIPT.test(word))
      .join(" ");
  }

  const kept = [];
  let previous = null;
  let run = 0;
  for (const sentence of value.split(SENTENCE_BREAK)) {
    const key = plain(sentence);
    if (!key) continue; // only punctuation left behind by a removed word
    if (PHANTOM_SENTENCES.has(key)) continue;
    run = key === previous ? run + 1 : 1;
    previous = key;
    if (run >= REPEAT_LIMIT) continue; // keep the first two, drop the loop
    kept.push(sentence.trim());
  }

  const cleaned = kept.join(" ").replace(/\s+/g, " ").trim();
  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : "";
}
