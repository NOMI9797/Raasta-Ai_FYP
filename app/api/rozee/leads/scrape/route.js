import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { db } from "@/libs/db";
import { leads, rozeeAccounts } from "@/libs/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getAdapter } from "@/libs/platforms";
import { isRozeeJobPostingUrl } from "@/libs/platform-urls";
import { enrichRozeeLeadInDb } from "@/libs/lead-rozee-enrichment";

/**
 * POST /api/rozee/leads/scrape
 * Body: { leadId?: string, leadIds?: string[] }
 *
 * Campaign workspace "Run" action:
 * - Job posting URLs → scrape job detail, tier/score, store under source_data.conversion
 * - Seeker profile URLs → scrape candidate profile (name, skills, etc.)
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
    console.log(`[ROZEE_ENRICH] user=${user.id} requested ids=${ids.length}`);

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
    console.log(`[ROZEE_ENRICH] found rozee leads=${rozeeLeads.length}`);

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
    console.log(`[ROZEE_ENRICH] using active account id=${account.id}`);

    const adapter = getAdapter("rozee");
    const results = [];

    for (const lead of rozeeLeads) {
      try {
        console.log(`[ROZEE_ENRICH] lead=${lead.id} url=${lead.url}`);
        if (isRozeeJobPostingUrl(lead.url)) {
          console.log(`[ROZEE_ENRICH] lead=${lead.id} mode=job_enrichment start`);
          await enrichRozeeLeadInDb(lead, account);
          console.log(`[ROZEE_ENRICH] lead=${lead.id} mode=job_enrichment done`);
          results.push({ leadId: lead.id, success: true, kind: "job_enrichment" });
          continue;
        }

        console.log(`[ROZEE_ENRICH] lead=${lead.id} mode=candidate_profile start`);
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

        results.push({ leadId: lead.id, success: true, kind: "profile" });
        console.log(
          `[ROZEE_ENRICH] lead=${lead.id} mode=candidate_profile done skills=${(candidate.skills || []).length} email=${candidate.email ? "yes" : "no"}`
        );
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
    console.log(
      `[ROZEE_ENRICH] completed user=${user.id} ok=${ok} failed=${results.length - ok}`
    );
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
