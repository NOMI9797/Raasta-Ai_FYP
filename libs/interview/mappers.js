// Raasta data → interview session inputs (docs/ai-hiring/04-source-port-map.md, "Mapping Raasta data").

export function toCandidateContext(candidate) {
  const p = candidate.parsedData || {};
  return {
    candidateName: candidate.name,
    firstName: (candidate.name || "").split(" ")[0] || "there",
    summary: p.summary || "",
    skills: p.skills || [],
    experience: (p.experience || []).map((e) => `${e.title} at ${e.company} (${e.period})`),
    education: (p.education || []).map((e) => `${e.degree}, ${e.institution} (${e.period})`),
    yearsExperience: p.yearsExperience ?? null,
  };
}

export function toRoleContext(job) {
  return {
    id: job.id,
    title: job.title,
    description: job.formalDescription || job.linkedinPost || job.title,
    skills: [...(job.requiredSkills || []), ...(job.techStack || [])],
    experienceRange: job.experienceRange || null,
  };
}

export function toSessionQuestions(rows) {
  return rows
    .filter((q) => q.isActive !== false)
    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
    .map((q) => ({
      id: q.id,
      question: q.question,
      category: q.category,
      difficulty: q.difficulty,
      idealAnswer: q.idealAnswer,
      expectedKeywords: q.expectedKeywords || [],
      scoreWeight: q.scoreWeight || 1,
    }));
}
