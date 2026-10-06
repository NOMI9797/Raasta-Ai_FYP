// The sales agent: one tick of plan → act → observe for a campaign. Runs in the hiring worker
// (job "agent-advance"), woken by approvals, by its own follow-up ticks and by the periodic sweep.
// Nothing ever waits inside a tick: waiting for an approval or a LinkedIn acceptance is a run
// state, and a later tick picks up where this one stopped. Relative imports only.
import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db } from "../../db";
import { agentActions, agentRuns, agentSteps, campaigns, leads, messages, users } from "../../schema";
import { notify, NOTIFICATION_TYPES } from "../../notifications";
import { ACTION_STATUS, markExecuted, markFailed, proposeAction, supersedeActions } from "../../agent/actions";
import { FINISHED_RUN_STATUSES, RUN_STATUS } from "../../agent/runs";
import { requestAgentTick } from "../../agent/triggers";
import { indeedAdapter } from "../../platforms/indeed";
import { PLATFORM_KIND } from "../stages";
import { companyNameOf } from "../companies";
import { importLeadProfiles } from "../import-leads";
import { researchCompanyLead, topPosts, writeLeadMessage } from "../lead-actions";
import { sendSalesEmail, isEmailAddress } from "../send/email";
import { checkAcceptances, getLinkedInAccount, linkedInAllowance, sendInvites, sendLinkedInMessage } from "../send/linkedin";
import { CONVERSATION_SENDS, DEFAULTS, ROUTE, SALES_ACTION, SALES_PIPELINE, normaliseMode } from "./policy";
import { LEAD_STAGE, acceptanceCheckDue, buildSalesPlan, isCampaignFinished, keyFor } from "./plan";
import { scoreLead } from "./scoring";
import { recordOutbound } from "../conversation/thread";
import { CLOSED_STATUSES, CONVERSATION_STATUS } from "../conversation/status";
import { getSalesSettings } from "../meetings/settings";
import { conversationDeps, executeConversationSend, handleConversations } from "./conversations";

export const SALES_AGENT_LINK = "/dashboard/agents";
export const SALES_APPROVALS_LINK = "/dashboard/agents?tab=approvals";

// Work done per tick, so one tick stays well inside the worker's 5-minute limit.
// When more is left, the agent queues its next tick straight away.
const TICK_BUDGET = { research: 4, score: 8, write: 6 };
const FIND_REPEAT_MS = 24 * 3600 * 1000;

export const SALES_STEPS = [
  { key: "find_leads", label: "Find leads" },
  { key: "research", label: "Research" },
  { key: "score", label: "Score fit" },
  { key: "write_messages", label: "Write messages" },
  { key: "approvals", label: "Your approvals" },
  { key: "outreach", label: "Outreach" },
  { key: "follow_up", label: "Replies & follow-ups" },
];

const STEP = { PENDING: "pending", RUNNING: "running", WAITING: "waiting", AWAITING_APPROVAL: "awaiting_approval", COMPLETED: "completed", SKIPPED: "skipped" };

function defaults(deps = {}) {
  return {
    database: deps.database || db,
    now: deps.now || (() => new Date()),
    notifyFn: deps.notifyFn || notify,
    tick: deps.tick || ((runId, opts) => requestAgentTick(runId, opts)),
    searchFn: deps.searchFn || ((filters) => indeedAdapter.search(null, filters)),
    researchFn: deps.researchFn || researchCompanyLead,
    scoreFn: deps.scoreFn || scoreLead,
    writeFn: deps.writeFn || writeLeadMessage,
    emailFn: deps.emailFn || sendSalesEmail,
    linkedin: deps.linkedin || { getLinkedInAccount, linkedInAllowance, sendInvites, checkAcceptances, sendLinkedInMessage },
    settingsFn: deps.settingsFn || getSalesSettings,
    conversation: conversationDeps(deps.conversation),
  };
}

// Dedupe keys are per run: a send rejected in an earlier, stopped run must not block a new one
const runKey = (ctx, action, leadId) => `${ctx.run.id}:${keyFor(action, leadId)}`;

const startOfDay = (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate());

/** Run config with defaults, as the planner and executors need it. */
export function salesConfig(run) {
  const c = run.config || {};
  return {
    ...DEFAULTS,
    ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined && v !== null && v !== "")),
  };
}

// ─── Entry point ───

export async function advanceSalesRun(runId, deps = {}) {
  const d = defaults(deps);
  const [run] = await d.database.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
  if (!run) return { skipped: "run not found" };
  if (run.pipelineType !== SALES_PIPELINE) return { skipped: "not a sales run" };
  if (FINISHED_RUN_STATUSES.includes(run.status)) return { skipped: `run is ${run.status}` };
  if (run.status === RUN_STATUS.PAUSED) return { skipped: "paused" };

  const ctx = { d, run, mode: normaliseMode(run.mode), config: salesConfig(run), out: { newApprovals: 0, done: [], progress: 0 } };
  if (!run.campaignId) {
    // Started by the old in-request sales runner, which this agent replaced
    return finishRun(ctx, RUN_STATUS.CANCELLED, "This run was started by the previous sales agent. Start a new one.");
  }
  const [campaign] = run.campaignId ? await d.database.select().from(campaigns).where(eq(campaigns.id, run.campaignId)).limit(1) : [];
  if (!campaign) return finishRun(ctx, RUN_STATUS.FAILED, "The campaign this agent works on no longer exists");
  ctx.campaign = campaign;
  const [sender] = await d.database.select({ name: users.name }).from(users).where(eq(users.id, run.userId)).limit(1);
  ctx.senderName = sender?.name || null;
  ctx.settings = await d.settingsFn(run.userId, { database: d.database });
  ctx.c = d.conversation;
  ctx.emailAllowance = async () => (await allowance(ctx)).email;

  await ensureSteps(ctx);
  if (run.status === RUN_STATUS.QUEUED) {
    await d.database.update(agentRuns).set({ status: RUN_STATUS.RUNNING, startedAt: d.now() }).where(eq(agentRuns.id, run.id));
  }

  try {
    ctx.account = ctx.config.accountId ? await d.linkedin.getLinkedInAccount(ctx.config.accountId).catch(() => null) : null;
    await findLeads(ctx);
    await executeApproved(ctx);
    await maybeCheckAcceptance(ctx);
    // Replies first: a client waiting for an answer matters more than a new lead
    const conversationsLeft = await handleConversations(ctx);

    let state = await loadState(ctx);
    let plan = buildSalesPlan(state, { mode: ctx.mode, config: ctx.config });
    await prepare(ctx, plan);

    // Plan again on the updated leads, then propose (and in Auto, carry out) the sends
    state = await loadState(ctx);
    plan = buildSalesPlan(state, { mode: ctx.mode, config: ctx.config });
    await proposeSends(ctx, plan);

    state = await loadState(ctx);
    plan = buildSalesPlan(state, { mode: ctx.mode, config: ctx.config });
    // Research leads to scoring, scoring to writing: keep going straight away while this tick got
    // something done. When nothing moved (an outage, say), the 15-minute sweep tries again.
    const moreToPrepare = plan.research.length + plan.score.length + plan.write.length > 0;
    const moreWork = moreToPrepare || conversationsLeft;
    ctx.conversations = await conversationCounts(ctx);
    await updateSteps(ctx, plan, moreToPrepare);

    // The AI's rate limit (Groq free tier) resets within a minute: come back then rather than at the sweep
    if (moreWork && ctx.out.rateLimited) await d.tick(run.id, { delayMs: 60 * 1000 });
    else if (moreWork && ctx.out.progress > 0) await d.tick(run.id, { delayMs: 1000 });
    // Done when every lead is dealt with and no conversation can still need an answer or a follow-up
    const finished = !moreWork && isCampaignFinished(plan) && !ctx.config.repeatSearch && ctx.conversations.open === 0 && !ctx.pendingApprovals;
    await saveRun(ctx, finished ? RUN_STATUS.COMPLETED : RUN_STATUS.WAITING, plan);
    await notifyApprovals(ctx);
    if (finished) await notifyFinished(ctx, plan);
    return { runId, counts: plan.counts, more: moreWork, ...ctx.out };
  } catch (error) {
    await finishRun(ctx, RUN_STATUS.FAILED, error.message);
    throw error;
  }
}

// ─── Observe ───

async function loadState(ctx) {
  const { d, run, campaign } = ctx;
  const [rows, msgs, acts] = await Promise.all([
    d.database.select().from(leads).where(eq(leads.campaignId, campaign.id)).orderBy(leads.createdAt),
    d.database.select().from(messages).where(eq(messages.campaignId, campaign.id)).orderBy(desc(messages.updatedAt)),
    d.database.select().from(agentActions).where(and(eq(agentActions.agentRunId, run.id), ne(agentActions.status, ACTION_STATUS.SUPERSEDED))),
  ]);
  const latest = new Map();
  for (const m of msgs) if (!latest.has(m.leadId)) latest.set(m.leadId, m);
  // The planner looks actions up by action and lead (keyFor); the newest one counts
  const actions = new Map();
  for (const a of [...acts].sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt))) if (a.leadId) actions.set(keyFor(a.action, a.leadId), a);

  // The same company (or person) already contacted from another campaign of this user
  const keys = rows.map((l) => l.sourceData?.companyKey).filter(Boolean);
  const urls = rows.map((l) => l.url);
  const contacted = await d.database.select({ url: leads.url, sourceData: leads.sourceData }).from(leads)
    .where(and(eq(leads.userId, run.userId), ne(leads.campaignId, campaign.id), eq(leads.messageSent, true)));
  const contactedKeys = new Set(contacted.map((l) => l.sourceData?.companyKey).filter((k) => keys.includes(k)));
  const contactedUrls = new Set(contacted.map((l) => l.url).filter((u) => urls.includes(u)));
  const contactedElsewhere = new Set(rows.filter((l) => contactedKeys.has(l.sourceData?.companyKey) || contactedUrls.has(l.url)).map((l) => l.id));

  // Research this run tried and couldn't do: the lead waits for a person (or a search key)
  const researchBlocked = new Map(
    acts.filter((a) => a.action === SALES_ACTION.RESEARCH && a.status === ACTION_STATUS.FAILED && a.leadId)
      .map((a) => [a.leadId, a.summary])
  );

  return { leads: rows, messages: latest, actions, contactedElsewhere, researchBlocked, allowance: await allowance(ctx), linkedinReady: Boolean(ctx.account) };
}

async function countExecutedToday(ctx, action) {
  const [{ n }] = await ctx.d.database.select({ n: sql`count(*)::int` }).from(agentActions).where(and(
    eq(agentActions.campaignId, ctx.campaign.id),
    eq(agentActions.action, action),
    eq(agentActions.status, ACTION_STATUS.EXECUTED),
    gte(agentActions.executedAt, startOfDay(ctx.d.now())),
  ));
  return n;
}

/** Sends left today: the run's caps minus what it already sent, and the LinkedIn account's own limits. */
async function allowance(ctx) {
  // Follow-ups are cold emails too, so they share the daily email limit (answers to replies don't)
  const emailsToday = (await countExecutedToday(ctx, SALES_ACTION.SEND_EMAIL)) + (await countExecutedToday(ctx, SALES_ACTION.SEND_FOLLOW_UP));
  const out = { email: Math.max(0, ctx.config.dailyEmailCap - emailsToday), invite: 0, linkedinMessage: 0 };
  if (ctx.account) {
    const account = await ctx.d.linkedin.linkedInAllowance(ctx.account.id).catch(() => ({ invites: 0, messages: 0 }));
    const invitesToday = await countExecutedToday(ctx, SALES_ACTION.SEND_INVITE);
    out.invite = Math.min(account.invites, Math.max(0, ctx.config.dailyInviteCap - invitesToday));
    out.linkedinMessage = account.messages;
  }
  return out;
}

// ─── Act: find, prepare ───

/** Run the campaign's saved Indeed search once (and daily, with repeatSearch). */
async function findLeads(ctx) {
  const { d, run, config, campaign } = ctx;
  const search = config.search;
  if (!search?.query && !search?.location) return;
  const last = run.results?.lastFindAt ? new Date(run.results.lastFindAt) : null;
  if (last && (!config.repeatSearch || d.now() - last < FIND_REPEAT_MS)) return;

  ctx.findAt = d.now().toISOString();
  const result = await d.searchFn({ ...search, limit: search.limit || 25 });
  if (!result?.success) {
    ctx.out.done.push(`Lead search failed: ${result?.error || "unknown error"}`);
    return;
  }
  const imported = await importLeadProfiles({ userId: run.userId, campaign, profiles: result.results || [] }, { database: d.database });
  await proposeAction(run, {
    action: SALES_ACTION.FIND_LEADS,
    route: ROUTE.AUTO,
    status: ACTION_STATUS.EXECUTED,
    summary: `Searched Indeed for "${[search.query, search.location].filter(Boolean).join(" in ")}": ${imported.message}`,
    result: { found: (result.results || []).length, companies: imported.companiesInserted, addedToExisting: imported.jobsAddedToExisting, skipped: imported.skipped.length },
    dedupeKey: `${SALES_ACTION.FIND_LEADS}:${run.id}:${ctx.findAt.slice(0, 10)}`,
  }, { database: d.database, now: d.now() });
  ctx.out.done.push(imported.message);
}

/** Research, score, skip and write, within this tick's budget. Returns true when work is left. */
async function prepare(ctx, plan) {
  const { d, run } = ctx;
  const byId = new Map((await d.database.select().from(leads).where(eq(leads.campaignId, ctx.campaign.id))).map((l) => [l.id, l]));
  const opts = { database: d.database, now: d.now() };
  const record = (action, lead, summary, result, failed) =>
    proposeAction(run, {
      action, route: ROUTE.AUTO, leadId: lead.id, summary, result,
      status: failed ? ACTION_STATUS.FAILED : ACTION_STATUS.EXECUTED,
      dedupeKey: runKey(ctx, action, lead.id),
    }, opts);

  for (const { leadId, reason } of plan.skip) {
    const lead = byId.get(leadId);
    await record(SALES_ACTION.SKIP_LEAD, lead, `Skipped ${labelOf(lead)}: ${reason}`, { reason });
    ctx.out.progress++;
  }

  for (const id of plan.research.slice(0, TICK_BUDGET.research)) {
    const lead = byId.get(id);
    if (PLATFORM_KIND[lead.source] !== "company") {
      // Reading LinkedIn profiles from the agent comes with the LinkedIn flow; for now it's done in Research
      await record(SALES_ACTION.RESEARCH, lead, `Read ${labelOf(lead)}'s profile in Research › LinkedIn (the agent doesn't read profiles yet)`, null, true);
      continue;
    }
    try {
      const updated = await d.researchFn(lead, { database: d.database });
      const r = updated.sourceData.research;
      await record(SALES_ACTION.RESEARCH, lead, `Researched ${labelOf(lead)}: ${researchLine(r)}`, { status: r.status, website: r.website });
      ctx.out.progress++;
    } catch (error) {
      await record(SALES_ACTION.RESEARCH, lead, `Research failed for ${labelOf(lead)}: ${error.message}`, { error: error.message }, true);
    }
  }

  for (const id of plan.score.slice(0, TICK_BUDGET.score)) {
    const lead = byId.get(id);
    try {
      const posts = PLATFORM_KIND[lead.source] === "company" ? [] : await topPosts(lead.id, { database: d.database });
      const fit = await d.scoreFn({ lead, campaign: ctx.campaign, posts });
      await d.database.update(leads).set({ sourceData: { ...(lead.sourceData || {}), fit }, updatedAt: d.now() }).where(eq(leads.id, lead.id));
      await proposeAction(run, {
        action: SALES_ACTION.SCORE, route: ROUTE.AUTO, status: ACTION_STATUS.EXECUTED, leadId: lead.id,
        summary: `Scored ${labelOf(lead)} ${fit.score}/100: ${fit.reason || ""}`.trim(), result: fit,
        dedupeKey: `${runKey(ctx, SALES_ACTION.SCORE, lead.id)}:${fit.scoredAt}`,
      }, opts);
      ctx.out.progress++;
    } catch (error) {
      // Retried by a later tick, not straight away, so an AI outage isn't hammered
      if (error?.code === "rate_limit") ctx.out.rateLimited = true;
      ctx.out.done.push(`Scoring ${labelOf(lead)} failed: ${error.message}`);
    }
  }

  for (const id of plan.write.slice(0, TICK_BUDGET.write)) {
    const lead = byId.get(id);
    // Without a LinkedIn account, companies are written to by email
    const channel = PLATFORM_KIND[lead.source] === "company" && !ctx.account ? "email" : undefined;
    try {
      const { message } = await d.writeFn({ lead, userId: run.userId, channel, database: d.database });
      await proposeAction(run, {
        action: SALES_ACTION.WRITE_MESSAGE, route: ROUTE.AUTO, status: ACTION_STATUS.EXECUTED, leadId: lead.id,
        summary: `Wrote ${message.channel === "email" ? "an email" : "a LinkedIn message"} for ${labelOf(lead)}`,
        result: { messageId: message.id, channel: message.channel },
        dedupeKey: `${runKey(ctx, SALES_ACTION.WRITE_MESSAGE, lead.id)}:${message.id}`,
      }, opts);
      ctx.out.progress++;
    } catch (error) {
      if (error?.code === "rate_limit") ctx.out.rateLimited = true;
      ctx.out.done.push(`Writing to ${labelOf(lead)} failed: ${error.message}`);
    }
  }
}

const labelOf = (lead) => (PLATFORM_KIND[lead?.source] === "company" ? companyNameOf(lead) : lead?.name) || "this lead";

function researchLine(r) {
  const found = [
    r.website && "website",
    r.emails?.length && `${r.emails.length} email${r.emails.length === 1 ? "" : "s"}`,
    r.phones?.length && "phone",
    r.decisionMakers?.length && `${r.decisionMakers.length} decision-maker${r.decisionMakers.length === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return found.length ? `found ${found.join(", ")}` : "nothing found";
}

// ─── Act: outreach ───

/** Propose the planned sends; automatic ones are carried out right away. */
async function proposeSends(ctx, plan) {
  const { d, run } = ctx;
  const opts = { database: d.database, now: d.now() };
  const msgs = await d.database.select().from(messages).where(eq(messages.campaignId, ctx.campaign.id)).orderBy(desc(messages.updatedAt));
  const latest = new Map();
  for (const m of msgs) if (!latest.has(m.leadId)) latest.set(m.leadId, m);
  const byId = new Map((await d.database.select().from(leads).where(eq(leads.campaignId, ctx.campaign.id))).map((l) => [l.id, l]));

  for (const send of plan.sends) {
    const lead = byId.get(send.leadId);
    const message = latest.get(send.leadId);
    const { action: row, created } = await proposeAction(run, {
      action: send.action,
      route: send.route,
      leadId: lead.id,
      summary: sendSummary(send.action, lead, message),
      payload: { messageId: message?.id || null, channel: message?.channel, recipient: message?.recipient || null },
      evidence: { fit: send.fit, approvedOnMessagesStep: send.approvedByMessage, subject: message?.subject || null },
      escalations: send.escalations,
      dedupeKey: runKey(ctx, send.action, lead.id),
    }, opts);
    if (!created) continue;
    if (send.route === ROUTE.AUTO) await executeSend(ctx, row);
    else ctx.out.newApprovals++;
  }
}

function sendSummary(action, lead, message) {
  const who = labelOf(lead);
  if (action === SALES_ACTION.SEND_EMAIL) return `Email ${who}${message?.recipient ? ` at ${message.recipient}` : ""}`;
  if (action === SALES_ACTION.SEND_INVITE) return `Send a LinkedIn invite for ${who}`;
  return `Send the LinkedIn message to ${who}`;
}

/** Approved sends that weren't carried out yet (approved by a person, or deferred by a cap). */
async function executeApproved(ctx) {
  const approved = await ctx.d.database.select().from(agentActions)
    .where(and(eq(agentActions.agentRunId, ctx.run.id), eq(agentActions.status, ACTION_STATUS.APPROVED)))
    .orderBy(agentActions.decidedAt);
  if (!approved.length) return;
  const left = await allowance(ctx);
  const capOf = { [SALES_ACTION.SEND_EMAIL]: "email", [SALES_ACTION.SEND_INVITE]: "invite", [SALES_ACTION.SEND_LINKEDIN_MESSAGE]: "linkedinMessage" };
  for (const action of approved) {
    if (CONVERSATION_SENDS.includes(action.action)) {
      if (action.action === SALES_ACTION.SEND_FOLLOW_UP) {
        if (left.email <= 0) continue;
        left.email--;
      }
      await executeConversationSend(ctx, action);
      continue;
    }
    const cap = capOf[action.action];
    if (!cap) {
      await markExecuted(action.id, action.result || null, { database: ctx.d.database, now: ctx.d.now() });
      continue;
    }
    if (left[cap] <= 0) continue; // stays approved; tomorrow's allowance carries it out
    left[cap]--;
    await executeSend(ctx, action);
  }
}

async function executeSend(ctx, action) {
  const { d } = ctx;
  const opts = { database: d.database, now: d.now() };
  try {
    const [lead] = await d.database.select().from(leads).where(eq(leads.id, action.leadId)).limit(1);
    if (!lead) return supersedeActions([action.id], "lead removed", opts);
    const [message] = await d.database.select().from(messages)
      .where(and(eq(messages.leadId, lead.id), ne(messages.status, "sent"))).orderBy(desc(messages.updatedAt)).limit(1);

    if (action.action === SALES_ACTION.SEND_EMAIL) {
      if (!message) return supersedeActions([action.id], "no unsent message", opts);
      if (!isEmailAddress(message.recipient)) throw new Error("No valid email address: add one on the Messages step");
      const sent = await d.emailFn({ to: message.recipient, subject: message.subject, body: message.content, senderName: ctx.senderName });
      await markMessageSent(ctx, lead, message);
      // Starts the lead's thread: replies are matched to it, follow-ups are timed from it
      await recordOutbound({ lead, kind: "outreach", subject: message.subject, body: message.content, toAddress: message.recipient, sent, followUpDays: ctx.settings.followUpDays }, opts);
      await markExecuted(action.id, { delivered: sent.delivered, to: sent.to, intendedTo: sent.intendedTo, redirected: sent.redirected, messageId: sent.messageId }, opts);
      ctx.out.done.push(`Emailed ${labelOf(lead)}${sent.redirected ? ` (test: sent to ${sent.to})` : ""}`);
      return;
    }

    if (!ctx.account) throw new Error("No LinkedIn account selected for this agent");
    if (action.action === SALES_ACTION.SEND_INVITE) {
      const url = message?.recipient || lead.url;
      const result = await d.linkedin.sendInvites(ctx.account, ctx.campaign.id, [{ id: lead.id, url, name: lead.name }]);
      if (result.limited && !result.sent && !result.alreadyPending && !result.alreadyConnected) return; // retried with tomorrow's allowance
      if (result.failed) throw new Error(result.errors?.[0]?.error || "Invite failed");
      await markExecuted(action.id, result, opts);
      return;
    }

    if (action.action === SALES_ACTION.SEND_LINKEDIN_MESSAGE) {
      if (!message) return supersedeActions([action.id], "no unsent message", opts);
      const result = await d.linkedin.sendLinkedInMessage(ctx.account, { url: message.recipient || lead.url, message: message.content, name: lead.name });
      if (result.limited) return;
      if (!result.success) throw new Error(result.error || "LinkedIn message failed");
      await markMessageSent(ctx, lead, message);
      await markExecuted(action.id, { sent: true }, opts);
    }
  } catch (error) {
    await markFailed(action.id, error, opts);
    ctx.out.done.push(`Failed: ${error.message}`);
  }
}

async function markMessageSent(ctx, lead, message) {
  const now = ctx.d.now();
  await ctx.d.database.update(messages).set({ status: "sent", sentAt: now, updatedAt: now }).where(eq(messages.id, message.id));
  await ctx.d.database.update(leads).set({ messageSent: true, messageSentAt: now, messageError: null, updatedAt: now }).where(eq(leads.id, lead.id));
}

/** Check LinkedIn acceptances when someone is waiting and the last check was a while ago. */
async function maybeCheckAcceptance(ctx) {
  if (!ctx.account) return;
  const state = await loadState(ctx);
  const plan = buildSalesPlan(state, { mode: ctx.mode, config: ctx.config });
  if (!acceptanceCheckDue(plan, ctx.run.results?.lastAcceptanceCheckAt, { now: ctx.d.now(), hours: ctx.config.acceptanceCheckHours })) return;
  ctx.acceptanceCheckAt = ctx.d.now().toISOString();
  try {
    const result = await ctx.d.linkedin.checkAcceptances(ctx.account, ctx.run.userId);
    if (result) ctx.out.done.push(`Checked LinkedIn: ${result.matched || 0} new connection${result.matched === 1 ? "" : "s"}`);
  } catch (error) {
    ctx.out.done.push(`LinkedIn check failed: ${error.message}`);
  }
}

/** How the campaign's conversations stand, for the run card and the finish check. */
async function conversationCounts(ctx) {
  const rows = await ctx.d.database.select({ status: leads.conversationStatus }).from(leads).where(eq(leads.campaignId, ctx.campaign.id));
  const out = { total: 0, open: 0, replied: 0, meetings: 0 };
  for (const { status } of rows) {
    if (!status) continue;
    out.total++;
    if (!CLOSED_STATUSES.includes(status)) out.open++;
    if (![CONVERSATION_STATUS.AWAITING_REPLY, CONVERSATION_STATUS.NO_RESPONSE].includes(status)) out.replied++;
    if (status === CONVERSATION_STATUS.MEETING_BOOKED) out.meetings++;
  }
  return out;
}

// ─── Bookkeeping ───

async function ensureSteps(ctx) {
  const { d, run } = ctx;
  const existing = await d.database.select({ stepKey: agentSteps.stepKey }).from(agentSteps).where(eq(agentSteps.agentRunId, run.id));
  const have = new Set(existing.map((s) => s.stepKey));
  const missing = SALES_STEPS.map((s, i) => ({ ...s, i })).filter((s) => !have.has(s.key));
  if (missing.length) {
    await d.database.insert(agentSteps).values(missing.map((s) => ({ agentRunId: run.id, stepKey: s.key, stepIndex: s.i, status: STEP.PENDING })));
  }
}

/** Step statuses for the run card, from where the leads are. */
export function stepStatuses(plan, { searched, hasSearch, moreToPrepare, pendingApprovals, conversations = { open: 0, total: 0 } }) {
  const c = plan.counts || {};
  const n = (...stages) => stages.reduce((sum, s) => sum + (c[s] || 0), 0);
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  const prepDone = (stages) => (n(...stages) === 0 && total > 0 ? STEP.COMPLETED : n(...stages) > 0 ? (moreToPrepare ? STEP.RUNNING : STEP.WAITING) : STEP.PENDING);
  return {
    find_leads: { status: !hasSearch ? STEP.SKIPPED : searched ? STEP.COMPLETED : STEP.PENDING, output: { leads: total } },
    research: { status: prepDone([LEAD_STAGE.RESEARCH]), output: { left: n(LEAD_STAGE.RESEARCH) } },
    score: { status: prepDone([LEAD_STAGE.RESEARCH, LEAD_STAGE.SCORE]), output: { left: n(LEAD_STAGE.SCORE), skipped: n(LEAD_STAGE.SKIPPED) } },
    write_messages: { status: prepDone([LEAD_STAGE.RESEARCH, LEAD_STAGE.SCORE, LEAD_STAGE.WRITE]), output: { left: n(LEAD_STAGE.WRITE) } },
    approvals: { status: pendingApprovals ? STEP.AWAITING_APPROVAL : total ? STEP.COMPLETED : STEP.PENDING, output: { pending: pendingApprovals } },
    outreach: { status: n(LEAD_STAGE.SEND) ? STEP.RUNNING : n(LEAD_STAGE.DONE) ? STEP.COMPLETED : STEP.PENDING, output: { sent: n(LEAD_STAGE.DONE), queued: n(LEAD_STAGE.SEND) } },
    follow_up: {
      status: conversations.open || n(LEAD_STAGE.AWAITING_ACCEPTANCE) ? STEP.WAITING : conversations.total ? STEP.COMPLETED : STEP.PENDING,
      output: { waiting: n(LEAD_STAGE.AWAITING_ACCEPTANCE), ...conversations },
    },
  };
}

async function updateSteps(ctx, plan, moreToPrepare) {
  const { d, run } = ctx;
  const [{ n: pendingApprovals }] = await d.database.select({ n: sql`count(*)::int` }).from(agentActions)
    .where(and(eq(agentActions.agentRunId, run.id), eq(agentActions.status, ACTION_STATUS.PENDING)));
  ctx.pendingApprovals = pendingApprovals;
  const statuses = stepStatuses(plan, {
    searched: Boolean(ctx.findAt || run.results?.lastFindAt),
    hasSearch: Boolean(ctx.config.search?.query || ctx.config.search?.location),
    moreToPrepare,
    pendingApprovals,
    conversations: ctx.conversations,
  });
  for (const [key, { status, output }] of Object.entries(statuses)) {
    await d.database.update(agentSteps).set({ status, output }).where(and(eq(agentSteps.agentRunId, run.id), eq(agentSteps.stepKey, key)));
  }
  const order = SALES_STEPS.map((s) => s.key);
  ctx.currentStep = order.find((k) => statuses[k].status === STEP.AWAITING_APPROVAL)
    || order.find((k) => [STEP.RUNNING, STEP.WAITING].includes(statuses[k].status))
    || order.find((k) => statuses[k].status === STEP.PENDING)
    || order[order.length - 1];
}

async function saveRun(ctx, status, plan) {
  const { d, run } = ctx;
  const results = {
    ...(run.results || {}),
    counts: plan.counts,
    pendingApprovals: ctx.pendingApprovals || 0,
    deferred: plan.deferred.length,
    blocked: plan.blocked.length ? plan.blocked[0].reason : null,
    lastTickAt: d.now().toISOString(),
    lastDone: ctx.out.done.slice(-5),
    conversations: ctx.conversations,
    ...(ctx.findAt ? { lastFindAt: ctx.findAt } : {}),
    ...(ctx.acceptanceCheckAt ? { lastAcceptanceCheckAt: ctx.acceptanceCheckAt } : {}),
  };
  await d.database.update(agentRuns)
    .set({ status, currentStep: ctx.currentStep, results, totalSteps: SALES_STEPS.length, ...(status === RUN_STATUS.COMPLETED ? { completedAt: d.now() } : {}) })
    .where(and(eq(agentRuns.id, run.id), inArray(agentRuns.status, [RUN_STATUS.QUEUED, RUN_STATUS.RUNNING, RUN_STATUS.WAITING, RUN_STATUS.PAUSED_AT_CHECKPOINT])));
}

async function finishRun(ctx, status, errorMessage) {
  const { d, run } = ctx;
  await d.database.update(agentRuns).set({ status, errorMessage, completedAt: d.now() }).where(eq(agentRuns.id, run.id));
  const open = await d.database.select({ id: agentActions.id }).from(agentActions)
    .where(and(eq(agentActions.agentRunId, run.id), inArray(agentActions.status, [ACTION_STATUS.PENDING, ACTION_STATUS.APPROVED])));
  await supersedeActions(open.map((a) => a.id), `run ${status}`, { database: d.database, now: d.now() });
  await d.notifyFn({
    userId: run.userId,
    type: status === RUN_STATUS.FAILED ? NOTIFICATION_TYPES.AGENT_RUN_FAILED : NOTIFICATION_TYPES.AGENT_RUN_FINISHED,
    title: status === RUN_STATUS.FAILED ? "Sales agent stopped" : "Sales agent finished",
    body: errorMessage,
    link: SALES_AGENT_LINK,
  });
  return { runId: run.id, finished: status };
}

async function notifyApprovals(ctx) {
  const n = ctx.out.newApprovals;
  if (!n) return;
  await ctx.d.notifyFn({
    userId: ctx.run.userId,
    type: NOTIFICATION_TYPES.AGENT_NEEDS_APPROVAL,
    title: "Sales agent needs your approval",
    body: `${n} message${n === 1 ? "" : "s"} ready to send for ${ctx.campaign.name}.`,
    link: SALES_APPROVALS_LINK,
  });
}

async function notifyFinished(ctx, plan) {
  const c = plan.counts || {};
  await ctx.d.notifyFn({
    userId: ctx.run.userId,
    type: NOTIFICATION_TYPES.AGENT_RUN_FINISHED,
    title: "Sales agent finished",
    body: `${ctx.campaign.name}: ${c[LEAD_STAGE.DONE] || 0} contacted, ${c[LEAD_STAGE.SKIPPED] || 0} skipped.`,
    link: SALES_AGENT_LINK,
  });
}
