import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { candidates, jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import OpenAI from "openai";
import mammoth from "mammoth";

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY || "",
  baseURL: "https://api.groq.com/openai/v1",
});

async function extractTextFromFile(file) {
  const name = file.name?.toLowerCase() || "";
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (name.endsWith(".docx")) {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value?.trim() || "";
    } catch (err) {
      console.error("mammoth error:", err);
      return "";
    }
  }
  if (name.endsWith(".txt")) return buffer.toString("utf-8").trim();
  if (name.endsWith(".pdf")) {
    const raw = buffer.toString("latin1");
    const chunks = raw.match(/[A-Za-z0-9 .,:\-\n\r\t@/()&+]{20,}/g) || [];
    return chunks.join(" ").replace(/\s+/g, " ").trim();
  }
  return buffer.toString("utf-8").trim();
}

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

    let resumeText = "";

    // 1. Check if a file was uploaded with this reparse request
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("resume");
      if (file && file instanceof File && file.size > 0) {
        resumeText = await extractTextFromFile(file);
      }
    }

    // 2. If no file uploaded, try stored resume text from the original parse
    if (!resumeText && candidate.parsedData?._resumeText) {
      resumeText = candidate.parsedData._resumeText;
    }

    // 3. Build context from all available sources
    const contextParts = [];
    if (resumeText) contextParts.push(resumeText);
    if (candidate.coverNote) contextParts.push(`Cover Note:\n${candidate.coverNote}`);
    if (!resumeText) {
      if (candidate.name) contextParts.push(`Name: ${candidate.name}`);
      if (candidate.email) contextParts.push(`Email: ${candidate.email}`);
      if (candidate.linkedinUrl) contextParts.push(`LinkedIn: ${candidate.linkedinUrl}`);
    }

    if (contextParts.length === 0) {
      return NextResponse.json({ error: "No content to parse" }, { status: 400 });
    }

    const parsedData = await parseResumeWithLLM(contextParts.join("\n\n"));

    // Preserve the stored resume text for future re-parses
    if (resumeText) {
      parsedData._resumeText = resumeText.slice(0, 10000);
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
