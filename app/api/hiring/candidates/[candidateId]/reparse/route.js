import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { candidates, jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import OpenAI from "openai";

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY || "",
  baseURL: "https://api.groq.com/openai/v1",
});

async function parseResumeWithLLM(text) {
  const systemPrompt = `You are an expert resume parser. Extract ALL available structured data from the resume.
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

  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Parse this resume completely:\n\n${text.slice(0, 8000)}` },
    ],
    temperature: 0.1,
    max_tokens: 2000,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch {
    return { rawParsed: raw };
  }
}

// POST /api/hiring/candidates/[candidateId]/reparse
// Uses stored resume text from DB — no file upload needed
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const { candidateId } = params;

    const [candidate] = await db
      .select()
      .from(candidates)
      .where(eq(candidates.id, candidateId))
      .limit(1);

    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    const isAdmin = user.role === "admin";
    const [job] = await db
      .select()
      .from(jobs)
      .where(
        isAdmin
          ? eq(jobs.id, candidate.jobId)
          : and(eq(jobs.id, candidate.jobId), eq(jobs.userId, user.id))
      )
      .limit(1);

    if (!job) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Build context from stored data
    const contextParts = [];

    // Use stored resume text if available
    if (candidate.parsedData?._resumeText) {
      contextParts.push(candidate.parsedData._resumeText);
    }

    // Always include cover note
    if (candidate.coverNote) {
      contextParts.push(`Cover Note:\n${candidate.coverNote}`);
    }

    // Include basic info as context
    if (candidate.name) contextParts.push(`Candidate Name: ${candidate.name}`);
    if (candidate.email) contextParts.push(`Email: ${candidate.email}`);
    if (candidate.linkedinUrl) contextParts.push(`LinkedIn: ${candidate.linkedinUrl}`);

    if (contextParts.length === 0) {
      return NextResponse.json({ error: "No content to parse" }, { status: 400 });
    }

    const parsedData = await parseResumeWithLLM(contextParts.join("\n\n"));

    // Preserve stored resume text for future re-parses
    if (candidate.parsedData?._resumeText) {
      parsedData._resumeText = candidate.parsedData._resumeText;
    }

    const [updated] = await db
      .update(candidates)
      .set({ parsedData, updatedAt: new Date() })
      .where(eq(candidates.id, candidateId))
      .returning();

    return NextResponse.json({ success: true, candidate: updated });
  } catch (error) {
    console.error("Reparse error:", error);
    return NextResponse.json({ error: "Failed to re-parse" }, { status: 500 });
  }
}, { requireUser: true });
