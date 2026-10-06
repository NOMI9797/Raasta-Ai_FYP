import { NextResponse } from "next/server";
import { and, count, eq, or, sql } from "drizzle-orm";
import { db } from "@/libs/db";
import { withAuth } from "@/libs/auth-middleware";
import { agentConfigs, campaigns, leads, linkedinAccounts, messages, rozeeAccounts } from "@/libs/schema";
import { buildSalesGuidance } from "@/libs/sales/guidance";
import { isIndeedJobSearchConfigured } from "@/libs/indeed-job-search";

const countWhere = async (table, where) => {
  const [row] = await db.select({ n: count() }).from(table).where(where);
  return Number(row?.n) || 0;
};

// GET /api/sales/guidance — the Sales setup guide checklist for the signed-in user
export const GET = withAuth(async (request, { user }) => {
  try {
    const mine = (table) => eq(table.userId, user.id);
    // A lead counts as researched once its profile was read (LinkedIn) or company details are known (job boards)
    const researched = or(
      eq(leads.status, "completed"),
      sql`${leads.sourceData}->'company'->>'website' is not null`,
      sql`${leads.sourceData}->'conversion' is not null`
    );

    const [linkedin, rozee, campaignCount, leadCount, researchedLeads, messageCount, contactedLeads, salesAgents] = await Promise.all([
      countWhere(linkedinAccounts, mine(linkedinAccounts)),
      countWhere(rozeeAccounts, mine(rozeeAccounts)),
      countWhere(campaigns, mine(campaigns)),
      countWhere(leads, mine(leads)),
      countWhere(leads, and(mine(leads), researched)),
      countWhere(messages, mine(messages)),
      countWhere(leads, and(mine(leads), or(eq(leads.inviteSent, true), eq(leads.messageSent, true)))),
      countWhere(agentConfigs, and(mine(agentConfigs), eq(agentConfigs.pipelineType, "sales_operator"))),
    ]);

    const guidance = buildSalesGuidance(
      {
        linkedinAccounts: linkedin,
        rozeeAccounts: rozee,
        campaigns: campaignCount,
        leads: leadCount,
        researchedLeads,
        messages: messageCount,
        contactedLeads,
        salesAgents,
      },
      { indeedReady: isIndeedJobSearchConfigured() }
    );
    return NextResponse.json({ success: true, guidance });
  } catch (error) {
    console.error("Sales guidance error:", error);
    return NextResponse.json({ error: "Could not build the setup guide" }, { status: 500 });
  }
}, { requireUser: true });
