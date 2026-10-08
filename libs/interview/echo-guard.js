// Removes the interviewer's own voice from what the microphone heard.
// With speakers instead of headphones the mic picks up the question and the speech-to-text turns it
// into "candidate speech", so an answer starts with the question being read back. This module finds
// that echo (loosely: the transcript may rewrite "Node.js/React" as "node dot js slash react") and
// cuts it off. Relative imports only — runs in the interview engine.

const TOKEN = /[A-Za-z0-9']+/g;
const MIN_SPOKEN_WORDS = 4;     // shorter sentences can't be told apart from real speech
const MIN_MATCH = 0.6;          // share of the spoken sentence that must be heard again
const MAX_LEADING_JUNK = 4;     // stray words (noise, mis-heard) allowed before the echo starts
const MAX_GAP = 3;              // words the transcript may insert or drop inside the echo
const MAX_MISSES = 4;           // consecutive misses end the echo

const norm = (word) => word.toLowerCase().replace(/'/g, "");

function tokens(text) {
  const out = [];
  for (const match of String(text || "").matchAll(TOKEN)) {
    const word = norm(match[0]);
    if (word) out.push({ word, start: match.index, end: match.index + match[0].length });
  }
  return out;
}

/**
 * Cut the interviewer's sentence off the start of `heard`.
 * Returns { text, stripped } — text is what is left (possibly ""), stripped says whether an echo was found.
 */
export function stripLeadingEcho(heard, spoken, { minMatch = MIN_MATCH } = {}) {
  const input = String(heard || "");
  const said = tokens(spoken).map((t) => t.word);
  const got = tokens(input);
  if (said.length < MIN_SPOKEN_WORDS || got.length === 0) return { text: input.trim(), stripped: false };

  // Find where the echo begins: the first heard word that starts the spoken sentence
  let a = -1;
  for (let i = 0; i < Math.min(got.length, MAX_LEADING_JUNK + 1); i += 1) {
    if (got[i].word === said[0] || got[i].word === said[1]) {
      a = i;
      break;
    }
  }
  if (a < 0) return { text: input.trim(), stripped: false };

  let s = said[0] === got[a].word ? 0 : 1;
  let matches = 0;
  let last = -1;      // index (in `got`) of the last matched word
  let misses = 0;
  while (s < said.length && a < got.length && misses <= MAX_MISSES) {
    if (got[a].word === said[s]) {
      matches += 1;
      last = a;
      a += 1;
      s += 1;
      misses = 0;
      continue;
    }
    // Resynchronise: the transcript inserted a word, or dropped one
    let moved = false;
    for (let d = 1; d <= MAX_GAP && !moved; d += 1) {
      if (a + d < got.length && got[a + d].word === said[s]) {
        a += d;
        moved = true;
      } else if (s + d < said.length && got[a].word === said[s + d]) {
        s += d;
        moved = true;
      }
    }
    if (!moved) {
      a += 1;
      s += 1;
      misses += 1;
    }
  }

  if (last < 0 || matches / said.length < minMatch) return { text: input.trim(), stripped: false };
  // Keep the punctuation that ends the echoed sentence out of what remains
  const rest = input.slice(got[last].end).replace(/^[\s.,;:!?)"'’”…-]+/, "");
  return { text: rest.trim(), stripped: true };
}

/**
 * Remove every recent interviewer sentence from the start of `heard` (a buffer can hold the echo of
 * more than one). `spokenTexts` are the interviewer's latest utterances, newest first.
 */
export function stripEchoes(heard, spokenTexts) {
  let text = String(heard || "").trim();
  let stripped = false;
  for (let round = 0; round < 3 && text; round += 1) {
    let changed = false;
    for (const spoken of spokenTexts) {
      const result = stripLeadingEcho(text, spoken);
      if (result.stripped) {
        text = result.text;
        stripped = true;
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  return { text, stripped };
}
