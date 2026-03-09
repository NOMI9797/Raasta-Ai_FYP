import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { candidates, jobs } from "@/libs/schema";
import { eq } from "drizzle-orm";
import OpenAI from "openai";

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY || "",
  baseURL: "https://api.groq.com/openai/v1",
});

async function extractTextFromFile(file) {
  const name = file.name?.toLowerCase() || "";
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // .docx — use mammoth for clean text extraction
  if (name.endsWith(".docx")) {
    try {
      const mammoth = (await import("mammoth")).default;
      const result = await mammoth.extractRawText({ buffer });
      return result.value?.trim() || "";
    } catch (err) {
      console.error("mammoth extraction error:", err);
      return "";
    }
  }

  // .txt — plain text, safe to decode
  if (name.endsWith(".txt")) {
    return buffer.toString("utf-8").trim();
  }

  // .pdf — attempt plain text decode (works for text-based PDFs, not scanned)
  if (name.endsWith(".pdf")) {
    const raw = buffer.toString("latin1");
    // Extract readable ASCII chunks between PDF binary noise
    const chunks = raw.match(/[A-Za-z0-9 .,:\-\n\r\t@/()&+]{20,}/g) || [];
    return chunks.join(" ").replace(/\s+/g, " ").trim();
  }

  // fallback: try utf-8
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

// POST /api/hiring/apply/[jobId] — public endpoint for candidates to apply
export async function POST(request, { params }) {
  try {
    const { jobId } = params;

    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status === "closed") {
      return NextResponse.json(
        { error: "This position is no longer accepting applications" },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const name = formData.get("name")?.toString().trim();
    const email = formData.get("email")?.toString().trim();
    const linkedinUrl = formData.get("linkedinUrl")?.toString().trim() || null;
    const coverNote = formData.get("coverNote")?.toString().trim() || null;
    const resumeFile = formData.get("resume");

    if (!name || !email) {
      return NextResponse.json(
        { error: "Name and email are required" },
        { status: 400 }
      );
    }

    let resumeUrl = null;
    let parsedData = null;

    if (resumeFile && resumeFile instanceof File && resumeFile.size > 0) {
      resumeUrl = `uploaded:${resumeFile.name}`;
      try {
        const text = await extractTextFromFile(resumeFile);
        if (text.length > 30) {
          parsedData = await parseResumeWithLLM(text);
        } else {
          parsedData = { parseError: "Could not extract readable text from resume" };
        }
      } catch (err) {
        console.error("Resume processing error:", err);
        parsedData = { parseError: "Failed to process resume" };
      }
    }

    const [candidate] = await db
      .insert(candidates)
      .values({
        jobId: job.id,
        userId: job.userId,
        name,
        email,
        linkedinUrl,
        coverNote,
        resumeUrl,
        parsedData,
        status: "new",
      })
      .returning();

    return NextResponse.json({
      success: true,
      message: "Application submitted successfully",
      candidateId: candidate.id,
    });
  } catch (error) {
    console.error("Apply error:", error);
    return NextResponse.json(
      { error: "Failed to submit application" },
      { status: 500 }
    );
  }
}
