import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { candidates, jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { DecisionError, applyDecision } from "@/libs/hiring/decisions";

function ownerFilter(jobId, user) {
  return user.role === "admin"
    ? eq(jobs.id, jobId)
    : and(eq(jobs.id, jobId), eq(jobs.userId, user.id));
}

// POST /api/hiring/candidates/[candidateId]/decision — body { decision, note? }
// decision: final_shortlisted | final_rejected | hired | rejected (validated with canTransition)
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const { candidateId } = params;
    const body = await request.json().catch(() => ({}));

    const [candidate] = await db
      .select({ id: candidates.id, jobId: candidates.jobId })
      .from(candidates)
      .where(eq(candidates.id, candidateId))
      .limit(1);
    if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    const [job] = await db.select({ id: jobs.id }).from(jobs).where(ownerFilter(candidate.jobId, user)).limit(1);
    if (!job) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const updated = await applyDecision({
      candidateId,
      decision: body?.decision,
      decidedBy: user.id,
      note: typeof body?.note === "string" ? body.note : null,
    });
    return NextResponse.json({ success: true, candidate: { id: updated.id, status: updated.status, finalDecidedAt: updated.finalDecidedAt } });
  } catch (error) {
    if (error instanceof DecisionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Decision error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
