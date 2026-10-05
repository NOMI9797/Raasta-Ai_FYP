import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { canUseSystem } from "@/libs/system/access";
import { isServiceUp } from "@/libs/system/status";
import { SystemError, startService, stopService } from "@/libs/system/supervisor";

// POST /api/system/services/[serviceId]  { action: "start" | "stop" | "restart" }
// Only the hiring worker, the interview engine and the AI engine can be controlled, with fixed commands.
// The browser sends an id and an action, never a command. Poll GET /api/system/status to follow progress.
export const POST = withAuth(async (request, { params, user }) => {
  if (!canUseSystem(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (!["start", "stop", "restart"].includes(body.action)) {
    return NextResponse.json({ error: "action must be start, stop or restart" }, { status: 400 });
  }
  try {
    const deps = { isUp: (def) => isServiceUp(def) };
    let result;
    if (body.action === "stop") {
      result = await stopService(params.serviceId, deps);
    } else {
      if (body.action === "restart") await stopService(params.serviceId, { isUp: async () => false });
      result = await startService(params.serviceId, deps);
    }
    return NextResponse.json({ success: true, result });
  } catch (error) {
    if (error instanceof SystemError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("Service control error:", error?.message);
    return NextResponse.json({ error: "Could not do that" }, { status: 500 });
  }
}, { requireUser: true });
