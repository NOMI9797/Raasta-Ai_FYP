import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { publicRun } from "@/libs/poster/run-model";
import { getRun, requestCancel } from "@/libs/poster/runs";

// POST /api/hiring/posting-runs/[runId]/cancel
//   A run nobody has started is cancelled at once; a live one is told to stop, and the engine closes its window.
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const run = await getRun(params.runId);
    if (!run || (user.role !== "admin" && run.userId !== user.id)) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    const updated = await requestCancel(run.id);
    return NextResponse.json({ success: true, run: publicRun(updated || run) });
  } catch (error) {
    console.error("Cancel posting run error:", error.message);
    return NextResponse.json({ error: "Couldn't cancel the posting run" }, { status: 500 });
  }
}, { requireUser: true });
