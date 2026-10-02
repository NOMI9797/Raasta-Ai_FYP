import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { candidates } from "@/libs/schema";
import { eq } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { parseResumeWithLLM } from "@/libs/hiring/resume-parser";
import { getOwnedCandidate } from "@/libs/hiring/access";
import { logCandidateActivity, ACTIVITY_TYPES } from "@/libs/hiring/activity";

// POST /api/hiring/candidates/[candidateId]/reparse
// Uses stored resume text from DB — no file upload needed
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const { candidateId } = params;

    const { candidate, error, status } = await getOwnedCandidate(candidateId, user);
    if (error) {
      return NextResponse.json({ error }, { status });
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

    await logCandidateActivity({
      candidateId,
      jobId: candidate.jobId,
      type: ACTIVITY_TYPES.RESUME_PARSED,
      actorId: user.id,
      message: "Resume re-parsed by AI",
      metadata: { skillsFound: parsedData.skills?.length || 0 },
    });

    return NextResponse.json({ success: true, candidate: updated });
  } catch (error) {
    console.error("Reparse error:", error);
    return NextResponse.json({ error: "Failed to re-parse" }, { status: 500 });
  }
}, { requireUser: true });
