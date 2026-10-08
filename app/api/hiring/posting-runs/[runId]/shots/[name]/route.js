import fs from "node:fs";
import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { getRun } from "@/libs/poster/runs";
import { shotPath } from "@/libs/poster/shots";

// GET /api/hiring/posting-runs/[runId]/shots/[name]
//   A screenshot of one step of a run, for the person who started it (or an admin). The name must be one the engine wrote.
export const GET = withAuth(async (request, { params, user }) => {
  try {
    const run = await getRun(params.runId);
    if (!run || (user.role !== "admin" && run.userId !== user.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const file = shotPath(run.id, params.name);
    if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
    let bytes;
    try {
      bytes = await fs.promises.readFile(file);
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return new NextResponse(bytes, { status: 200, headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    console.error("Posting run screenshot error:", error.message);
    return NextResponse.json({ error: "Couldn't load the screenshot" }, { status: 500 });
  }
}, { requireUser: true });
