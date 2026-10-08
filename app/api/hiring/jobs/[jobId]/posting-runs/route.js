import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { ENGINE_PLATFORMS, RUN_MODE, RunError, publicRun } from "@/libs/poster/run-model";
import { listRuns, reapStale } from "@/libs/poster/runs";
import { startPostingRun } from "@/libs/poster/service";
import { posterTarget, probeHttp } from "@/libs/system/services";

function ownerFilter(jobId, user) {
  return user.role === "admin" ? eq(jobs.id, jobId) : and(eq(jobs.id, jobId), eq(jobs.userId, user.id));
}

// GET /api/hiring/jobs/[jobId]/posting-runs?platform=indeed
//   The job's recent posting runs, newest first. The Publish panel polls this while a run is live.
export const GET = withAuth(async (request, { params, user }) => {
  try {
    const [job] = await db.select({ id: jobs.id }).from(jobs).where(ownerFilter(params.jobId, user)).limit(1);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    const platform = new URL(request.url).searchParams.get("platform");
    if (platform && !ENGINE_PLATFORMS.includes(platform)) return NextResponse.json({ error: "Unknown platform" }, { status: 400 });

    await reapStale().catch(() => {}); // a run whose engine died must not look live for ever
    const runs = await listRuns({ jobId: job.id, platform: platform || undefined, limit: 5 });
    return NextResponse.json({ success: true, runs: runs.map((run) => publicRun(run)) });
  } catch (error) {
    console.error("List posting runs error:", error.message);
    return NextResponse.json({ error: "Couldn't load the posting runs" }, { status: 500 });
  }
}, { requireUser: true });

// POST /api/hiring/jobs/[jobId]/posting-runs  { platform: "indeed", mode: "rehearsal" | "post" | "practice", options?: { openings } }
//   Queues a run for the posting engine, which opens a visible browser window on the machine it runs on.
//   rehearsal fills in every step and stops before the final confirm (nothing is posted); post waits for the person to press it;
//   practice does the whole run on a practice site that stands in for the platform (no account, nothing recorded).
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const platform = String(body.platform || "");
    const mode = [RUN_MODE.POST, RUN_MODE.PRACTICE].includes(body.mode) ? body.mode : RUN_MODE.REHEARSAL;

    const [job] = await db.select().from(jobs).where(ownerFilter(params.jobId, user)).limit(1);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    // An engine started before a platform or practice runs existed does not know them (and would take a practice run for a real post): refuse until it is restarted
    const engine = await probeHttp(posterTarget().healthUrl, { timeoutMs: 1500 });
    if (engine.up) {
      const knowsPlatform = engine.body?.platforms ? engine.body.platforms.includes(platform) : platform === "indeed";
      const knowsMode = mode !== RUN_MODE.PRACTICE || Boolean(engine.body?.modes?.includes(RUN_MODE.PRACTICE));
      // An engine from before runs were tied to an account opens one shared window profile, which may still be signed in to an account that was switched off or paused
      const knowsAccounts = platform !== "indeed" || mode === RUN_MODE.PRACTICE || engine.body?.accountProfiles === true;
      if (!knowsPlatform || !knowsMode || !knowsAccounts) {
        return NextResponse.json({ error: "The posting engine that is running is older than this version: it does not know this kind of run, or it would open the old shared browser window (possibly signed in to an account that was switched off or paused) instead of the one for your switched-on account. Restart it from the Setup guide first.", code: "engine_outdated" }, { status: 409 });
      }
    }

    const run = await startPostingRun({ job, platform, mode, options: body.options || {} });
    return NextResponse.json({ success: true, run: publicRun(run) }, { status: 201 });
  } catch (error) {
    if (error instanceof RunError) {
      return NextResponse.json({ error: error.message, code: error.code, ...(error.retryAt ? { retryAt: error.retryAt } : {}) }, { status: error.status });
    }
    console.error("Start posting run error:", error.message);
    return NextResponse.json({ error: "Couldn't start the posting run" }, { status: 500 });
  }
}, { requireUser: true });
