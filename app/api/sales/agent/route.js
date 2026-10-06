import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/libs/db";
import { withAuth } from "@/libs/auth-middleware";
import { agentRuns, agentSteps, campaigns } from "@/libs/schema";
import { SALES_PIPELINE } from "@/libs/agent/runs";
import { emailSetup } from "@/libs/sales/send/email";
import { hunterEnabled, searchProviderName } from "@/libs/sales/company-research";
import { describePolicy, DEFAULTS } from "@/libs/sales/agent/policy";
import { SALES_STEPS } from "@/libs/sales/agent/sales-agent";

// GET /api/sales/agent — the Sales agent page: how sending and research are set up, the policy per mode,
// and the user's sales runs with their steps (admins see every run)
export const GET = withAuth(async (request, { user }) => {
  try {
    const isAdmin = user.role === "admin";
    const runs = await db
      .select({ run: agentRuns, campaignName: campaigns.name })
      .from(agentRuns)
      .leftJoin(campaigns, eq(campaigns.id, agentRuns.campaignId))
      .where(isAdmin ? eq(agentRuns.pipelineType, SALES_PIPELINE) : and(eq(agentRuns.pipelineType, SALES_PIPELINE), eq(agentRuns.userId, user.id)))
      .orderBy(desc(agentRuns.createdAt))
      .limit(30);

    const ids = runs.map((r) => r.run.id);
    const steps = ids.length ? await db.select().from(agentSteps).where(inArray(agentSteps.agentRunId, ids)).orderBy(agentSteps.stepIndex) : [];
    const stepsByRun = new Map();
    for (const s of steps) {
      if (!stepsByRun.has(s.agentRunId)) stepsByRun.set(s.agentRunId, []);
      stepsByRun.get(s.agentRunId).push(s);
    }

    return NextResponse.json({
      success: true,
      setup: { email: emailSetup(), research: { searchProvider: searchProviderName(), hunter: hunterEnabled() } },
      defaults: DEFAULTS,
      stepLabels: Object.fromEntries(SALES_STEPS.map((s) => [s.key, s.label])),
      policy: { assisted: describePolicy("assisted"), autopilot: describePolicy("autopilot") },
      runs: runs.map(({ run, campaignName }) => ({ ...run, campaignName, steps: stepsByRun.get(run.id) || [] })),
    });
  } catch (error) {
    console.error("Sales agent page error:", error);
    return NextResponse.json({ error: "Could not load the sales agent" }, { status: 500 });
  }
}, { requireUser: true });
