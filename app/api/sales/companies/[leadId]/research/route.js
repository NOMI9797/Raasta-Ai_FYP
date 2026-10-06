import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/libs/db";
import { withAuth } from "@/libs/auth-middleware";
import { leads } from "@/libs/schema";
import { PLATFORM_KIND } from "@/libs/sales/stages";
import { companyNameOf, jobsOf } from "@/libs/sales/companies";
import { researchCompany } from "@/libs/sales/company-research";

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
    if (PLATFORM_KIND[lead.source] !== "company") {
      return NextResponse.json({ error: "Only company leads (Rozee.pk, Indeed) are researched here" }, { status: 400 });
    }

    const name = companyNameOf(lead);
    if (!name) return NextResponse.json({ error: "This job post has no company name to research" }, { status: 400 });

    const sourceData = lead.sourceData || {};
    const research = await researchCompany({
      name,
      location: sourceData.location || jobsOf(lead)[0]?.location,
      knownWebsite: sourceData.company?.website,
    });

    const [updated] = await db
      .update(leads)
      .set({ sourceData: { ...sourceData, research }, updatedAt: new Date() })
      .where(eq(leads.id, lead.id))
      .returning();

    return NextResponse.json({ success: true, lead: updated, research });
  } catch (error) {
    console.error("Company research error:", error);
    return NextResponse.json({ error: "Research failed" }, { status: 500 });
  }
}, { requireUser: true });
