import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { candidates, jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { parseResumeWithLLM } from "@/libs/hiring/resume-text";

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

    const parsedData = { ...(await parseResumeWithLLM(contextParts.join("\n\n"))) };

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
    console.error("Reparse error:", error?.code || error?.message);
    return NextResponse.json({ error: "Failed to re-parse" }, { status: 500 });
  }
}, { requireUser: true });
