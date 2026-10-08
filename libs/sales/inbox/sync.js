// Inbox sync: every couple of minutes the worker reads new mail, keeps the replies to our sales
// emails (everything else in the mailbox is ignored and never stored), and wakes the agent that
// works the lead's campaign. Relative imports only.
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { agentRuns, conversationMessages, leads } from "../../schema";
import { getRedisClient } from "../../redis";
import { notify, NOTIFICATION_TYPES } from "../../notifications";
import { RUN_STATUS, SALES_PIPELINE, findActiveSalesRun } from "../../agent/runs";
import { requestAgentTick } from "../../agent/triggers";
import { htmlToText } from "../knowledge/extract";
import { testRecipient } from "../send/email";
import { CLOSED_STATUSES, CONVERSATION_STATUS } from "../conversation/status";
import { sentEmails } from "../conversation/thread";
import { fetchNewMail, inboxConfigured } from "./imap";
import { isIgnorable, matchReply, parseIdList, stripQuotedReply } from "./match";

const STATE_KEY = () => `sales:inbox:${String(process.env.SENDER_EMAIL || "").toLowerCase()}`;
const LOCK_KEY = "sales:inbox:lock";
const MATCH_WINDOW_DAYS = 90;
export const CONVERSATIONS_LINK = "/dashboard/sales/conversations";

/** Store one reply in its lead's thread; returns the new row, or null when it was already stored. */
export async function recordReply({ mail, sentRow, by }, { database = db, now = new Date() } = {}) {
  const [lead] = await database.select().from(leads).where(eq(leads.id, sentRow.leadId)).limit(1);
  if (!lead) return null;
  const fullText = mail.text?.trim() ? mail.text : htmlToText(mail.html);
  const body = stripQuotedReply(fullText) || fullText.trim().slice(0, 5000) || "(empty reply)";

  const [row] = await database.insert(conversationMessages).values({
    userId: lead.userId,
    leadId: lead.id,
    campaignId: lead.campaignId,
    direction: "in",
    channel: "email",
    kind: "inbound",
    status: "received",
    fromAddress: mail.from,
    toAddress: Array.isArray(mail.to) ? mail.to[0] : mail.to,
    subject: mail.subject,
    body: body.slice(0, 20000),
    emailMessageId: mail.messageId,
    inReplyTo: mail.inReplyTo,
    references: parseIdList(mail.references).join(" ") || null,
    meta: { fromName: mail.fromName || null, matchedBy: by, repliesTo: sentRow.id },
    receivedAt: mail.date ? new Date(mail.date) : now,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing().returning();
  if (!row) return null;

  // A reply re-opens the conversation, unless they asked us to stop
  const changes = { lastReplyAt: now, nextFollowUpAt: null, updatedAt: now };
  if (lead.conversationStatus !== CONVERSATION_STATUS.UNSUBSCRIBED) changes.conversationStatus = CONVERSATION_STATUS.REPLIED;
  await database.update(leads).set(changes).where(eq(leads.id, lead.id));
  return { row, lead };
}

/** Wake the campaign's agent; a finished run comes back to answer. Without one, tell the person. */
export async function wakeForReply({ lead, row }, { database = db, tick = requestAgentTick, notifyFn = notify } = {}) {
  const who = lead.company || lead.name || row.fromAddress;
  let run = await findActiveSalesRun(lead.campaignId, { database });
  if (!run) {
    const [last] = await database.select().from(agentRuns)
      .where(and(eq(agentRuns.campaignId, lead.campaignId), eq(agentRuns.pipelineType, SALES_PIPELINE)))
      .orderBy(desc(agentRuns.createdAt)).limit(1);
    if (last?.status === RUN_STATUS.COMPLETED) {
      await database.update(agentRuns).set({ status: RUN_STATUS.WAITING, completedAt: null }).where(eq(agentRuns.id, last.id));
      run = last;
    }
  }
  if (run) await tick(run.id, { delayMs: 1000 });
  await notifyFn({
    userId: lead.userId,
    type: NOTIFICATION_TYPES.SALES_REPLY,
    title: `${who} replied`,
    body: `${row.body.slice(0, 160)}${run ? "" : " — no sales agent is running for this campaign, so it waits for you."}`,
    link: `${CONVERSATIONS_LINK}?lead=${lead.id}`,
  });
  return run?.id || null;
}

/**
 * Read new mail and record the sales replies.
 * @returns {{ checked, replies, ignored, skipped? }}
 */
export async function syncSalesInbox(deps = {}) {
  if (!deps.fetchMail && !inboxConfigured()) return { skipped: "no mailbox configured" };
  const redis = deps.redis || getRedisClient();
  const database = deps.database || db;
  const fetchMail = deps.fetchMail || fetchNewMail;
  const now = deps.now ? deps.now() : new Date();

  const locked = await redis.set(LOCK_KEY, "1", "EX", 120, "NX");
  if (!locked) return { skipped: "another sync is running" };
  try {
    const saved = JSON.parse((await redis.get(STATE_KEY())) || "{}");
    const { messages, state } = await fetchMail({
      ...saved,
      sinceDate: new Date(now.getTime() - 7 * 24 * 3600 * 1000),
    });

    const ids = messages.flatMap(({ mail }) => [...parseIdList(mail.inReplyTo), ...parseIdList(mail.references)]);
    const sent = messages.length ? await sentEmails({ messageIds: [...new Set(ids)], since: new Date(now.getTime() - MATCH_WINDOW_DAYS * 24 * 3600 * 1000) }, { database }) : [];
    let replies = 0;
    let ignored = 0;
    for (const { mail } of messages) {
      if (isIgnorable(mail, { ownAddress: process.env.SENDER_EMAIL })) {
        ignored++;
        continue;
      }
      const match = matchReply(mail, sent, { testRecipient: testRecipient(), now, maxAgeDays: MATCH_WINDOW_DAYS });
      if (!match) {
        ignored++;
        continue;
      }
      const recorded = await recordReply({ mail, sentRow: match.row, by: match.by }, { database, now });
      if (!recorded) continue; // seen before
      replies++;
      await wakeForReply(recorded, { database, tick: deps.tick, notifyFn: deps.notifyFn });
    }

    await redis.set(STATE_KEY(), JSON.stringify({ ...state, lastSyncAt: now.toISOString() }));
    return { checked: messages.length, replies, ignored };
  } finally {
    await redis.del(LOCK_KEY).catch(() => {});
  }
}

/** When the mailbox was last read, for the Conversations page. */
export async function inboxStatus({ redis } = {}) {
  if (!inboxConfigured()) return { configured: false };
  const saved = JSON.parse((await (redis || getRedisClient()).get(STATE_KEY()).catch(() => null)) || "{}");
  return { configured: true, address: process.env.SENDER_EMAIL, lastSyncAt: saved.lastSyncAt || null };
}

/** Leads with an open conversation that a reply could still arrive for. */
export async function openConversationLeads(campaignId, { database = db } = {}) {
  const rows = await database.select({ id: leads.id, status: leads.conversationStatus }).from(leads)
    .where(and(eq(leads.campaignId, campaignId), inArray(leads.conversationStatus, Object.values(CONVERSATION_STATUS))));
  return rows.filter((r) => !CLOSED_STATUSES.includes(r.status));
}
