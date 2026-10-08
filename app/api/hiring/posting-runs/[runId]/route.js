import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { publicRun } from "@/libs/poster/run-model";
import { getRun } from "@/libs/poster/runs";

// GET /api/hiring/posting-runs/[runId]
//   One run: its status, what it is waiting for, its steps and the outcome. Only the person who started it (or an admin).
export const GET = withAuth(async (request, { params, user }) => {
  try {
    const run = await getRun(params.runId);
    if (!run || (user.role !== "admin" && run.userId !== user.id)) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    return NextResponse.json({ success: true, run: publicRun(run) });
  } catch (error) {
    console.error("Get posting run error:", error.message);
    return NextResponse.json({ error: "Couldn't load the posting run" }, { status: 500 });
  }
}, { requireUser: true });
