import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/libs/db";
import { withAuth } from "@/libs/auth-middleware";
import { agentRuns, leads } from "@/libs/schema";
import { LeadActionError, addCompanyContact } from "@/libs/sales/lead-actions";
import { requestAgentTick } from "@/libs/agent/triggers";
import { ACTIVE_RUN_STATUSES } from "@/libs/agent/runs";

export const maxDuration = 60;

// POST /api/sales/companies/[leadId]/contact { channel: "email"|"linkedin", address, name?, title? }
// Moves a company out of "No contact": saves the contact a person found and writes the message for it.
export const POST = withAuth(async (request, { user, params }) => {
  try {
    const body = await request.json();
    const [lead] = await db.select().from(leads).where(and(eq(leads.id, params.leadId), eq(leads.userId, user.id))).limit(1);
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    const result = await addCompanyContact(lead, user.id, { channel: body.channel, address: body.address, name: body.name, title: body.title });
    // A sales agent working this campaign picks the new message up straight away
    const runs = await db.select({ id: agentRuns.id }).from(agentRuns)
      .where(and(eq(agentRuns.campaignId, lead.campaignId), eq(agentRuns.pipelineType, "sales_operator"), inArray(agentRuns.status, ACTIVE_RUN_STATUSES)));
    for (const run of runs) await requestAgentTick(run.id, { delayMs: 0 }).catch(() => {});
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof LeadActionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Add company contact error:", error);
    const status = error?.code === "rate_limit" ? 429 : 500;
    return NextResponse.json({ error: error?.code === "rate_limit" ? "The AI is busy. Try again in a minute." : "Could not add the contact" }, { status });
  }
}, { requireUser: true });
