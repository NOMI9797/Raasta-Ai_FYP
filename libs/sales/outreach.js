// Company outreach (Outreach › Indeed / Rozee.pk): where every company of a campaign stands, and
// sending the approved emails by hand. Shares the daily email limit, the thread and the follow-up
// timer with the Sales agent, so both show one list. Relative imports only.
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { agentActions, agentRuns, conversationMessages, leads, meetings, messages, users } from "../schema";
import { ACTION_STATUS, supersedeActions } from "../agent/actions";
import { ACTIVE_RUN_STATUSES, SALES_PIPELINE } from "../agent/runs";
import { DEFAULTS, SALES_ACTION } from "./agent/policy";
import { companyNameOf } from "./companies";
import { recordOutbound } from "./conversation/thread";
import { getSalesSettings } from "./meetings/settings";
import { emailSetup, isEmailAddress, sendSalesEmail } from "./send/email";
import { OUTREACH_STATUS, outreachStatus } from "./outreach-status";

export { OUTREACH_FILTERS, OUTREACH_STATUS, outreachStatus } from "./outreach-status";

const startOfDay = (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate());

/** Cold emails (first emails and follow-ups) sent today in a campaign, by the agent or by hand. */
export async function emailsSentToday(campaignId, { database = db, now = new Date() } = {}) {
  const [{ n }] = await database.select({ n: sql`count(*)::int` }).from(conversationMessages).where(and(
    eq(conversationMessages.campaignId, campaignId),
    eq(conversationMessages.direction, "out"),
    eq(conversationMessages.status, "sent"),
    inArray(conversationMessages.kind, ["outreach", "follow_up"]),
    gte(conversationMessages.sentAt, startOfDay(now)),
  ));
  return n;
}

async function activeRun(campaignId, { database = db } = {}) {
  const [run] = await database.select().from(agentRuns).where(and(
    eq(agentRuns.campaignId, campaignId), eq(agentRuns.pipelineType, SALES_PIPELINE), inArray(agentRuns.status, ACTIVE_RUN_STATUSES),
  )).orderBy(desc(agentRuns.createdAt)).limit(1);
  return run || null;
}

/** The daily email limit: the agent's when one works the campaign, otherwise the default. */
export async function dailyLimit(campaignId, { database = db, now = new Date() } = {}) {
  const run = await activeRun(campaignId, { database });
  const limit = Number(run?.config?.dailyEmailCap) || DEFAULTS.dailyEmailCap;
  const sentToday = await emailsSentToday(campaignId, { database, now });
  return { limit, sentToday, left: Math.max(0, limit - sentToday), run };
}

/** Every company lead of the campaign on one platform, with its email and where it stands. */
export async function outreachBoard({ campaignId, platform }, { database = db, now = new Date() } = {}) {
  const rows = await database.select().from(leads).where(and(eq(leads.campaignId, campaignId), eq(leads.source, platform))).orderBy(desc(leads.updatedAt));
  const ids = rows.map((l) => l.id);
  const [msgs, meetingRows, pendingSends] = ids.length
    ? await Promise.all([
        database.select().from(messages).where(inArray(messages.leadId, ids)).orderBy(desc(messages.updatedAt)),
        database.select().from(meetings).where(and(inArray(meetings.leadId, ids), inArray(meetings.status, ["proposed", "confirmed"]))),
        database.select({ leadId: agentActions.leadId }).from(agentActions)
          .where(and(inArray(agentActions.leadId, ids), eq(agentActions.action, SALES_ACTION.SEND_EMAIL), eq(agentActions.status, ACTION_STATUS.PENDING))),
      ])
    : [[], [], []];
  const latest = new Map();
  for (const m of msgs) if (!latest.has(m.leadId)) latest.set(m.leadId, m);
  const meetingByLead = new Map(meetingRows.map((m) => [m.leadId, m]));
  const askedByAgent = new Set(pendingSends.map((p) => p.leadId));

  const companies = rows.map((lead) => {
    const message = latest.get(lead.id) || null;
    const meeting = meetingByLead.get(lead.id) || null;
    return {
      leadId: lead.id,
      company: companyNameOf(lead) || "(no company name)",
      jobTitle: lead.title,
      fit: lead.sourceData?.fit?.score ?? null,
      foundEmails: lead.sourceData?.research?.emails || [],
      status: outreachStatus({ lead, message }),
      conversationStatus: lead.conversationStatus,
      message: message && { id: message.id, status: message.status, channel: message.channel, recipient: message.recipient, subject: message.subject, preview: message.content?.slice(0, 200) },
      sentAt: lead.messageSentAt,
      nextFollowUpAt: lead.nextFollowUpAt,
      followUpsSent: lead.followUpsSent,
      error: lead.messageError,
      meeting: meeting && { status: meeting.status, startAt: meeting.startAt, timezone: meeting.timezone },
      waitingForAgentApproval: askedByAgent.has(lead.id),
    };
  });

  const count = (status) => companies.filter((c) => c.status === status).length;
  const limit = await dailyLimit(campaignId, { database, now });
  return {
    companies,
    stats: {
      total: companies.length,
      ready: count(OUTREACH_STATUS.READY),
      waiting: count(OUTREACH_STATUS.WAITING),
      replied: count(OUTREACH_STATUS.REPLIED) + count(OUTREACH_STATUS.MEETING),
      meetings: count(OUTREACH_STATUS.MEETING),
      sent: companies.filter((c) => [OUTREACH_STATUS.WAITING, OUTREACH_STATUS.REPLIED, OUTREACH_STATUS.MEETING, OUTREACH_STATUS.CLOSED].includes(c.status)).length,
    },
    limit: { limit: limit.limit, sentToday: limit.sentToday, left: limit.left },
    agent: limit.run ? { id: limit.run.id, status: limit.run.status, mode: limit.run.mode } : null,
    email: emailSetup(),
  };
}

/**
 * Send first emails by hand. Sending a draft approves it. Stops at the daily limit; the rest are
 * reported as deferred. An agent request for the same email is withdrawn, so it isn't sent twice.
 * @returns {{ sent: [{leadId, to, redirected}], failed: [{leadId, error}], deferred: string[] }}
 */
export async function sendOutreachEmails({ user, campaignId, messageIds }, { database = db, now = new Date(), emailFn = sendSalesEmail } = {}) {
  const found = await database.select({ message: messages, lead: leads }).from(messages)
    .innerJoin(leads, eq(leads.id, messages.leadId))
    .where(and(inArray(messages.id, messageIds), eq(messages.campaignId, campaignId)));
  // In the order asked for, so the ones past the daily limit are the last ones
  const rows = found.sort((x, y) => messageIds.indexOf(x.message.id) - messageIds.indexOf(y.message.id));
  const out = { sent: [], failed: [], deferred: [] };
  let { left } = await dailyLimit(campaignId, { database, now });
  const [sender] = await database.select({ name: users.name }).from(users).where(eq(users.id, rows[0]?.lead.userId || user.id)).limit(1);
  const settings = rows.length ? await getSalesSettings(rows[0].lead.userId, { database }) : null;

  for (const { message, lead } of rows) {
    if (user.role !== "admin" && lead.userId !== user.id) continue;
    if (lead.messageSent || message.status === "sent") continue;
    if (message.channel !== "email") {
      out.failed.push({ leadId: lead.id, error: "This message is for LinkedIn, not email" });
      continue;
    }
    if (!isEmailAddress(message.recipient)) {
      out.failed.push({ leadId: lead.id, error: "Add an email address first" });
      continue;
    }
    if (left <= 0) {
      out.deferred.push(lead.id);
      continue;
    }
    try {
      const sent = await emailFn({ to: message.recipient, subject: message.subject, body: message.content, senderName: sender?.name });
      left--;
      await database.update(messages).set({ status: "sent", approvedAt: message.approvedAt || now, sentAt: now, updatedAt: now }).where(eq(messages.id, message.id));
      await database.update(leads).set({ messageSent: true, messageSentAt: now, messageError: null, updatedAt: now }).where(eq(leads.id, lead.id));
      await recordOutbound({ lead, kind: "outreach", subject: message.subject, body: message.content, toAddress: message.recipient, sent, followUpDays: settings?.followUpDays }, { database, now });
      // The agent may have asked about this same email: it's done now
      const open = await database.select({ id: agentActions.id }).from(agentActions).where(and(
        eq(agentActions.leadId, lead.id), eq(agentActions.action, SALES_ACTION.SEND_EMAIL),
        inArray(agentActions.status, [ACTION_STATUS.PENDING, ACTION_STATUS.APPROVED]),
      ));
      if (open.length) await supersedeActions(open.map((a) => a.id), "sent from the Outreach step", { database, now });
      out.sent.push({ leadId: lead.id, to: sent.to, redirected: sent.redirected });
    } catch (error) {
      await database.update(leads).set({ messageError: String(error.message).slice(0, 500), updatedAt: now }).where(eq(leads.id, lead.id));
      out.failed.push({ leadId: lead.id, error: error.message });
    }
  }
  return out;
}
