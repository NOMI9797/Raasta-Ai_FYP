import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { canUseSystem } from "@/libs/system/access";
import { getSystemStatus } from "@/libs/system/status";
import { ensureWorker } from "@/libs/system/worker-host";
import { buildGuidance, getGuidanceCounts } from "@/libs/system/guidance";

// Several tabs and the sidebar poll this; one observation is shared for a couple of seconds
const CACHE_MS = 2000;
let cache = { at: 0, value: null, pending: null };

// fresh=1 skips the shared reading: used right after a program was started or stopped, when a 2 second old answer is wrong
async function observe({ fresh = false } = {}) {
  if (fresh) {
    const value = await getSystemStatus();
    cache = { at: Date.now(), value, pending: null };
    return value;
  }
  if (cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;
  if (cache.pending) return cache.pending;
  cache.pending = getSystemStatus()
    .then((value) => {
      cache = { at: Date.now(), value, pending: null };
      return value;
    })
    .catch((error) => {
      cache.pending = null;
      throw error;
    });
  return cache.pending;
}

// GET /api/system/status[?guidance=1][&fresh=1]
// Is each program up, what is missing, and (with guidance=1) what the person should do next.
export const GET = withAuth(async (request, { user }) => {
  if (!canUseSystem(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Someone is looking at the system: make sure the worker the web server runs for them is alive
  ensureWorker({ reason: "status check" }).catch(() => {});
  try {
    const query = new URL(request.url).searchParams;
    const status = await observe({ fresh: query.get("fresh") === "1" });
    const wantsGuidance = query.get("guidance") === "1";
    if (!wantsGuidance) return NextResponse.json({ success: true, status });

    const running = status.services.filter((s) => s.state === "running").map((s) => s.id);
    const waiting = status.services.find((s) => s.id === "worker")?.waiting || 0;
    let guidance = null;
    try {
      guidance = buildGuidance({ counts: await getGuidanceCounts(user), running, waitingJobs: waiting });
    } catch (error) {
      console.error("Guidance error:", error?.message);
    }
    return NextResponse.json({ success: true, status, guidance });
  } catch (error) {
    console.error("System status error:", error?.message);
    return NextResponse.json({ error: "Could not check the system" }, { status: 500 });
  }
}, { requireUser: true });
