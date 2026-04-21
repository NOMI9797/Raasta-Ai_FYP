import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { db } from "@/libs/db";
import { getAdapter, PLATFORM_IDS } from "@/libs/platforms";

/**
 * Lead Scraper — platform-agnostic search entrypoint.
 *
 * Body:
 *   {
 *     platform: "rozee" | "linkedin" | "indeed",
 *     filters: { query?: string, location?: string, keywords?: string, limit?: number }
 *   }
 *
 * Returns raw results in memory (no DB writes). The caller reviews the list
 * and then POSTs to /api/leads/scrape/import to persist selected rows into
 * a campaign.
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const body = await request.json();
    const platform = (body?.platform || "").trim();
    const filters = body?.filters && typeof body.filters === "object" ? body.filters : {};

    if (!platform || !PLATFORM_IDS.includes(platform)) {
      return NextResponse.json(
        { error: `Unsupported platform. Expected one of: ${PLATFORM_IDS.join(", ")}` },
        { status: 400 }
      );
    }

    const adapter = getAdapter(platform);

    if (adapter.comingSoon || typeof adapter.search !== "function") {
      return NextResponse.json(
        { error: `${adapter.label} scraping is not available yet.`, results: [] },
        { status: 400 }
      );
    }

    // Resolve the user's active account for this platform, if the adapter has
    // an accounts table. Adapters without an accounts table (e.g. Indeed stub)
    // can't be reached here because they short-circuit above.
    let account = null;
    if (adapter.accountsTable) {
      const table = adapter.accountsTable;
      const [row] = await db
        .select()
        .from(table)
        .where(and(eq(table.userId, user.id), eq(table.isActive, true)))
        .limit(1);
      account = row || null;
      if (!account) {
        return NextResponse.json(
          { error: `No active ${adapter.label} account. Connect one under Platforms → ${adapter.label}.` },
          { status: 400 }
        );
      }
    }

    const result = await adapter.search(account, filters);
    if (!result?.success) {
      return NextResponse.json(
        { error: result?.error || "Search failed", results: [] },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      platform,
      count: (result.results || []).length,
      results: result.results || [],
    });
  } catch (error) {
    console.error("Lead scraper error:", error);
    return NextResponse.json(
      { error: error.message || "Lead scraper failed" },
      { status: 500 }
    );
  }
});
