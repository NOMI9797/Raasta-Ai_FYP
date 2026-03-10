import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { agentRuns } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { AgentRunner, getPipelineDefinition } from "@/libs/agent-runner";

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

    if (run.status !== "paused_at_checkpoint") {
      return NextResponse.json(
        { error: "Run is not paused at a checkpoint" },
        { status: 400 }
      );
    }

    const pipeline = await getPipelineDefinition(run.pipelineType);

    const runner = new AgentRunner({
      runId: run.id,
      pipeline,
      mode: run.mode,
      userId: run.userId,
      config: run.results || {},
    });

    // Resume in background
    runner.resumeAfterCheckpoint().catch((err) => {
      console.error(`Agent run ${run.id} resume failed:`, err);
    });

    return NextResponse.json({ success: true, message: "Checkpoint approved, resuming execution" });
  } catch (error) {
    console.error("Approve agent run error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
