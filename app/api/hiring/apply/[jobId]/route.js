import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { candidates, jobs } from "@/libs/schema";
import { eq, and, sql } from "drizzle-orm";
import { validateResumeFile, processResumeFile } from "@/libs/hiring/resume-parser";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const email = formData.get("email")?.toString().trim().toLowerCase();
    const linkedinUrl = formData.get("linkedinUrl")?.toString().trim() || null;
    const coverNote = formData.get("coverNote")?.toString().trim() || null;
    const resumeFile = formData.get("resume");

    if (!name || !email) {
      return NextResponse.json(
        { error: "Name and email are required" },
        { status: 400 }
      );
    }

    if (!EMAIL_PATTERN.test(email)) {
      return NextResponse.json({ error: "Please enter a valid email address" }, { status: 400 });
    }

    const resumeError = validateResumeFile(resumeFile);
    if (resumeError) {
      return NextResponse.json({ error: resumeError }, { status: 400 });
    }

    // One application per email per job
    const [existing] = await db
      .select({ id: candidates.id })
      .from(candidates)
      .where(and(eq(candidates.jobId, job.id), sql`lower(${candidates.email}) = ${email}`))
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: "You have already applied for this position" },
        { status: 409 }
      );
    }

    let resumeUrl = null;
    let parsedData = null;

    if (resumeFile && typeof resumeFile.arrayBuffer === "function" && resumeFile.size > 0) {
      resumeUrl = `uploaded:${resumeFile.name}`;
      parsedData = await processResumeFile(resumeFile);
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
