// Shared inputs for the demo cases: the fixture job, the ten fixture resumes, and the answers a
// person worked out BY HAND (the "oracle"). Expected values here come from reading the resumes and
// the formulas in docs/ai-hiring, never from running the code under test.
import fs from "fs";
import { extractResumeText } from "../../libs/hiring/resume-text";

export const FIXTURES = "tests/fixtures";

export const job = JSON.parse(fs.readFileSync(`${FIXTURES}/jobs/devops-engineer.json`, "utf8"));
export const REQUIRED = job.requiredSkills; // Docker, Kubernetes, AWS, CI/CD, Terraform, Linux

export const readResume = (file) => fs.readFileSync(`${FIXTURES}/resumes/${file}`);

/** Plain text of a fixture resume, through the same extractor the apply form uses. */
export async function resumeText(file) {
  const { text } = await extractResumeText({ buffer: readResume(file), filename: file });
  return text;
}

/** A candidate row as the screening code sees it, built from a fixture file. */
export async function candidateFrom(file, name) {
  return { name, parsedData: { _resumeText: await resumeText(file) } };
}

const ALL = [...REQUIRED];

// Hand-derived: which of the six required skills each resume actually shows (job order).
export const EXPECTED_SKILLS = {
  "strong-1-ayesha-khan.pdf": { name: "Ayesha Khan", group: "strong", matched: ALL },
  "strong-2-bilal-qureshi.txt": { name: "Bilal Qureshi", group: "strong", matched: ALL },
  "strong-3-sara-ahmed.docx": { name: "Sara Ahmed", group: "strong", matched: ALL },
  "partial-1-hamza-sheikh.txt": { name: "Hamza Sheikh", group: "partial", matched: ["Docker", "AWS", "Linux"] },
  "partial-2-fatima-noor.txt": { name: "Fatima Noor", group: "partial", matched: ["Linux"] },
  "partial-3-usman-tariq.pdf": { name: "Usman Tariq", group: "partial", matched: ["Docker", "AWS", "Linux"] },
  "unrelated-1-zara-malik.txt": { name: "Zara Malik", group: "unrelated", matched: [] },
  "unrelated-2-omar-farooq.txt": { name: "Omar Farooq", group: "unrelated", matched: [] },
};
for (const entry of Object.values(EXPECTED_SKILLS)) entry.missing = ALL.filter((s) => !entry.matched.includes(s));

export const byGroup = (group) => Object.entries(EXPECTED_SKILLS).filter(([, v]) => v.group === group);

/**
 * What a model would plausibly answer for each resume (used by the offline and database stages, where
 * no real model is called). The rest of the pipeline treats these as the model's output.
 */
export const SCRIPTED_FIT = {
  "ayesha.khan@example.com": 92,
  "bilal.qureshi@example.com": 85,
  "sara.ahmed@example.com": 78,
  "usman.tariq@example.com": 55,
  "hamza.sheikh@example.com": 52,
  "fatima.noor@example.com": 38,
  "zara.malik@example.com": 8,
  "omar.farooq@example.com": 5,
};

export const list = (items) => (items.length ? items.join(", ") : "none");
