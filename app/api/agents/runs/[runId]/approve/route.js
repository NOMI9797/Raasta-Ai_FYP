import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { agentRuns, agentConfigs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { AgentRunner, getPipelineDefinition } from "@/libs/agent-runner";
import { RECRUITER_PIPELINE } from "@/libs/agent/runs";
import { findBlockingAction } from "@/libs/agent/launch";
import { ActionError, decideAction } from "@/libs/agent/actions";
import { requestAgentTick } from "@/libs/agent/triggers";

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

    // Recruiter agent: approve its pending blocking request (the job post); the worker continues
    if (run.pipelineType === RECRUITER_PIPELINE) {
      const action = await findBlockingAction(run.id);
      if (!action) return NextResponse.json({ error: "Nothing is waiting for approval" }, { status: 409 });
      try {
        await decideAction({ actionId: action.id, userId: user.id, isAdmin, decision: "approve" });
      } catch (error) {
        if (error instanceof ActionError) return NextResponse.json({ error: error.message }, { status: error.status });
        throw error;
      }
      await requestAgentTick(run.id, { delayMs: 0 });
      return NextResponse.json({ success: true, message: "Approved. The agent is continuing." });
    }

    // Load the original config from the agent config record
    let runConfig = {};
    if (run.agentConfigId) {
      const [cfg] = await db
        .select()
        .from(agentConfigs)
        .where(eq(agentConfigs.id, run.agentConfigId))
        .limit(1);
      if (cfg) runConfig = cfg.config || {};
    }

    const pipeline = await getPipelineDefinition(run.pipelineType);

    const runner = new AgentRunner({
      runId: run.id,
      pipeline,
      mode: run.mode,
      userId: run.userId,
      config: runConfig,
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
