// Resume validation and plain-text extraction (docs/ai-hiring/06-stage1-screening.md §1).
// Relative imports only — also used by the worker.
import { chatJSON, getModel } from "../ai/llm";
import { RESUME_PARSER_SYSTEM, buildResumeParserUser } from "../ai/prompts/resume";

export const MAX_RESUME_BYTES = 5 * 1024 * 1024; // 5 MB

export const RESUME_TYPES = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
};

export function resumeExtension(filename = "") {
  const name = String(filename).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}

/**
 * Check an uploaded resume. Returns an error message, or null if it is acceptable.
 */
export function validateResumeFile({ filename, size }) {
  if (!RESUME_TYPES[resumeExtension(filename)]) return "Resume must be a PDF, DOCX or TXT file";
  if (!size) return "Resume file is empty";
  if (size > MAX_RESUME_BYTES) return "Resume must be 5 MB or smaller";
  return null;
}

// The pre-Phase-1 approach, kept as a fallback for PDFs pdf-parse cannot open
export function extractPdfTextNaive(buffer) {
  const raw = buffer.toString("latin1");
  const chunks = raw.match(/[A-Za-z0-9 .,:\-\n\r\t@/()&+]{20,}/g) || [];
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

async function extractPdfText(buffer) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    // pdf-parse separates pages with "-- 1 of 3 --" lines
    return (result?.text || "").replace(/^-- \d+ of \d+ --$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractDocxText(buffer) {
  const mammoth = await import("mammoth");
  const result = await (mammoth.default || mammoth).extractRawText({ buffer });
  return (result?.value || "").trim();
}

/**
 * Extract plain text from a resume buffer.
 * Returns { text, method } — method is "pdf-parse", "pdf-regex", "mammoth" or "utf8".
 */
export async function extractResumeText({ buffer, filename }) {
  const ext = resumeExtension(filename);

  if (ext === ".pdf") {
    // Empty text from pdf-parse means a scanned/image-only PDF: return it empty so the
    // caller flags it, rather than feeding the regex fallback's metadata noise to the LLM.
    try {
      return { text: await extractPdfText(buffer), method: "pdf-parse" };
    } catch (error) {
      console.warn("pdf-parse failed, using regex fallback:", error?.message);
      return { text: extractPdfTextNaive(buffer), method: "pdf-regex" };
    }
  }

  if (ext === ".docx") {
    return { text: await extractDocxText(buffer), method: "mammoth" };
  }

  return { text: buffer.toString("utf-8").trim(), method: "utf8" };
}

// ─── LLM parsing into candidates.parsedData ───

export const RESUME_TEXT_STORE_CHARS = 10000; // kept in parsedData._resumeText for re-parsing
const MIN_READABLE_CHARS = 30;

/**
 * Parse resume text into the parsedData shape. Throws LlmError on LLM failure.
 */
export async function parseResumeWithLLM(text) {
  const parsed = await chatJSON({
    system: RESUME_PARSER_SYSTEM,
    user: buildResumeParserUser(text),
    model: getModel(),
    temperature: 0.1,
    maxTokens: 2000,
  });
  return parsed && !Array.isArray(parsed) ? parsed : {};
}

/**
 * Full apply-time flow: extract text, parse it, keep the raw text for later re-parses.
 * Never throws — failures are recorded as parsedData.parseError.
 */
export async function buildParsedData({ buffer, filename }) {
  let text;
  try {
    ({ text } = await extractResumeText({ buffer, filename }));
  } catch {
    return { parseError: "Failed to process resume" };
  }
  if (text.length <= MIN_READABLE_CHARS) {
    return { parseError: "Could not extract readable text from resume" };
  }

  const resumeText = text.slice(0, RESUME_TEXT_STORE_CHARS);
  try {
    const parsedData = await parseResumeWithLLM(text);
    return { ...parsedData, _resumeText: resumeText };
  } catch (error) {
    // Keep the text so the recruiter can re-parse once the LLM is reachable
    console.error("Resume parsing failed:", error?.code || "error");
    return { parseError: "Failed to parse resume", _resumeText: resumeText };
  }
}
