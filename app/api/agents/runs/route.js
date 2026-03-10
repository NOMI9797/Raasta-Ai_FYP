import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { agentRuns, agentConfigs } from "@/libs/schema";
import { eq, desc } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { AgentRunner, getPipelineDefinition } from "@/libs/agent-runner";

export const GET = withAuth(async (request, { user }) => {
  try {
    const isAdmin = user.role === "admin";
    const runs = isAdmin
      ? await db.select().from(agentRuns).orderBy(desc(agentRuns.createdAt)).limit(50)
      : await db
          .select()
          .from(agentRuns)
          .where(eq(agentRuns.userId, user.id))
          .orderBy(desc(agentRuns.createdAt))
          .limit(50);

    return NextResponse.json({ success: true, runs });
  } catch (error) {
    console.error("List agent runs error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });

export const POST = withAuth(async (request, { user }) => {
  try {
    const body = await request.json();
    const { agentConfigId, pipelineType, mode, config } = body;

    let finalPipelineType = pipelineType;
    let finalMode = mode || "semi_auto";
    let finalConfig = config || {};

    // If launching from a saved config, load it
    if (agentConfigId) {
      const [cfg] = await db
        .select()
        .from(agentConfigs)
        .where(eq(agentConfigs.id, agentConfigId))
        .limit(1);

      if (!cfg) {
        return NextResponse.json({ error: "Agent config not found" }, { status: 404 });
      }

      finalPipelineType = cfg.pipelineType;
      finalMode = cfg.mode;
      finalConfig = { ...cfg.config, ...config };
    }

    if (!finalPipelineType) {
      return NextResponse.json({ error: "pipelineType is required" }, { status: 400 });
    }

    // Validate pipeline exists
    const pipeline = await getPipelineDefinition(finalPipelineType);

    // Create the run record
    const [run] = await db
      .insert(agentRuns)
      .values({
        agentConfigId: agentConfigId || null,
        userId: user.id,
        pipelineType: finalPipelineType,
        mode: finalMode,
        status: "queued",
        totalSteps: pipeline.steps.length,
      })
      .returning();

    // Execute in background (non-blocking)
    const runner = new AgentRunner({
      runId: run.id,
      pipeline,
      mode: finalMode,
      userId: user.id,
      config: finalConfig,
    });

    runner.execute().catch((err) => {
      console.error(`Agent run ${run.id} failed unexpectedly:`, err);
    });

    return NextResponse.json({ success: true, run }, { status: 201 });
  } catch (error) {
    console.error("Create agent run error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
