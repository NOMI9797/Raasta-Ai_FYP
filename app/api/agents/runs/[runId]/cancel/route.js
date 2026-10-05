import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { agentRuns } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { RECRUITER_PIPELINE } from "@/libs/agent/runs";
import { RunError, stopRun } from "@/libs/agent/launch";

export const POST = withAuth(async (request, { user, params }) => {
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

    // Recruiter agent: also withdraw its open requests from the approval inbox
    if (run.pipelineType === RECRUITER_PIPELINE) {
      try {
        await stopRun(run);
      } catch (error) {
        if (error instanceof RunError) return NextResponse.json({ error: error.message }, { status: error.status });
        throw error;
      }
      return NextResponse.json({ success: true, message: "Run stopped" });
    }

    if (["completed", "failed", "cancelled"].includes(run.status)) {
      return NextResponse.json(
        { error: `Run is already ${run.status}` },
        { status: 400 }
      );
    }

    await db
      .update(agentRuns)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(eq(agentRuns.id, runId));

    return NextResponse.json({ success: true, message: "Run cancelled" });
  } catch (error) {
    console.error("Cancel agent run error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
