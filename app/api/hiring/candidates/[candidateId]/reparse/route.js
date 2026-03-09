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

async function parseResumeWithLLM(resumeText) {
  const systemPrompt = `You are an expert resume parser. Extract structured data from the resume text.
Return a valid JSON object with exactly these fields:
{
  "skills": ["skill1", "skill2"],
  "yearsExperience": <number or null>,
  "education": ["degree - institution"],
  "jobTitles": ["title1", "title2"],
  "summary": "1-2 sentence professional summary of the candidate"
}
Return ONLY the JSON object. No explanation, no markdown, no extra text.`;

  const completion = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Parse this resume:\n\n${resumeText.slice(0, 6000)}` },
    ],
    temperature: 0.1,
    max_tokens: 800,
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
// Re-parses from cover note + LinkedIn URL + name/email as context when no resume text is available
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

    // Build a text context from available info
    const body = await request.json().catch(() => ({}));
    const resumeText = body.resumeText || "";

    const contextParts = [];
    if (resumeText) contextParts.push(`Resume:\n${resumeText}`);
    if (candidate.coverNote) contextParts.push(`Cover Note:\n${candidate.coverNote}`);
    if (candidate.name) contextParts.push(`Candidate Name: ${candidate.name}`);
    if (candidate.email) contextParts.push(`Email: ${candidate.email}`);
    if (candidate.linkedinUrl) contextParts.push(`LinkedIn: ${candidate.linkedinUrl}`);

    if (contextParts.length === 0) {
      return NextResponse.json({ error: "No content to parse" }, { status: 400 });
    }

    const parsedData = await parseResumeWithLLM(contextParts.join("\n\n"));

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
