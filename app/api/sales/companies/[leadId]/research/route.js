import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/libs/db";
import { withAuth } from "@/libs/auth-middleware";
import { leads } from "@/libs/schema";
import { LeadActionError, researchCompanyLead } from "@/libs/sales/lead-actions";

export const maxDuration = 60;

// POST /api/sales/companies/[leadId]/research — find the company's website, contact details and decision-makers
export const POST = withAuth(async (request, { user, params }) => {
  try {
    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, params.leadId), eq(leads.userId, user.id)))
      .limit(1);
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    const updated = await researchCompanyLead(lead);
    return NextResponse.json({ success: true, lead: updated, research: updated.sourceData.research });
  } catch (error) {
    if (error instanceof LeadActionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Company research error:", error);
    return NextResponse.json({ error: "Research failed" }, { status: 500 });
  }
}, { requireUser: true });
