import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { hunterEnabled, searchProviderName } from "@/libs/sales/company-research";

// GET /api/sales/research/status — which research services are set up (yes/no only, never the keys)
export const GET = withAuth(async () => {
  return NextResponse.json({ success: true, searchProvider: searchProviderName(), hunter: hunterEnabled() });
}, { requireUser: true });
