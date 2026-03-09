import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import OpenAI from "openai";

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY || "",
  baseURL: "https://api.groq.com/openai/v1",
});

// POST /api/hiring/jobs/[jobId]/generate-post
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const { jobId } = params;
    const body = await request.json().catch(() => ({}));
    const tone = body.tone || "professional";

    const whereClause =
      user.role === "admin"
        ? eq(jobs.id, jobId)
        : and(eq(jobs.id, jobId), eq(jobs.userId, user.id));

    const [job] = await db.select().from(jobs).where(whereClause).limit(1);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const skills = (job.requiredSkills || []).join(", ") || "not specified";
    const stack = (job.techStack || []).join(", ") || "not specified";
    const salaryPart =
      job.salaryMin || job.salaryMax
        ? `Salary range: ${job.salaryCurrency || "USD"} ${job.salaryMin || "?"} – ${job.salaryMax || "?"}`
        : "";

    const systemPrompt = `You are an expert recruiter copywriter who creates engaging LinkedIn job posts.
Write in a ${tone} tone. The post should:
- Grab attention in the first line
- Highlight what makes this role exciting
- List key skills/stack concisely
- Include practical details (location, type, salary if provided)
- End with a clear call-to-action
- Use relevant emojis sparingly
- Be 150–250 words
Return ONLY the LinkedIn post text, nothing else.`;

    const userPrompt = `Create a LinkedIn job post for: "${job.title}"

Details:
- Required skills: ${skills}
- Tech stack: ${stack}
- Experience: ${job.experienceRange || "not specified"}
- Location: ${job.location || "not specified"} (${job.locationType || "not specified"})
- Employment type: ${job.employmentType || "full-time"}
${salaryPart}`;

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,
      max_tokens: 600,
    });

    const linkedinPost = completion.choices[0]?.message?.content?.trim() || "";

    if (!linkedinPost) {
      return NextResponse.json(
        { error: "AI returned empty response" },
        { status: 500 }
      );
    }

    const [updated] = await db
      .update(jobs)
      .set({ linkedinPost, updatedAt: new Date() })
      .where(whereClause)
      .returning();

    return NextResponse.json({ success: true, linkedinPost, job: updated });
  } catch (error) {
    console.error("Generate post error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate post" },
      { status: 500 }
    );
  }
}, { requireUser: true });
