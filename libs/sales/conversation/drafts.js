// Drafts on the Conversations page: the person edits, sends or discards what the agent wrote,
// asks the AI for a reply, or writes their own. Relative imports only.
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { agentActions, conversationMessages, leads } from "../../schema";
import { ACTION_STATUS, supersedeActions } from "../../agent/actions";
import { requestAgentTick } from "../../agent/triggers";
import { getSalesSettings } from "../meetings/settings";
import { isEmailAddress, testRecipient } from "../send/email";
import { CONVERSATION_STATUS } from "./status";
import { loadThread, replySubject } from "./thread";
import { REPLY_PLAN, replyAddress } from "./decide";
import { markInboundHandled, prepareReply, sendDraft } from "./reply";

export class DraftError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function ownedDraft(id, user, { database = db } = {}) {
  const conditions = [eq(conversationMessages.id, id)];
  if (user.role !== "admin") conditions.push(eq(conversationMessages.userId, user.id));
  const [draft] = await database.select().from(conversationMessages).where(and(...conditions)).limit(1);
  if (!draft) throw new DraftError("Draft not found", 404);
  if (draft.status !== "draft") throw new DraftError("This message was already sent or discarded", 409);
  return draft;
}

/** The agent's open request for this draft, if it is waiting in the approvals inbox. */
async function actionFor(draftId, { database = db } = {}) {
  const rows = await database.select().from(agentActions)
    .where(inArray(agentActions.status, [ACTION_STATUS.PENDING, ACTION_STATUS.APPROVED]));
  return rows.find((a) => a.payload?.draftId === draftId) || null;
}

export async function editDraft(id, user, { subject, body, toAddress }, { database = db } = {}) {
  await ownedDraft(id, user, { database });
  const changes = { updatedAt: new Date() };
  if (body !== undefined) {
    if (!String(body).trim()) throw new DraftError("The message is empty");
    changes.body = String(body).slice(0, 10000);
  }
  if (subject !== undefined) changes.subject = String(subject).slice(0, 300) || null;
  if (toAddress !== undefined) {
    const to = String(toAddress || "").trim();
    if (to && !isEmailAddress(to)) throw new DraftError("That isn't a valid email address");
    changes.toAddress = to || null;
  }
  const [row] = await database.update(conversationMessages).set(changes).where(eq(conversationMessages.id, id)).returning();
  return row;
}

export async function discardDraft(id, user, { database = db } = {}) {
  const draft = await ownedDraft(id, user, { database });
  const action = await actionFor(draft.id, { database });
  if (action) await supersedeActions([action.id], "discarded on the Conversations page", { database });
  await database.update(conversationMessages).set({ status: "discarded", updatedAt: new Date() }).where(eq(conversationMessages.id, id));
}

/**
 * Send a draft now. A draft the agent is waiting on is approved instead, so the agent sends it
 * (and books the meeting) in the worker; otherwise it is sent from here.
 */
export async function sendDraftNow(id, user, { database = db, senderName } = {}) {
  const draft = await ownedDraft(id, user, { database });
  if (!draft.toAddress) throw new DraftError("Add an email address first");
  const action = await actionFor(draft.id, { database });
  if (action) {
    if (action.status === ACTION_STATUS.PENDING) {
      await database.update(agentActions).set({ status: ACTION_STATUS.APPROVED, decidedBy: user.id, decidedAt: new Date(), updatedAt: new Date() }).where(eq(agentActions.id, action.id));
    }
    await requestAgentTick(action.agentRunId, { delayMs: 0 });
    return { queued: true };
  }
  const [lead] = await database.select().from(leads).where(eq(leads.id, draft.leadId)).limit(1);
  const thread = await loadThread(lead.id, { database });
  const settings = await getSalesSettings(lead.userId, { database });
  const { sent, meeting } = await sendDraft({ draft, lead, thread, settings, senderName }, { database });
  return { sent: { to: sent.to, redirected: sent.redirected }, meetingId: meeting?.id || null };
}

/** Ask the AI for an answer to their latest reply (when no agent is working this campaign). */
export async function draftWithAi(lead, { database = db, senderName } = {}) {
  const thread = await loadThread(lead.id, { database });
  const inbound = [...thread].reverse().find((m) => m.direction === "in");
  if (!inbound) throw new DraftError("They haven't replied yet");
  const open = thread.find((m) => m.status === "draft");
  if (open) throw new DraftError("There's already a draft: send or discard it first", 409);
  const settings = await getSalesSettings(lead.userId, { database });
  const prepared = await prepareReply({ lead, inbound, thread, settings, senderName }, { database });
  await markInboundHandled(inbound, { intent: prepared.reading.intent, reading: prepared.reading }, { database });
  if (!prepared.draft) {
    return { draft: null, reading: prepared.reading, note: prepared.decision.plan === REPLY_PLAN.WAIT ? "It's an out-of-office reply: nothing to answer." : "They declined: the AI suggests not replying." };
  }
  const [draft] = await database.insert(conversationMessages).values(prepared.draft).returning();
  return { draft, reading: prepared.reading, escalations: prepared.escalations };
}

/** Send the person's own message in the thread. */
export async function sendOwnReply(lead, { body, subject }, { database = db, senderName } = {}) {
  if (!String(body || "").trim()) throw new DraftError("Write a message first");
  const thread = await loadThread(lead.id, { database });
  const toAddress = replyAddress(thread, { testRecipient: testRecipient() });
  if (!toAddress) throw new DraftError("There's no email address for this lead");
  const lastIn = [...thread].reverse().find((m) => m.direction === "in");
  const [draft] = await database.insert(conversationMessages).values({
    userId: lead.userId, leadId: lead.id, campaignId: lead.campaignId,
    direction: "out", channel: "email", kind: "reply", status: "draft",
    fromAddress: process.env.SENDER_EMAIL || null, toAddress,
    subject: String(subject || "").trim() || replySubject(thread), body: String(body).slice(0, 10000),
    inReplyTo: lastIn?.emailMessageId || [...thread].reverse().find((m) => m.emailMessageId)?.emailMessageId || null,
    meta: { plan: REPLY_PLAN.ANSWER, nextStatus: CONVERSATION_STATUS.IN_CONVERSATION, writtenBy: "user" },
  }).returning();
  if (lastIn && !lastIn.handledAt) await markInboundHandled(lastIn, { note: "answered by you" }, { database });
  const settings = await getSalesSettings(lead.userId, { database });
  const { sent } = await sendDraft({ draft, lead, thread, settings, senderName }, { database });
  return { sent: { to: sent.to, redirected: sent.redirected } };
}

/** The person moves a conversation on by hand (e.g. "not interested", or re-opens it). */
export async function setConversationStatus(lead, status, { database = db } = {}) {
  if (!Object.values(CONVERSATION_STATUS).includes(status)) throw new DraftError("Unknown status");
  await database.update(leads).set({ conversationStatus: status, nextFollowUpAt: null, updatedAt: new Date() }).where(eq(leads.id, lead.id));
  // No follow-ups or replies go out after a person closed it
  const open = await database.select({ id: agentActions.id, payload: agentActions.payload }).from(agentActions)
    .where(and(eq(agentActions.leadId, lead.id), inArray(agentActions.status, [ACTION_STATUS.PENDING, ACTION_STATUS.APPROVED])));
  const conversationActions = open.filter((a) => a.payload?.draftId);
  if (conversationActions.length) await supersedeActions(conversationActions.map((a) => a.id), "status changed by you", { database });
  await database.update(conversationMessages).set({ status: "discarded", updatedAt: new Date() })
    .where(and(eq(conversationMessages.leadId, lead.id), eq(conversationMessages.status, "draft")));
  return status;
}

export async function latestDraft(leadId, { database = db } = {}) {
  const [row] = await database.select().from(conversationMessages)
    .where(and(eq(conversationMessages.leadId, leadId), eq(conversationMessages.status, "draft")))
    .orderBy(desc(conversationMessages.createdAt)).limit(1);
  return row || null;
}
