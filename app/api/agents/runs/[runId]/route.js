import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { agentRuns, agentSteps } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";

export const GET = withAuth(async (request, { user, params }) => {
  try {
    const { runId } = await params;
    const isAdmin = user.role === "admin";

    const filter = isAdmin
      ? eq(agentRuns.id, runId)
      : and(eq(agentRuns.id, runId), eq(agentRuns.userId, user.id));

    const [run] = await db.select().from(agentRuns).where(filter).limit(1);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const steps = await db
      .select()
      .from(agentSteps)
      .where(eq(agentSteps.agentRunId, runId))
      .orderBy(agentSteps.stepIndex);

    return NextResponse.json({ success: true, run, steps });
  } catch (error) {
    console.error("Get agent run error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
