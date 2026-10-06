import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/libs/db";
import { withAuth } from "@/libs/auth-middleware";
import { agentActions, campaigns, conversationMessages, leads } from "@/libs/schema";
import { ACTION_STATUS } from "@/libs/agent/actions";
import { inboxStatus } from "@/libs/sales/inbox/sync";
import { CLOSED_STATUSES, CONVERSATION_STATUS } from "@/libs/sales/conversation/status";

// GET /api/sales/conversations?campaign= — every lead we have emailed, newest activity first, with
// the last message, whether it needs the person, and the mailbox status
export const GET = withAuth(async (request, { user }) => {
  try {
    const campaignId = new URL(request.url).searchParams.get("campaign");
    const conditions = [isNotNull(leads.conversationStatus)];
    if (user.role !== "admin") conditions.push(eq(leads.userId, user.id));
    if (campaignId) conditions.push(eq(leads.campaignId, campaignId));

    const rows = await db.select({ lead: leads, campaignName: campaigns.name }).from(leads)
      .leftJoin(campaigns, eq(campaigns.id, leads.campaignId))
      .where(and(...conditions));
    const ids = rows.map((r) => r.lead.id);

    const [msgs, pending] = ids.length
      ? await Promise.all([
          db.select({
            leadId: conversationMessages.leadId, direction: conversationMessages.direction, kind: conversationMessages.kind,
            status: conversationMessages.status, body: conversationMessages.body, intent: conversationMessages.intent,
            handledAt: conversationMessages.handledAt, createdAt: conversationMessages.createdAt,
          }).from(conversationMessages).where(inArray(conversationMessages.leadId, ids)).orderBy(desc(conversationMessages.createdAt)),
          db.select({ leadId: agentActions.leadId }).from(agentActions)
            .where(and(inArray(agentActions.leadId, ids), eq(agentActions.status, ACTION_STATUS.PENDING))),
        ])
      : [[], []];

    const byLead = new Map();
    for (const m of msgs) {
      if (m.status === "discarded") continue;
      const entry = byLead.get(m.leadId) || { last: null, count: 0, unanswered: false, intent: null };
      if (!entry.last) entry.last = m;
      if (m.direction === "in" && !entry.intent) entry.intent = m.intent;
      if (m.direction === "in" && !m.handledAt) entry.unanswered = true;
      entry.count++;
      byLead.set(m.leadId, entry);
    }
    const pendingByLead = new Map();
    for (const p of pending) pendingByLead.set(p.leadId, (pendingByLead.get(p.leadId) || 0) + 1);

    const conversations = rows.map(({ lead, campaignName }) => {
      const t = byLead.get(lead.id) || {};
      const status = lead.conversationStatus;
      return {
        leadId: lead.id,
        name: lead.name,
        company: lead.company || lead.sourceData?.company?.name || null,
        source: lead.source,
        campaignId: lead.campaignId,
        campaignName,
        status,
        lastReplyAt: lead.lastReplyAt,
        nextFollowUpAt: CLOSED_STATUSES.includes(status) ? null : lead.nextFollowUpAt,
        followUpsSent: lead.followUpsSent,
        messages: t.count || 0,
        lastMessage: t.last ? { direction: t.last.direction, kind: t.last.kind, status: t.last.status, preview: t.last.body.slice(0, 160), at: t.last.createdAt } : null,
        intent: t.intent || null,
        pendingApprovals: pendingByLead.get(lead.id) || 0,
        needsYou: Boolean(pendingByLead.get(lead.id)) || (t.unanswered && status === CONVERSATION_STATUS.REPLIED),
      };
    }).sort((a, b) => new Date(b.lastMessage?.at || 0) - new Date(a.lastMessage?.at || 0));

    return NextResponse.json({ success: true, conversations, inbox: await inboxStatus() });
  } catch (error) {
    console.error("Conversations error:", error);
    return NextResponse.json({ error: "Could not load conversations" }, { status: 500 });
  }
}, { requireUser: true });
