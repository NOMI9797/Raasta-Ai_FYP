import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { ActionError, decideAction } from "@/libs/agent/actions";
import { requestAgentTick } from "@/libs/agent/triggers";

// POST /api/agents/actions/[actionId] — { decision: "approve" | "reject", choice?, note? }
// The decision is recorded here; the agent carries it out in the hiring worker moments later.
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const action = await decideAction({
      actionId: params.actionId,
      userId: user.id,
      isAdmin: user.role === "admin",
      decision: body.decision,
      choice: body.choice ?? null,
      note: body.note ?? null,
    });
    await requestAgentTick(action.agentRunId, { delayMs: 0 });
    return NextResponse.json({ success: true, action });
  } catch (error) {
    if (error instanceof ActionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("Decide agent action error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
