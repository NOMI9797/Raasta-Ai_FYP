// Interview question bank prompts (docs/ai-hiring/07-question-bank.md).

export const WARMUP_QUESTION = "Walk me through your background and why this role interests you.";

export const QUESTIONS_SYSTEM = `You are an expert technical interviewer preparing a spoken interview for the Raasta AI Interviewer.
Rules for every question:
- It must be answerable verbally in 1-3 minutes. No coding on a whiteboard, no "write a function".
- One sentence, under 30 words, with no multi-part questions.
- "idealAnswer": 3-6 sentences describing what a strong answer contains.
- "expectedKeywords": 3-8 short terms a good answer would mention.
- "scoreWeight": 1 for the warm-up, up to 3 for core technical questions.
- "category" is one of: technical, role, behavioral. "difficulty" is one of: easy, medium, hard.
- Behavioral questions are STAR-style ("Tell me about a time...").
- Never repeat or rephrase a question from the "Existing questions" list.
Return JSON: { "questions": [ { "question", "category", "difficulty", "idealAnswer", "expectedKeywords", "scoreWeight" } ] }`;

export const QUESTIONS_SCHEMA_HINT = `{ "questions": [ { "question": string, "category": "technical"|"role"|"behavioral", "difficulty": "easy"|"medium"|"hard", "idealAnswer": string, "expectedKeywords": string[], "scoreWeight": 1-3 } ] }`;

function list(values) {
  return Array.isArray(values) && values.length ? values.join(", ") : "not specified";
}

function jobBlock(job) {
  return `JOB
Title: ${job.title}
Description: ${job.formalDescription || job.linkedinPost || job.title}
Required skills: ${list(job.requiredSkills)}
Tech stack: ${list(job.techStack)}
Experience required: ${job.experienceRange || "not specified"}`;
}

function existingBlock(existing) {
  if (!existing?.length) return "Existing questions: none";
  return `Existing questions (do not repeat):\n${existing.map((q) => `- ${q}`).join("\n")}`;
}

/**
 * @param mix { warmup, technicalMedium, technicalHard, role, behavioral }
 */
export function buildQuestionsUser({ job, mix, existing }) {
  const total = mix.warmup + mix.technicalMedium + mix.technicalHard + mix.role + mix.behavioral;
  const lines = [];
  if (mix.warmup) lines.push(`- 1 warm-up (category "role", difficulty "easy", scoreWeight 1), exactly: "${WARMUP_QUESTION}"`);
  if (mix.technicalMedium) lines.push(`- ${mix.technicalMedium} technical, medium, directly from the required skills and tech stack`);
  if (mix.technicalHard) lines.push(`- ${mix.technicalHard} technical, hard, directly from the required skills and tech stack`);
  if (mix.role) lines.push(`- ${mix.role} role (a practical scenario for this job)`);
  if (mix.behavioral) lines.push(`- ${mix.behavioral} behavioral (STAR-style)`);

  return `${jobBlock(job)}

Write exactly ${total} interview questions:
${lines.join("\n")}

${existingBlock(existing)}`;
}

export function buildPersonalisedUser({ job, concerns, missingSkills, count, existing }) {
  return `${jobBlock(job)}

This candidate's screening found these gaps:
Concerns: ${list(concerns)}
Required skills not shown on the resume: ${list(missingSkills)}

Write exactly ${count} technical or role questions that let the candidate address these gaps,
e.g. "Your resume doesn't mention Docker; how have you handled deployments?".
Don't mention scores, and don't refer to personal attributes.

${existingBlock(existing)}`;
}
