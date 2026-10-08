import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { buildOverview } from "@/libs/dashboard/overview";

// GET /api/dashboard/overview - the numbers on the Home screen for the signed-in user
export const GET = withAuth(async (request, { user }) => {
  try {
    return NextResponse.json({ success: true, ...(await buildOverview(user)) });
  } catch (error) {
    console.error("Dashboard overview error:", error?.message);
    return NextResponse.json({ error: "Failed to load the overview" }, { status: 500 });
  }
}, { requireUser: true });
