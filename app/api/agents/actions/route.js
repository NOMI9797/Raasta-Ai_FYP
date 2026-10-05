import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { listApprovedCandidateIds, listInbox } from "@/libs/agent/actions";
import { ESCALATION_LABELS } from "@/libs/agent/policy";

// GET /api/agents/actions?jobId= — the recruiter agent's approval inbox (pending requests)
export const GET = withAuth(async (request, { user }) => {
  try {
    const jobId = new URL(request.url).searchParams.get("jobId");
    const scope = { userId: user.id, isAdmin: user.role === "admin" };
    const [actions, inProgressCandidateIds] = await Promise.all([listInbox({ ...scope, jobId }), listApprovedCandidateIds(scope)]);
    // inProgressCandidateIds: approved, waiting for the agent to carry it out (not decided twice)
    return NextResponse.json({ success: true, actions, inProgressCandidateIds, escalationLabels: ESCALATION_LABELS });
  } catch (error) {
    console.error("List agent actions error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
