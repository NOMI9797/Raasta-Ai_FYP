import { NextResponse } from "next/server";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/libs/db";
import { withAuth } from "@/libs/auth-middleware";
import { agentActions, campaigns, leads, messages } from "@/libs/schema";
import { ACTION_STATUS } from "@/libs/agent/actions";
import { SALES_ESCALATION_LABELS, SALES_POLICY } from "@/libs/sales/agent/policy";

// GET /api/sales/agent/inbox — the sales agent's requests waiting for approval, oldest first,
// each with its lead, the message it would send and why it asks
export const GET = withAuth(async (request, { user }) => {
  try {
    const conditions = [eq(agentActions.status, ACTION_STATUS.PENDING), isNotNull(agentActions.campaignId)];
    if (user.role !== "admin") conditions.push(eq(agentActions.userId, user.id));

    const rows = await db
      .select({ action: agentActions, lead: leads, campaignName: campaigns.name })
      .from(agentActions)
      .innerJoin(leads, eq(leads.id, agentActions.leadId))
      .leftJoin(campaigns, eq(campaigns.id, agentActions.campaignId))
      .where(and(...conditions))
      .orderBy(agentActions.createdAt);

    const messageIds = rows.map((r) => r.action.payload?.messageId).filter(Boolean);
    const msgs = messageIds.length ? await db.select().from(messages).where(inArray(messages.id, messageIds)) : [];
    const byId = new Map(msgs.map((m) => [m.id, m]));

    const items = rows.map(({ action, lead, campaignName }) => ({
      id: action.id,
      runId: action.agentRunId,
      action: action.action,
      actionLabel: SALES_POLICY[action.action]?.label || action.action,
      summary: action.summary,
      createdAt: action.createdAt,
      escalations: (action.escalations || []).map((key) => ({ key, label: SALES_ESCALATION_LABELS[key] || key })),
      fit: action.evidence?.fit || null,
      campaignId: action.campaignId,
      campaignName,
      lead: { id: lead.id, name: lead.name, company: lead.company, title: lead.title, source: lead.source, url: lead.url },
      message: byId.get(action.payload?.messageId) || null,
    }));
    return NextResponse.json({ success: true, items });
  } catch (error) {
    console.error("Sales agent inbox error:", error);
    return NextResponse.json({ error: "Could not load approvals" }, { status: 500 });
  }
}, { requireUser: true });
