// The sales agent's conversation step, run in every tick after outreach: read new replies and
// answer them from the knowledge base (or offer times / book a meeting / close), send follow-ups to
// leads who went quiet, and carry out approved replies. Relative imports only.
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import { agentActions, conversationMessages, leads, meetings } from "../../schema";
import { ACTION_STATUS, markExecuted, markFailed, proposeAction, supersedeActions } from "../../agent/actions";
import { searchKnowledge } from "../knowledge/search";
import { testRecipient } from "../send/email";
import { CONVERSATION_STATUS } from "../conversation/status";
import { loadThread, nextFollowUpAt, replySubject } from "../conversation/thread";
import { REPLY_PLAN, replyAddress } from "../conversation/decide";
import { readReply } from "../conversation/read-reply";
import { composeFollowUp, composeReply } from "../conversation/compose";
import { FOLLOW_UP_STATUSES, applyNoReply, markInboundHandled, planWords, prepareReply, sendDraft, who } from "../conversation/reply";
import { ROUTE, SALES_ACTION, decideSales } from "./policy";

export const CONVERSATION_BUDGET = { replies: 3, followUps: 4 }; // per tick: each reply is two AI calls

export function conversationDeps(deps = {}) {
  return {
    readFn: deps.readFn || readReply,
    composeFn: deps.composeFn || composeReply,
    followUpFn: deps.followUpFn || composeFollowUp,
    searchFn: deps.searchFn || searchKnowledge,
  };
}

const opts = (ctx) => ({ database: ctx.d.database, now: ctx.d.now() });

/** Run the conversation step. Returns true when work is left for another tick. */
export async function handleConversations(ctx) {
  await discardRejectedDrafts(ctx);
  const repliesLeft = await handleReplies(ctx);
  const followUpsLeft = await handleFollowUps(ctx);
  return repliesLeft || followUpsLeft;
}

// ─── Replies ───

async function handleReplies(ctx) {
  const { d } = ctx;
  const inbound = await d.database.select().from(conversationMessages).where(and(
    eq(conversationMessages.campaignId, ctx.campaign.id),
    eq(conversationMessages.direction, "in"),
    isNull(conversationMessages.handledAt),
  )).orderBy(asc(conversationMessages.createdAt));
  for (const message of inbound.slice(0, CONVERSATION_BUDGET.replies)) {
    try {
      await handleReply(ctx, message);
      ctx.out.progress++;
    } catch (error) {
      if (error?.code === "rate_limit") {
        ctx.out.rateLimited = true;
        return true;
      }
      ctx.out.done.push(`Reading ${message.fromAddress}'s reply failed: ${error.message}`);
    }
  }
  return inbound.length > CONVERSATION_BUDGET.replies;
}

async function handleReply(ctx, inbound) {
  const { d, run } = ctx;
  const [lead] = await d.database.select().from(leads).where(eq(leads.id, inbound.leadId)).limit(1);
  if (!lead) return;
  const thread = await loadThread(lead.id, { database: d.database });
  // A newer reply from them supersedes this one: answer the latest only
  const newerIn = thread.some((m) => m.direction === "in" && m.id !== inbound.id && new Date(m.createdAt) > new Date(inbound.createdAt) && !m.handledAt);
  if (newerIn) return markInboundHandled(inbound, { note: "answered together with their next reply" }, opts(ctx));
  // They asked us to stop before: a person reads anything new, the agent never writes back
  if (lead.conversationStatus === CONVERSATION_STATUS.UNSUBSCRIBED) {
    await markInboundHandled(inbound, { note: "unsubscribed: left for a person" }, opts(ctx));
    ctx.out.done.push(`${who(lead)} wrote again after unsubscribing: left for you`);
    return;
  }

  const prepared = await prepareReply({ lead, inbound, thread, settings: ctx.settings, senderName: ctx.senderName }, { ...ctx.c, ...opts(ctx) });
  const { reading, decision, intentLine } = prepared;
  await markInboundHandled(inbound, { intent: reading.intent, reading }, opts(ctx));
  await withdrawOpenSends(ctx, lead.id, "the client replied");

  // No email back: they declined, asked to stop, or are away
  if (!prepared.draft) {
    await applyNoReply({ lead, decision }, opts(ctx));
    await proposeAction(run, {
      action: decision.plan === REPLY_PLAN.WAIT ? SALES_ACTION.READ_REPLY : SALES_ACTION.CLOSE_CONVERSATION,
      route: ROUTE.AUTO, status: ACTION_STATUS.EXECUTED, leadId: lead.id,
      summary: decision.plan === REPLY_PLAN.WAIT ? `${intentLine}. Following up when they're back.` : `${intentLine}. Conversation closed, no more emails.`,
      result: { intent: reading.intent, status: decision.nextStatus },
      dedupeKey: `${run.id}:read:${inbound.id}`,
    }, opts(ctx));
    ctx.out.done.push(intentLine);
    return;
  }

  const [draft] = await d.database.insert(conversationMessages).values(prepared.draft).returning();
  await proposeAction(run, {
    action: SALES_ACTION.READ_REPLY, route: ROUTE.AUTO, status: ACTION_STATUS.EXECUTED, leadId: lead.id,
    summary: `${intentLine}. Wrote ${planWords(decision.plan)}${draft.meta.covered ? "" : " (not everything is in the knowledge base)"}.`,
    result: { intent: reading.intent, plan: decision.plan, draftId: draft.id },
    dedupeKey: `${run.id}:read:${inbound.id}`,
  }, opts(ctx));
  await proposeConversationSend(ctx, {
    action: SALES_ACTION.SEND_REPLY, lead, draft, escalations: prepared.escalations,
    summary: `Reply to ${who(lead)}: ${planWords(decision.plan)}`,
    evidence: { intent: reading.intent, reading, theyWrote: inbound.body.slice(0, 1500) },
  });
}

/** A reply changes the situation: unsent follow-ups and replies for the lead are withdrawn. */
async function withdrawOpenSends(ctx, leadId, reason) {
  const open = await ctx.d.database.select().from(agentActions).where(and(
    eq(agentActions.leadId, leadId),
    inArray(agentActions.action, [SALES_ACTION.SEND_REPLY, SALES_ACTION.SEND_FOLLOW_UP]),
    inArray(agentActions.status, [ACTION_STATUS.PENDING, ACTION_STATUS.APPROVED]),
  ));
  if (!open.length) return;
  await supersedeActions(open.map((a) => a.id), reason, opts(ctx));
  const draftIds = open.map((a) => a.payload?.draftId).filter(Boolean);
  if (draftIds.length) {
    await ctx.d.database.update(conversationMessages).set({ status: "discarded", updatedAt: ctx.d.now() })
      .where(and(inArray(conversationMessages.id, draftIds), eq(conversationMessages.status, "draft")));
  }
}

// ─── Follow-ups ───

async function handleFollowUps(ctx) {
  const { d, run, settings } = ctx;
  const now = d.now();
  const due = await d.database.select().from(leads).where(and(
    eq(leads.campaignId, ctx.campaign.id),
    inArray(leads.conversationStatus, FOLLOW_UP_STATUSES),
    lte(leads.nextFollowUpAt, now),
  ));
  const total = settings.followUpDays.length;
  let written = 0;
  for (const lead of due) {
    // Every follow-up sent and its wait is over: no response
    if ((lead.followUpsSent || 0) >= total) {
      await d.database.update(leads).set({ conversationStatus: CONVERSATION_STATUS.NO_RESPONSE, nextFollowUpAt: null, updatedAt: now }).where(eq(leads.id, lead.id));
      // Times we offered and they never took are withdrawn
      await d.database.update(meetings).set({ status: "cancelled", outcome: "No reply to the times offered", updatedAt: now })
        .where(and(eq(meetings.leadId, lead.id), eq(meetings.status, "proposed")));
      await proposeAction(run, {
        action: SALES_ACTION.CLOSE_CONVERSATION, route: ROUTE.AUTO, status: ACTION_STATUS.EXECUTED, leadId: lead.id,
        summary: `No reply from ${who(lead)} after ${total} follow-up${total === 1 ? "" : "s"}: stopped writing`,
        dedupeKey: `${run.id}:no_response:${lead.id}:${lead.updatedAt?.getTime?.() || ""}`,
      }, opts(ctx));
      ctx.out.progress++;
      continue;
    }
    if (written >= CONVERSATION_BUDGET.followUps) return true;
    const number = (lead.followUpsSent || 0) + 1;
    // One follow-up per number after our last real email (first email or answer): a pending, deferred
    // or failed one isn't written again, and a new round after an answer gets new keys
    const thread = await loadThread(lead.id, { database: d.database });
    const anchor = [...thread].reverse().find((m) => m.direction === "out" && m.status === "sent" && m.kind !== "follow_up");
    const dedupeKey = `${run.id}:${SALES_ACTION.SEND_FOLLOW_UP}:${anchor?.id || lead.id}:${number}`;
    const existing = await d.database.select({ id: agentActions.id }).from(agentActions).where(eq(agentActions.dedupeKey, dedupeKey)).limit(1);
    if (existing.length) continue; // already written; waiting for approval or the email allowance
    try {
      const outreach = thread.find((m) => m.kind === "outreach");
      const { results: passages } = await ctx.c.searchFn({ userId: run.userId, query: outreach?.body || lead.company || "services", limit: 4 });
      const { body } = await ctx.c.followUpFn({ number, total, thread, passages, companyName: settings.companyName, senderName: ctx.senderName });
      const [draft] = await d.database.insert(conversationMessages).values({
        userId: lead.userId, leadId: lead.id, campaignId: lead.campaignId,
        direction: "out", channel: "email", kind: "follow_up", status: "draft",
        fromAddress: process.env.SENDER_EMAIL || null, toAddress: replyAddress(thread, { testRecipient: testRecipient() }),
        subject: replySubject(thread), body,
        inReplyTo: [...thread].reverse().find((m) => m.emailMessageId)?.emailMessageId || null,
        meta: { number, total },
        createdAt: now, updatedAt: now,
      }).returning();
      await proposeConversationSend(ctx, {
        action: SALES_ACTION.SEND_FOLLOW_UP, lead, draft, escalations: draft.toAddress ? [] : ["no_recipient"],
        summary: `Follow-up ${number} of ${total} to ${who(lead)}`, dedupeKey,
      });
      written++;
      ctx.out.progress++;
    } catch (error) {
      if (error?.code === "rate_limit") {
        ctx.out.rateLimited = true;
        return true;
      }
      ctx.out.done.push(`Follow-up for ${who(lead)} failed: ${error.message}`);
    }
  }
  return false;
}

// ─── Sending ───

async function proposeConversationSend(ctx, { action, lead, draft, escalations, summary, evidence = null, dedupeKey = null }) {
  const route = decideSales(action, ctx.mode, { escalations });
  // Follow-ups share the daily email allowance with first emails; answers to clients never wait
  const deferred = action === SALES_ACTION.SEND_FOLLOW_UP && route === ROUTE.AUTO && (await ctx.emailAllowance()) <= 0;
  const { action: row, created } = await proposeAction(ctx.run, {
    action, route, leadId: lead.id, summary,
    payload: { draftId: draft.id, channel: "email", recipient: draft.toAddress },
    evidence: { ...(evidence || {}), passages: draft.meta?.passages || [], plan: draft.meta?.plan || null, slots: draft.meta?.slots || [] },
    escalations,
    dedupeKey: dedupeKey || `${ctx.run.id}:${action}:${draft.id}`,
  }, opts(ctx));
  if (!created) return;
  if (route === ROUTE.AUTO && !deferred) await executeConversationSend(ctx, row);
  else if (route !== ROUTE.AUTO) ctx.out.newApprovals++;
}

/** Discard drafts whose send the person rejected; a rejected follow-up skips that nudge. */
async function discardRejectedDrafts(ctx) {
  const { d, run } = ctx;
  const rejected = await d.database.select().from(agentActions).where(and(
    eq(agentActions.agentRunId, run.id),
    inArray(agentActions.action, [SALES_ACTION.SEND_REPLY, SALES_ACTION.SEND_FOLLOW_UP]),
    eq(agentActions.status, ACTION_STATUS.REJECTED),
  ));
  for (const action of rejected) {
    const draftId = action.payload?.draftId;
    if (!draftId) continue;
    const [draft] = await d.database.update(conversationMessages).set({ status: "discarded", updatedAt: d.now() })
      .where(and(eq(conversationMessages.id, draftId), eq(conversationMessages.status, "draft"))).returning();
    if (draft && action.action === SALES_ACTION.SEND_FOLLOW_UP) {
      const [lead] = await d.database.select().from(leads).where(eq(leads.id, action.leadId)).limit(1);
      if (FOLLOW_UP_STATUSES.includes(lead?.conversationStatus)) {
        const done = (lead.followUpsSent || 0) + 1;
        await d.database.update(leads).set({ followUpsSent: done, nextFollowUpAt: nextFollowUpAt(d.now(), done, ctx.settings.followUpDays) ?? d.now(), updatedAt: d.now() }).where(eq(leads.id, lead.id));
      }
    }
  }
}

/** Send an approved (or automatic) reply or follow-up. */
export async function executeConversationSend(ctx, action) {
  const { d } = ctx;
  try {
    const [draft] = await d.database.select().from(conversationMessages).where(eq(conversationMessages.id, action.payload?.draftId)).limit(1);
    if (!draft || draft.status !== "draft") return supersedeActions([action.id], "draft no longer open", opts(ctx));
    const [lead] = await d.database.select().from(leads).where(eq(leads.id, draft.leadId)).limit(1);
    if (!lead) return supersedeActions([action.id], "lead removed", opts(ctx));
    if (draft.kind === "follow_up" && !FOLLOW_UP_STATUSES.includes(lead.conversationStatus)) {
      return supersedeActions([action.id], "the conversation moved on", opts(ctx));
    }
    const thread = await loadThread(lead.id, { database: d.database });
    const { sent, meeting } = await sendDraft(
      { draft, lead, thread, settings: ctx.settings, senderName: ctx.senderName },
      { ...opts(ctx), emailFn: d.emailFn, notifyFn: d.notifyFn },
    );
    await markExecuted(action.id, { to: sent.to, intendedTo: sent.intendedTo, redirected: sent.redirected, messageId: sent.messageId, meetingId: meeting?.id || null }, opts(ctx));
    ctx.out.done.push(`${draft.kind === "follow_up" ? "Followed up with" : "Replied to"} ${who(lead)}${meeting ? " and booked the meeting" : ""}${sent.redirected ? ` (test: sent to ${sent.to})` : ""}`);
  } catch (error) {
    await markFailed(action.id, error, opts(ctx));
    ctx.out.done.push(`Failed: ${error.message}`);
  }
}
