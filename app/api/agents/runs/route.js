import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { agentRuns, agentConfigs } from "@/libs/schema";
import { and, eq, desc } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { RECRUITER_PIPELINE, SALES_PIPELINE } from "@/libs/agent/runs";
import { getRunActivity } from "@/libs/agent/run-summary";
import { RECRUITER_STEPS } from "@/libs/agent/recruiter-agent";
import { RunError, startRecruiterRun } from "@/libs/agent/launch";
import { startSalesRun } from "@/libs/sales/agent/launch";

export const GET = withAuth(async (request, { user }) => {
  try {
    // ?pipeline=recruiter | sales_operator lists one kind of run
    const pipeline = new URL(request.url).searchParams.get("pipeline");
    const filters = [];
    if (user.role !== "admin") filters.push(eq(agentRuns.userId, user.id));
    if (["recruiter", "sales_operator"].includes(pipeline)) filters.push(eq(agentRuns.pipelineType, pipeline));
    const runs = await db
      .select()
      .from(agentRuns)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(agentRuns.createdAt))
      .limit(50);

    // Hiring agent runs come with a plain-words activity line: what it is doing and whether it needs the person
    const stepLabels = Object.fromEntries(RECRUITER_STEPS.map((s) => [s.key, s.label]));
    const activity = await getRunActivity(runs.filter((r) => r.pipelineType === RECRUITER_PIPELINE), { stepLabels });
    return NextResponse.json({ success: true, runs: runs.map((r) => (activity.has(r.id) ? { ...r, activity: activity.get(r.id) } : r)) });
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

    // The recruiter agent is the supervised agent: it runs in the hiring worker, not in this request
    if (finalPipelineType === RECRUITER_PIPELINE) {
      try {
        const run = await startRecruiterRun({ user, agentConfigId: agentConfigId || null, mode: finalMode, config: finalConfig });
        return NextResponse.json({ success: true, run }, { status: 201 });
      } catch (error) {
        if (error instanceof RunError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
        throw error;
      }
    }

    // The sales agent also runs in the worker (libs/sales/agent): one supervised engine for both
    if (finalPipelineType === SALES_PIPELINE) {
      try {
        const run = await startSalesRun({ user, agentConfigId: agentConfigId || null, mode: finalMode, config: finalConfig });
        return NextResponse.json({ success: true, run }, { status: 201 });
      } catch (error) {
        if (error instanceof RunError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
        throw error;
      }
    }

    return NextResponse.json({ error: `Unknown pipeline: ${finalPipelineType}` }, { status: 400 });
  } catch (error) {
    console.error("Create agent run error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
