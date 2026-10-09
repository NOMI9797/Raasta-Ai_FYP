import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { RunError, checkLinkedInNow } from "@/libs/agent/launch";

// POST /api/agents/runs/[runId]/check-linkedin — check accepted invites and new LinkedIn replies now
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const run = await checkLinkedInNow(params.runId, user);
    return NextResponse.json({ success: true, run });
  } catch (error) {
    if (error instanceof RunError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Check LinkedIn now error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
