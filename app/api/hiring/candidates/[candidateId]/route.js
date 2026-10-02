import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { candidates, jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";

// PATCH /api/hiring/candidates/[candidateId] — update candidate status
export const PATCH = withAuth(async (request, { params, user }) => {
  try {
    const { candidateId } = params;
    const body = await request.json();
    const { status } = body;

    const ALLOWED = ["new", "reviewed", "shortlisted", "rejected"];
    if (status && !ALLOWED.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

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

    const updateData = {};
    if (status) updateData.status = status;
    updateData.updatedAt = new Date();

    const [updated] = await db
      .update(candidates)
      .set(updateData)
      .where(eq(candidates.id, candidateId))
      .returning();

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

    await db.delete(candidates).where(eq(candidates.id, candidateId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete candidate error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
