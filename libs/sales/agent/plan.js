// The sales agent's planner: from the campaign's current state, the next action for every lead.
// Pure (no database, no network), so every decision is unit-tested. Relative imports only.
//
// Lead journey:
//   new → researched → scored → (skipped if a poor fit) → message written →
//     email:    send_email (asked in Semi-auto) → sent
//     LinkedIn: send_invite → waiting for acceptance → send_linkedin_message → sent
import { PLATFORM_KIND } from "../stages";
import { companyNameOf } from "../companies";
import { isEmailAddress } from "../send/email";
import { CONTACT_ROUTE, contactRoute } from "../contact-route";
import { DEFAULTS, ROUTE, SALES_ACTION, SALES_ESCALATION, decideSales } from "./policy";

export const LEAD_STAGE = {
  RESEARCH: "research",
  SCORE: "score",
  WRITE: "write",
  SEND: "send",
  AWAITING_APPROVAL: "awaiting_approval",
  AWAITING_ACCEPTANCE: "awaiting_acceptance",
  BLOCKED: "blocked",
  NEEDS_CONTACT: "needs_contact", // researched, but no email and no one on LinkedIn: a person adds a contact
  SKIPPED: "skipped",
  DONE: "done",
  STOPPED: "stopped", // a person rejected the send, or it failed
};

export const keyFor = (action, leadId) => `${action}:${leadId}`;

const isCompany = (lead) => PLATFORM_KIND[lead.source] === "company";


/** Has this lead been prepared enough to write to them? */
export function isResearched(lead) {
  return isCompany(lead) ? Boolean(lead.sourceData?.research) : lead.status === "completed";
}

export function fitOf(lead) {
  const fit = lead.sourceData?.fit;
  return fit && Number.isFinite(fit.score) ? fit : null;
}

/** Which outreach action is due for a lead whose message is written, or a waiting stage. */
function outreachStep(lead, message, { linkedinReady }) {
  if (message.channel === "email") return { action: SALES_ACTION.SEND_EMAIL };
  if (!linkedinReady) {
    return { stage: LEAD_STAGE.BLOCKED, reason: isCompany(lead) ? "No email found: choose a LinkedIn account to message the decision-maker" : "No LinkedIn account selected for this agent" };
  }
  if (!lead.inviteSent) return { action: SALES_ACTION.SEND_INVITE };
  if (lead.inviteStatus === "accepted") return { action: SALES_ACTION.SEND_LINKEDIN_MESSAGE };
  if (["failed", "rejected"].includes(lead.inviteStatus)) return { stage: LEAD_STAGE.STOPPED, reason: "Invite not accepted" };
  return { stage: LEAD_STAGE.AWAITING_ACCEPTANCE };
}

function escalationsFor(action, { lead, message, fit, config, contactedElsewhere }) {
  const out = [];
  const recipient = message.recipient || (isCompany(lead) ? null : lead.url);
  if (action === SALES_ACTION.SEND_EMAIL && !isEmailAddress(recipient)) out.push(SALES_ESCALATION.NO_RECIPIENT);
  if (action === SALES_ACTION.SEND_INVITE && !recipient) out.push(SALES_ESCALATION.NO_RECIPIENT);
  if (action === SALES_ACTION.SEND_LINKEDIN_MESSAGE && (message.content || "").length > config.linkedinMessageMax) out.push(SALES_ESCALATION.TOO_LONG);
  if (fit && fit.score < config.minFitScore + config.borderlineMargin) out.push(SALES_ESCALATION.BORDERLINE_FIT);
  if (contactedElsewhere.has(lead.id)) out.push(SALES_ESCALATION.CONTACTED_ELSEWHERE);
  // The address came from a website research couldn't tie to this company (found by the end-to-end run)
  if (action === SALES_ACTION.SEND_EMAIL && lead.sourceData?.research?.websiteConfirmed === false) out.push(SALES_ESCALATION.WEBSITE_UNCONFIRMED);
  return out;
}

/**
 * Plan one tick.
 * @param {object} state
 *   leads: lead rows; messages: Map leadId → latest message; actions: Map dedupeKey → this run's action;
 *   contactedElsewhere: Set of lead ids already contacted in another campaign;
 *   allowance: { email, invite, linkedinMessage } sends left today; linkedinReady: boolean;
 *   researchBlocked: Map leadId → why research could not be done (a person can do it, then the agent carries on)
 * @param {{ mode: string, config?: object }} options
 */
export function buildSalesPlan(state, { mode, config: overrides = {} }) {
  const config = { ...DEFAULTS, ...overrides };
  const { leads, messages, actions, contactedElsewhere = new Set(), linkedinReady = false, researchBlocked = new Map() } = state;
  const allowance = { email: 0, invite: 0, linkedinMessage: 0, ...state.allowance };
  const capOf = { [SALES_ACTION.SEND_EMAIL]: "email", [SALES_ACTION.SEND_INVITE]: "invite", [SALES_ACTION.SEND_LINKEDIN_MESSAGE]: "linkedinMessage" };

  const plan = { research: [], score: [], write: [], rewrite: [], needsContact: [], dropDrafts: [], staleActions: [], skip: [], sends: [], deferred: [], stages: {}, blocked: [] };
  const setStage = (lead, stage) => (plan.stages[lead.id] = stage);

  for (const lead of leads) {
    const message = messages.get(lead.id) || null;
    // A send request for the other channel (the message moved between Email and LinkedIn): withdrawn
    for (const action of [SALES_ACTION.SEND_EMAIL, SALES_ACTION.SEND_INVITE, SALES_ACTION.SEND_LINKEDIN_MESSAGE]) {
      const open = actions.get(keyFor(action, lead.id));
      if (!open || !["pending", "approved"].includes(open.status) || !message || message.status === "sent") continue;
      if ((action === SALES_ACTION.SEND_EMAIL) !== (message.channel === "email")) plan.staleActions.push(open.id);
    }
    if (lead.messageSent || message?.status === "sent") {
      setStage(lead, LEAD_STAGE.DONE);
      continue;
    }
    if (actions.get(keyFor(SALES_ACTION.SKIP_LEAD, lead.id))) {
      setStage(lead, LEAD_STAGE.SKIPPED);
      continue;
    }
    if (isCompany(lead) && !companyNameOf(lead)) {
      plan.skip.push({ leadId: lead.id, reason: "The job post has no company name" });
      setStage(lead, LEAD_STAGE.SKIPPED);
      continue;
    }
    if (!isResearched(lead) && researchBlocked.has(lead.id)) {
      plan.blocked.push({ leadId: lead.id, reason: researchBlocked.get(lead.id) });
      setStage(lead, LEAD_STAGE.BLOCKED);
      continue;
    }
    if (!isResearched(lead)) {
      plan.research.push(lead.id);
      setStage(lead, LEAD_STAGE.RESEARCH);
      continue;
    }
    const fit = fitOf(lead);
    if (!fit) {
      plan.score.push(lead.id);
      setStage(lead, LEAD_STAGE.SCORE);
      continue;
    }
    if (fit.score < config.minFitScore) {
      plan.skip.push({ leadId: lead.id, reason: `Fit ${fit.score} is below the campaign minimum of ${config.minFitScore}` });
      setStage(lead, LEAD_STAGE.SKIPPED);
      continue;
    }
    // Sorted after research: email, LinkedIn, or no contact. With no contact nothing is written (an
    // unaddressed draft from before is withdrawn) until a person adds an address or a profile.
    const contact = isCompany(lead) ? contactRoute(lead, message) : null;
    if (contact === CONTACT_ROUTE.NO_CONTACT) {
      if (message?.status === "draft") plan.dropDrafts.push(lead.id);
      plan.needsContact.push(lead.id);
      setStage(lead, LEAD_STAGE.NEEDS_CONTACT);
      continue;
    }
    if (!message?.content) {
      plan.write.push(lead.id);
      setStage(lead, LEAD_STAGE.WRITE);
      continue;
    }
    // An email draft with no address, for a company research can now reach (an address, or a
    // decision-maker on LinkedIn): written again for that channel. A person's edits (approved) are kept.
    if (isCompany(lead) && message.status === "draft" && message.channel === "email" && !message.recipient) {
      plan.write.push(lead.id);
      plan.rewrite.push(lead.id);
      setStage(lead, LEAD_STAGE.WRITE);
      continue;
    }

    const step = outreachStep(lead, message, { linkedinReady });
    if (step.stage) {
      setStage(lead, step.stage);
      if (step.stage === LEAD_STAGE.BLOCKED) plan.blocked.push({ leadId: lead.id, reason: step.reason });
      continue;
    }

    // A withdrawn request (the message was rewritten, say) doesn't count: the new message is proposed afresh
    const found = actions.get(keyFor(step.action, lead.id));
    const existing = found?.status === "superseded" || plan.staleActions.includes(found?.id) ? null : found;
    if (existing) {
      // Already proposed: waiting for a person, waiting to be carried out, or finished
      const stage = existing.status === "pending" ? LEAD_STAGE.AWAITING_APPROVAL
        : ["rejected", "failed"].includes(existing.status) ? LEAD_STAGE.STOPPED
        : existing.status === "approved" ? LEAD_STAGE.SEND
        : step.action === SALES_ACTION.SEND_INVITE ? LEAD_STAGE.AWAITING_ACCEPTANCE : LEAD_STAGE.DONE;
      setStage(lead, stage);
      continue;
    }

    const escalations = escalationsFor(step.action, { lead, message, fit, config, contactedElsewhere });
    // Approving the message on the Messages step is the approval: don't ask twice
    const approvedMessage = message.status === "approved" && escalations.length === 0;
    const route = approvedMessage ? ROUTE.AUTO : decideSales(step.action, mode, { escalations });
    const cap = capOf[step.action];
    if (route === ROUTE.AUTO && allowance[cap] <= 0) {
      plan.deferred.push({ leadId: lead.id, action: step.action });
      setStage(lead, LEAD_STAGE.SEND);
      continue;
    }
    if (route === ROUTE.AUTO) allowance[cap]--;
    plan.sends.push({ leadId: lead.id, action: step.action, route, escalations, approvedByMessage: approvedMessage, fit });
    setStage(lead, route === ROUTE.AUTO ? LEAD_STAGE.SEND : LEAD_STAGE.AWAITING_APPROVAL);
  }

  plan.counts = Object.values(plan.stages).reduce((acc, s) => ((acc[s] = (acc[s] || 0) + 1), acc), {});
  return plan;
}

/** Is a LinkedIn acceptance check due? (Someone is waiting and the last check was long enough ago.) */
export function acceptanceCheckDue(plan, lastCheckAt, { now = new Date(), hours = DEFAULTS.acceptanceCheckHours } = {}) {
  if (!plan.counts?.[LEAD_STAGE.AWAITING_ACCEPTANCE]) return false;
  if (!lastCheckAt) return true;
  return now - new Date(lastCheckAt) >= hours * 3600 * 1000;
}

/** Nothing left to do for any lead (every lead sent, skipped or stopped, nothing pending). */
export function isCampaignFinished(plan) {
  const open = [LEAD_STAGE.RESEARCH, LEAD_STAGE.SCORE, LEAD_STAGE.WRITE, LEAD_STAGE.SEND, LEAD_STAGE.AWAITING_APPROVAL, LEAD_STAGE.AWAITING_ACCEPTANCE, LEAD_STAGE.BLOCKED];
  return !Object.values(plan.stages).some((s) => open.includes(s));
}
