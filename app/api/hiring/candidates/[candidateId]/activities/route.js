import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { candidateActivities, users } from "@/libs/schema";
import { eq, desc } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { getOwnedCandidate } from "@/libs/hiring/access";
import { ACTIVITY_TYPES } from "@/libs/hiring/activity";

const MAX_NOTE_LENGTH = 2000;

// GET /api/hiring/candidates/[candidateId]/activities — candidate timeline, newest first
export const GET = withAuth(async (request, { params, user }) => {
  try {
    const { candidateId } = params;

    const { error, status } = await getOwnedCandidate(candidateId, user);
    if (error) {
      return NextResponse.json({ error }, { status });
    }

    const activities = await db
      .select({
        id: candidateActivities.id,
        type: candidateActivities.type,
        fromStatus: candidateActivities.fromStatus,
        toStatus: candidateActivities.toStatus,
        message: candidateActivities.message,
        metadata: candidateActivities.metadata,
        createdAt: candidateActivities.createdAt,
        actorName: users.name,
      })
      .from(candidateActivities)
      .leftJoin(users, eq(candidateActivities.actorId, users.id))
      .where(eq(candidateActivities.candidateId, candidateId))
      .orderBy(desc(candidateActivities.createdAt));

    return NextResponse.json({ success: true, activities });
  } catch (error) {
    console.error("List candidate activities error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });

// POST /api/hiring/candidates/[candidateId]/activities — add a recruiter note
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const { candidateId } = params;
    const body = await request.json().catch(() => ({}));
    const note = body.message?.toString().trim();

    if (!note) {
      return NextResponse.json({ error: "Note cannot be empty" }, { status: 400 });
    }
    if (note.length > MAX_NOTE_LENGTH) {
      return NextResponse.json(
        { error: `Note must be ${MAX_NOTE_LENGTH} characters or fewer` },
        { status: 400 }
      );
    }

    const { candidate, error, status } = await getOwnedCandidate(candidateId, user);
    if (error) {
      return NextResponse.json({ error }, { status });
    }

    const [activity] = await db
      .insert(candidateActivities)
      .values({
        candidateId,
        jobId: candidate.jobId,
        actorId: user.id,
        type: ACTIVITY_TYPES.NOTE,
        message: note,
      })
      .returning();

    return NextResponse.json({ success: true, activity }, { status: 201 });
  } catch (error) {
    console.error("Add candidate note error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
