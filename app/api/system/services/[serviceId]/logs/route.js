import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { canUseSystem } from "@/libs/system/access";
import { SERVICE_ID } from "@/libs/system/services";
import { readLogTail } from "@/libs/system/supervisor";

// GET /api/system/services/[serviceId]/logs: the last lines of a program that was started from the app
// (keys and tokens blanked out). Programs started from a terminal log to that terminal.
export const GET = withAuth(async (request, { params, user }) => {
  if (!canUseSystem(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const allowed = [SERVICE_ID.WORKER, SERVICE_ID.ENGINE, SERVICE_ID.AI_ENGINE];
  if (!allowed.includes(params.serviceId)) return NextResponse.json({ error: "Unknown program" }, { status: 404 });
  return NextResponse.json({ success: true, lines: readLogTail(params.serviceId, { maxLines: 120 }) });
}, { requireUser: true });
