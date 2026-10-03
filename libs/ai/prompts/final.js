// Stage-2 hiring summary prompt (docs/ai-hiring/11-stage2-evaluation.md §2).

export const FINAL_SYSTEM = `You are an impartial hiring panel writing the final evaluation of a candidate after an AI-led interview. Use ONLY the evidence provided: the job, the resume screening result, the interview answers with their scores, and the delivery metrics. Do not invent facts.

Rules:
- Refer to the person only as "the candidate".
- Never mention or infer name, gender, age, religion, ethnicity, nationality, accent, disability, appearance or any other protected attribute.
- Treat communication metrics (pace, pauses, filler words, eye contact, emotion) as secondary evidence. Many candidates are not native English speakers; never penalise accent or language background.
- Base the recommendation mainly on job-relevant skills shown in the resume and in the interview answers.
- Keep the summary to 3-4 sentences, factual and specific.`;

export const FINAL_SCHEMA_HINT = `{
  "recommendation": "strong_yes" | "yes" | "maybe" | "no",
  "summary": "3-4 sentence hiring summary",
  "strengths": ["max 5"],
  "risks": ["max 5"],
  "suggestedNextSteps": ["max 3, e.g. technical round on Kubernetes"]
}`;

function list(values) {
  return Array.isArray(values) && values.length ? values.join(", ") : "none";
}

function answerLine(a) {
  const answer = String(a.answer || "").replace(/\s+/g, " ").slice(0, 400);
  return `- Q: ${a.questionText}\n  Score: ${a.score ?? "not scored"}/100${a.isFollowUp ? " (follow-up)" : ""}\n  Answer: "${answer}"`;
}

/**
 * User message. answers: the strongest and weakest scored responses (top/bottom 3).
 */
export function buildFinalUser({ job, fitScore, fitAnalysis, interviewScore, communication, analysis, answers, answered, totalQuestions, finalScore, threshold }) {
  const voice = analysis?.voice || {};
  const gaze = analysis?.gaze || {};
  return `JOB
Title: ${job.title}
Required skills: ${list(job.requiredSkills)}
Experience: ${job.experienceRange || "not specified"}

RESUME SCREENING
Fit score: ${fitScore ?? "not available"}/100
Matched skills: ${list(fitAnalysis?.skillMatch?.matched)}
Missing skills: ${list(fitAnalysis?.skillMatch?.missing)}
Screening strengths: ${list(fitAnalysis?.strengths)}
Screening concerns: ${list(fitAnalysis?.concerns)}

INTERVIEW
Questions answered: ${answered} of ${totalQuestions}
Average answer score: ${interviewScore ?? "not available"}/100
Selected answers (strongest and weakest):
${answers.length ? answers.map(answerLine).join("\n") : "- none"}

DELIVERY (secondary)
Communication score: ${communication.score ?? "not available"}/100
Speaking pace: ${voice.wpm ?? "n/a"} wpm; pause ratio: ${voice.pauseRatio ?? "n/a"}; filler words per minute: ${voice.fillerPerMin ?? "n/a"}
Eye contact: ${gaze.eyeContactScore ?? "n/a"}/100
Tab switches during the interview: ${analysis?.integrity?.tabHiddenCount ?? 0}

COMBINED
Final score: ${finalScore ?? "not available"}/100 (shortlist threshold ${threshold})

Write the evaluation now.`;
}
