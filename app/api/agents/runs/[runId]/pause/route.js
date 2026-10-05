import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { RunError, pauseRun } from "@/libs/agent/launch";

// POST /api/agents/runs/[runId]/pause — the pause switch: the agent does nothing until resumed
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const run = await pauseRun(params.runId, user);
    return NextResponse.json({ success: true, run });
  } catch (error) {
    if (error instanceof RunError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Pause agent run error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
