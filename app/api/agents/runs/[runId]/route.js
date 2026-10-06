import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { agentRuns, agentSteps } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { listRunActions } from "@/libs/agent/actions";
import { RECRUITER_PIPELINE } from "@/libs/agent/runs";
import { getRunActivity } from "@/libs/agent/run-summary";
import { RECRUITER_STEPS } from "@/libs/agent/recruiter-agent";

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

    // Supervised agents (recruiter and sales): the audit trail of what was done automatically, what was approved and by whom
    const actions = await listRunActions(runId, { limit: 200 });

    let activity = null;
    if (run.pipelineType === RECRUITER_PIPELINE) {
      const stepLabels = Object.fromEntries(RECRUITER_STEPS.map((s) => [s.key, s.label]));
      activity = (await getRunActivity([run], { stepLabels })).get(run.id) || null;
    }
    return NextResponse.json({ success: true, run: activity ? { ...run, activity } : run, steps, actions });
  } catch (error) {
    console.error("Get agent run error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
