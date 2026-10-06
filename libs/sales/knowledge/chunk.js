// Split knowledge base text into passages small enough to embed well (the embedding model reads
// about 256 tokens) and big enough to answer a question on their own. Pure, so it is unit-tested.

export const CHUNK = { target: 700, max: 1000, overlap: 120 };

export function normaliseText(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// A short line on its own starts a section: "## Pricing", "Web development:", or an FAQ question
// ("Can you sign an NDA?"), so each answer gets a passage of its own
const HEADING = /^(#{1,6}\s+.+|[A-Z][^.!?\n]{1,60}:|[A-Z][^\n]{3,120}\?)$/;
// A new section starts a new passage once the current one has this much text
const MIN_SECTION = 150;

function headingOf(paragraph) {
  const first = paragraph.split("\n")[0].trim();
  return HEADING.test(first) ? first.replace(/^#+\s*/, "").replace(/:$/, "") : null;
}

function sentences(text) {
  return text.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g)?.map((s) => s.trim()).filter(Boolean) || [text];
}

/** Break one too-long paragraph into pieces of at most `max` characters, on sentence ends. */
function splitLong(paragraph, max) {
  const out = [];
  let current = "";
  for (const s of sentences(paragraph)) {
    if (s.length > max) {
      if (current) out.push(current);
      current = "";
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
      continue;
    }
    if (current && current.length + 1 + s.length > max) {
      out.push(current);
      current = s;
    } else {
      current = current ? `${current} ${s}` : s;
    }
  }
  if (current) out.push(current);
  return out;
}

/** The last sentences of a passage, up to `overlap` characters, to start the next one with. */
function tailOf(text, overlap) {
  if (!overlap) return "";
  const parts = sentences(text);
  let tail = "";
  for (let i = parts.length - 1; i >= 0; i--) {
    const next = tail ? `${parts[i]} ${tail}` : parts[i];
    if (next.length > overlap) break;
    tail = next;
  }
  return tail;
}

/**
 * Chunks of a document: [{ index, content, heading, embedText }]. `embedText` carries the document
 * title and section heading, so a passage like "Starts at $2,000" is still found for "website price".
 */
export function chunkText(text, { title = "", target = CHUNK.target, max = CHUNK.max, overlap = CHUNK.overlap } = {}) {
  const clean = normaliseText(text);
  if (!clean) return [];

  const pieces = [];
  let heading = null;
  for (const paragraph of clean.split(/\n\n+/)) {
    heading = headingOf(paragraph) || heading;
    const parts = paragraph.length > max ? splitLong(paragraph, max) : [paragraph];
    for (const p of parts) pieces.push({ text: p, heading });
  }

  const chunks = [];
  let current = null;
  const flush = () => {
    if (current?.text.trim()) chunks.push(current);
    current = null;
  };
  for (const piece of pieces) {
    const newSection = current && piece.heading !== current.heading && headingOf(piece.text) && current.text.length >= MIN_SECTION;
    if (newSection) {
      flush();
      current = { text: piece.text, heading: piece.heading };
    } else if (current && current.text.length + 2 + piece.text.length > target) {
      const carry = tailOf(current.text, overlap);
      flush();
      // A new section starts clean; inside a section, repeat a little context
      current = { text: carry && piece.heading === chunks[chunks.length - 1]?.heading && !headingOf(piece.text) ? `${carry}\n\n${piece.text}` : piece.text, heading: piece.heading };
    } else if (current) {
      current.text = `${current.text}\n\n${piece.text}`;
    } else {
      current = { text: piece.text, heading: piece.heading };
    }
  }
  flush();

  return chunks.map((c, index) => ({
    index,
    content: c.text,
    heading: c.heading,
    embedText: [title, c.heading && c.heading !== title ? c.heading : null].filter(Boolean).join(" › ") + (title || c.heading ? "\n" : "") + c.text,
  }));
}
