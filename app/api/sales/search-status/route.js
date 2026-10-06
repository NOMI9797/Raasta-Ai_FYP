import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { searchProviderName } from "@/libs/sales/company-research";

// GET /api/sales/search-status — which web search the app uses (Rozee.pk search and company research)
export const GET = withAuth(async () => NextResponse.json({ success: true, provider: searchProviderName() }), { requireUser: true });
