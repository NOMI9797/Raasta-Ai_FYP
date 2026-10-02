import { chatJSON, HIRING_MODELS } from "@/libs/hiring/llm";

// Limits shared by the apply and re-parse flows
export const MAX_RESUME_BYTES = 5 * 1024 * 1024; // 5 MB
export const RESUME_TEXT_STORE_LIMIT = 10000; // chars kept in parsedData._resumeText
const RESUME_TEXT_PROMPT_LIMIT = 8000; // chars sent to the LLM
const MIN_USABLE_TEXT_LENGTH = 30;

export const ALLOWED_RESUME_EXTENSIONS = [".pdf", ".docx", ".txt"];

function getExtension(fileName = "") {
  const name = fileName.toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}

/**
 * Validate an uploaded resume before processing.
 * Returns an error message, or null when the file is acceptable.
 */
export function validateResumeFile(file) {
  if (!file || typeof file.arrayBuffer !== "function" || file.size === 0) {
    return null; // resume is optional
  }
  if (file.size > MAX_RESUME_BYTES) {
    return "Resume must be 5 MB or smaller";
  }
  if (!ALLOWED_RESUME_EXTENSIONS.includes(getExtension(file.name))) {
    return "Resume must be a PDF, DOCX or TXT file";
  }
  return null;
}

async function extractPdfText(buffer) {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return (Array.isArray(text) ? text.join("\n") : text || "").trim();
}

async function extractDocxText(buffer) {
  const mammoth = await import("mammoth");
  const result = await (mammoth.default || mammoth).extractRawText({ buffer });
  return result.value?.trim() || "";
}

/**
 * Extract plain text from an uploaded resume (PDF, DOCX or TXT).
 */
export async function extractResumeText(file) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = getExtension(file.name);

  if (ext === ".pdf") return extractPdfText(buffer);
  if (ext === ".docx") return extractDocxText(buffer);
  return buffer.toString("utf-8").trim();
}

const RESUME_PARSER_PROMPT = `You are an expert resume parser. Extract ALL available structured data from the resume.
Return a valid JSON object with exactly these fields (use null or [] if not found):
{
  "name": "full name",
  "location": "city, country",
  "email": "email or null",
  "phone": "phone or null",
  "github": "github url or null",
  "linkedin": "linkedin url or null",
  "summary": "professional summary paragraph from the resume",
  "skills": ["every skill mentioned: languages, frameworks, tools, databases, cloud, etc"],
  "skillsByCategory": {
    "languages": [],
    "frontend": [],
    "backend": [],
    "databases": [],
    "tools": [],
    "other": []
  },
  "yearsExperience": <number estimate or null>,
  "jobTitles": ["all job titles or roles mentioned"],
  "experience": [
    {
      "title": "job title",
      "company": "company or freelance",
      "period": "date range",
      "bullets": ["key responsibility or achievement"]
    }
  ],
  "projects": [
    {
      "name": "project name",
      "description": "what it does",
      "technologies": ["tech used"]
    }
  ],
  "education": [
    {
      "degree": "degree name",
      "institution": "university/school",
      "period": "graduation year or expected"
    }
  ],
  "availability": "availability info or null",
  "strengths": ["listed strengths"]
}
Return ONLY the JSON object. No markdown fences, no explanation, no extra text.`;

/**
 * Turn resume text into the structured parsedData shape used across the recruiter module.
 */
export async function parseResumeWithLLM(text) {
  const { data, raw } = await chatJSON({
    system: RESUME_PARSER_PROMPT,
    user: `Parse this resume completely:\n\n${text.slice(0, RESUME_TEXT_PROMPT_LIMIT)}`,
    model: HIRING_MODELS.accurate,
    temperature: 0.1,
    maxTokens: 2000,
  });
  return data || { rawParsed: raw };
}

/**
 * Full apply-time flow: extract text from the file, parse it, and keep the raw text
 * so a re-parse never needs the original file again.
 */
export async function processResumeFile(file) {
  let text;
  try {
    text = await extractResumeText(file);
  } catch (err) {
    console.error("Resume text extraction error:", err);
    return { parseError: "Failed to process resume" };
  }

  if (text.length <= MIN_USABLE_TEXT_LENGTH) {
    return { parseError: "Could not extract readable text from resume" };
  }

  const storedText = text.slice(0, RESUME_TEXT_STORE_LIMIT);
  try {
    const parsedData = await parseResumeWithLLM(text);
    parsedData._resumeText = storedText;
    return parsedData;
  } catch (err) {
    // Keep the extracted text so the recruiter can re-parse later
    console.error("Resume parsing error:", err);
    return { parseError: "Failed to parse resume", _resumeText: storedText };
  }
}
