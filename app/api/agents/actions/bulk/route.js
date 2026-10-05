import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { ActionError, decideAction } from "@/libs/agent/actions";
import { requestAgentTick } from "@/libs/agent/triggers";

const MAX_BULK = 200;

// POST /api/agents/actions/bulk — { ids: [...], decision: "approve" | "reject" }
// Approves the agent's proposals as they are. Escalated requests are refused here: each one
// needs its own decision.
export const POST = withAuth(async (request, { user }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids)].slice(0, MAX_BULK) : [];
    if (!ids.length) return NextResponse.json({ error: "ids must be a non-empty array" }, { status: 400 });

    const result = { decided: 0, skipped: 0, errors: [] };
    const runs = new Set();
    for (const actionId of ids) {
      try {
        const action = await decideAction({
          actionId, userId: user.id, isAdmin: user.role === "admin", decision: body.decision, bulk: true,
        });
        runs.add(action.agentRunId);
        result.decided += 1;
      } catch (error) {
        if (!(error instanceof ActionError)) throw error;
        result.skipped += 1;
        if (result.errors.length < 5) result.errors.push(error.message);
      }
    }
    for (const runId of runs) await requestAgentTick(runId, { delayMs: 0 });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Bulk agent decision error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
