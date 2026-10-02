import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { setLlmClient } from "../../libs/ai/llm";
import { validateResumeFile, extractResumeText, buildParsedData, MAX_RESUME_BYTES } from "../../libs/hiring/resume-text";

const fixture = (name) => fs.readFileSync(`tests/fixtures/resumes/${name}`);

function fakeLlm(reply) {
  return {
    chat: { completions: { async create() {
      if (reply instanceof Error) throw reply;
      return { choices: [{ message: { content: reply } }] };
    } } },
  };
}
afterEach(() => setLlmClient(null));

test("validateResumeFile enforces type and size", () => {
  assert.equal(validateResumeFile({ filename: "cv.PDF", size: 100 }), null);
  assert.equal(validateResumeFile({ filename: "cv.docx", size: 100 }), null);
  assert.match(validateResumeFile({ filename: "cv.doc", size: 100 }), /PDF, DOCX or TXT/);
  assert.match(validateResumeFile({ filename: "cv.exe", size: 100 }), /PDF, DOCX or TXT/);
  assert.match(validateResumeFile({ filename: "cv.pdf", size: MAX_RESUME_BYTES + 1 }), /5 MB/);
  assert.match(validateResumeFile({ filename: "cv.pdf", size: 0 }), /empty/);
});

test("multi-page PDF: every page's text is extracted, without page markers", async () => {
  const { text, method } = await extractResumeText({ buffer: fixture("strong-1-ayesha-khan.pdf"), filename: "a.pdf" });
  assert.equal(method, "pdf-parse");
  assert.match(text, /Ayesha Khan/);                 // page 1
  assert.match(text, /Containerised a monolith/);    // page 2
  assert.match(text, /Certified Kubernetes Administrator/); // page 3
  assert.doesNotMatch(text, /-- \d+ of \d+ --/);
});

test("scanned (image-only) PDF yields no text rather than metadata noise", async () => {
  const { text } = await extractResumeText({ buffer: fixture("unreadable-scanned.pdf"), filename: "s.pdf" });
  assert.equal(text, "");
});

test("DOCX and TXT extraction", async () => {
  const docx = await extractResumeText({ buffer: fixture("strong-3-sara-ahmed.docx"), filename: "s.docx" });
  assert.equal(docx.method, "mammoth");
  assert.match(docx.text, /Site reliability engineer/);
  const txt = await extractResumeText({ buffer: fixture("strong-2-bilal-qureshi.txt"), filename: "b.txt" });
  assert.match(txt.text, /Bilal Qureshi/);
});

test("buildParsedData keeps the LLM fields and the raw text", async () => {
  setLlmClient(fakeLlm('{"name":"Bilal Qureshi","skills":["Docker","Kubernetes"],"yearsExperience":3}'));
  const parsed = await buildParsedData({ buffer: fixture("strong-2-bilal-qureshi.txt"), filename: "b.txt" });
  assert.equal(parsed.name, "Bilal Qureshi");
  assert.deepEqual(parsed.skills, ["Docker", "Kubernetes"]);
  assert.match(parsed._resumeText, /CloudNest Solutions/);
});

test("unreadable resume is flagged without calling the LLM", async () => {
  setLlmClient(fakeLlm(new Error("LLM must not be called")));
  const parsed = await buildParsedData({ buffer: fixture("unreadable-scanned.pdf"), filename: "s.pdf" });
  assert.deepEqual(parsed, { parseError: "Could not extract readable text from resume" });
});

test("LLM failure keeps the text for a later re-parse", async () => {
  setLlmClient(fakeLlm(new Error("upstream down")));
  const parsed = await buildParsedData({ buffer: fixture("partial-1-hamza-sheikh.txt"), filename: "h.txt" });
  assert.equal(parsed.parseError, "Failed to parse resume");
  assert.match(parsed._resumeText, /Hamza Sheikh/);
});
