import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { db } from "@/libs/db";
import { leads, rozeeAccounts } from "@/libs/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getAdapter } from "@/libs/platforms";

/**
 * POST /api/rozee/leads/scrape
 * Body: { leadId?: string, leadIds?: string[] }
 *
 * Synchronously scrapes Rozee candidate profiles for the given lead(s) using
 * the active Rozee account's session and writes name / title / sourceData /
 * profilePicture back on the lead row. Used by the campaign workspace to
 * "enrich" Rozee-sourced leads before AI message generation.
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.leadIds)
      ? body.leadIds
      : body.leadId
        ? [body.leadId]
        : [];

    if (ids.length === 0) {
      return NextResponse.json({ error: "leadId or leadIds is required" }, { status: 400 });
    }

    const rows = await db
      .select()
      .from(leads)
      .where(and(eq(leads.userId, user.id), inArray(leads.id, ids)));

    const rozeeLeads = rows.filter((l) => l.source === "rozee");
    if (rozeeLeads.length === 0) {
      return NextResponse.json(
        { error: "No Rozee leads found in the supplied ids" },
        { status: 400 }
      );
    }

    const [account] = await db
      .select()
      .from(rozeeAccounts)
      .where(and(eq(rozeeAccounts.userId, user.id), eq(rozeeAccounts.isActive, true)))
      .limit(1);

    if (!account) {
      return NextResponse.json(
        { error: "No active Rozee account. Connect and activate a Rozee account first." },
        { status: 400 }
      );
    }

    const adapter = getAdapter("rozee");
    const results = [];

    for (const lead of rozeeLeads) {
      try {
        const { success, candidate, error } = await adapter.scrapeCandidate(account, lead.url);
        if (!success || !candidate) {
          await db
            .update(leads)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(leads.id, lead.id));
          results.push({ leadId: lead.id, success: false, error: error || "scrape failed" });
          continue;
        }

        await db
          .update(leads)
          .set({
            name: candidate.name || lead.name || "Unknown",
            title: candidate.title || lead.title || null,
            profilePicture: candidate.profileImage || lead.profilePicture || null,
            sourceData: {
              skills: candidate.skills || [],
              experience: candidate.experience || null,
              education: candidate.education || null,
              email: candidate.email || null,
            },
            status: "completed",
            updatedAt: new Date(),
          })
          .where(eq(leads.id, lead.id));

        results.push({ leadId: lead.id, success: true });
      } catch (error) {
        console.error(`Rozee scrape failed for lead ${lead.id}:`, error);
        await db
          .update(leads)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(leads.id, lead.id));
        results.push({ leadId: lead.id, success: false, error: error.message });
      }
    }

    const ok = results.filter((r) => r.success).length;
    return NextResponse.json({
      success: ok > 0,
      scraped: ok,
      failed: results.length - ok,
      results,
    });
  } catch (error) {
    console.error("Rozee leads scrape error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to scrape Rozee leads" },
      { status: 500 }
    );
  }
});
