// Stage-1 fit scoring prompt (docs/ai-hiring/06-stage1-screening.md §2).

export const FIT_RESUME_TEXT_CHARS = 6000;

// Parsed-resume fields that identify the person rather than their qualifications
const PERSONAL_FIELDS = ["name", "email", "phone", "location", "github", "linkedin", "_resumeText"];

export const FIT_SYSTEM = `You are an impartial technical recruiter. Compare the candidate's resume with the job requirements and return ONLY a JSON object with the schema below. Judge only job-relevant evidence: skills, experience, projects and education. Ignore and never mention name, gender, age, religion, nationality, photo, marital status or address. Do not invent facts that are not in the resume. If the resume is empty or unreadable, set fitScore to 0 and explain in rationale.

Scoring rubric (fitScore is 0-100):
- Required skills coverage: 45%
- Relevant experience (years + similarity of past roles): 30%
- Projects and achievements relevant to the stack: 15%
- Education/certifications relevance: 10%

Refer to the person only as "the candidate".`;

export const FIT_SCHEMA_HINT = `{
  "fitScore": 0-100 integer,
  "skillMatch": { "matched": ["required skills the resume shows"], "missing": ["required skills not shown"], "extra": ["other relevant skills"] },
  "experienceMatch": { "required": "e.g. 3-5 years", "candidateYears": number or null, "verdict": "meets" | "below" | "above" | "unknown" },
  "educationMatch": { "verdict": "relevant" | "partially_relevant" | "not_relevant" | "unknown", "note": "short note" },
  "strengths": ["max 5 job-relevant strengths"],
  "concerns": ["max 5 gaps or risks"],
  "rationale": "2-3 sentences"
}`;

export function jobDescriptionText(job) {
  return job.formalDescription || job.linkedinPost || job.title;
}

function list(values) {
  return Array.isArray(values) && values.length ? values.join(", ") : "not specified";
}

/**
 * Parsed resume without personal identifiers or the raw text.
 */
export function stripPersonalFields(parsedData) {
  const copy = { ...(parsedData || {}) };
  for (const field of PERSONAL_FIELDS) delete copy[field];
  return copy;
}

export function buildFitUser({ job, candidate }) {
  const parsed = candidate.parsedData || {};
  const resumeText = typeof parsed._resumeText === "string" ? parsed._resumeText.slice(0, FIT_RESUME_TEXT_CHARS) : "";

  return `JOB
Title: ${job.title}
Description: ${jobDescriptionText(job)}
Required skills: ${list(job.requiredSkills)}
Tech stack: ${list(job.techStack)}
Experience required: ${job.experienceRange || "not specified"}
Location type: ${job.locationType || "not specified"}
Employment type: ${job.employmentType || "not specified"}

CANDIDATE (parsed resume)
${JSON.stringify(stripPersonalFields(parsed), null, 2)}

CANDIDATE (resume text, first ${FIT_RESUME_TEXT_CHARS} characters)
${resumeText || "(no resume text available)"}`;
}
