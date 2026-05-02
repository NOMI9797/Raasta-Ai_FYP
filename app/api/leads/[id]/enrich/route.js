import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { db } from "@/libs/db";
import { leads, rozeeAccounts } from "@/libs/schema";
import { enrichRozeeLeadInDb } from "@/libs/lead-rozee-enrichment";

/**
 * POST /api/leads/[id]/enrich
 * Scrapes Rozee job detail, scores tier, stores conversion block in source_data.
 */
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const leadId = params.id;

    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.userId, user.id)))
      .limit(1);

    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    if (lead.source !== "rozee") {
      return NextResponse.json(
        { error: "Enrichment is only supported for Rozee.pk job leads" },
        { status: 400 }
      );
    }

    const [rozeeAcc] = await db
      .select()
      .from(rozeeAccounts)
      .where(and(eq(rozeeAccounts.userId, user.id), eq(rozeeAccounts.isActive, true)))
      .limit(1);

    await enrichRozeeLeadInDb(lead, rozeeAcc || {});

    const [updated] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.userId, user.id)))
      .limit(1);

    return NextResponse.json({ success: true, lead: updated });
  } catch (error) {
    console.error("Lead enrich error:", error);
    return NextResponse.json(
      { error: error.message || "Enrichment failed" },
      { status: 500 }
    );
  }
});
