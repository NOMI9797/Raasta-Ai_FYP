import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { candidates } from "@/libs/schema";
import { eq } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { getOwnedCandidate } from "@/libs/hiring/access";
import { isValidCandidateStatus } from "@/libs/hiring/stages";
import { logStatusChange } from "@/libs/hiring/activity";

// PATCH /api/hiring/candidates/[candidateId] — update candidate status
export const PATCH = withAuth(async (request, { params, user }) => {
  try {
    const { candidateId } = params;
    const body = await request.json();
    const { status } = body;

    if (status && !isValidCandidateStatus(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const { candidate, error, status: errorStatus } = await getOwnedCandidate(candidateId, user);
    if (error) {
      return NextResponse.json({ error }, { status: errorStatus });
    }

    const updateData = {};
    if (status) updateData.status = status;
    updateData.updatedAt = new Date();

    const [updated] = await db
      .update(candidates)
      .set(updateData)
      .where(eq(candidates.id, candidateId))
      .returning();

    if (status && status !== candidate.status) {
      await logStatusChange({ candidate, toStatus: status, actorId: user.id });
    }

    return NextResponse.json({ success: true, candidate: updated });
  } catch (error) {
    console.error("Update candidate error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });

// DELETE /api/hiring/candidates/[candidateId]
export const DELETE = withAuth(async (request, { params, user }) => {
  try {
    const { candidateId } = params;

    const { error, status: errorStatus } = await getOwnedCandidate(candidateId, user);
    if (error) {
      return NextResponse.json({ error }, { status: errorStatus });
    }

    await db.delete(candidates).where(eq(candidates.id, candidateId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete candidate error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
