import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { candidates, jobs } from "@/libs/schema";
import { eq } from "drizzle-orm";
import OpenAI from "openai";

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY || "",
  baseURL: "https://api.groq.com/openai/v1",
});

async function parseResumeWithLLM(resumeText) {
  const systemPrompt = `You are an expert resume parser. Extract structured data from the resume text.
Return a valid JSON object with these fields:
{
  "skills": ["skill1", "skill2"],
  "yearsExperience": number or null,
  "education": ["degree - institution"],
  "jobTitles": ["title1", "title2"],
  "summary": "1-2 sentence summary of the candidate"
}
Return ONLY the JSON, nothing else.`;

  const completion = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Parse this resume:\n\n${resumeText}` },
    ],
    temperature: 0.2,
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
      const text = await resumeFile.text();
      resumeUrl = `uploaded:${resumeFile.name}`;

      if (text.length > 50) {
        try {
          parsedData = await parseResumeWithLLM(text.slice(0, 6000));
        } catch (err) {
          console.error("Resume parsing error:", err);
          parsedData = { parseError: "Failed to parse resume" };
        }
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
