// Sales agent policy: what the agent does on its own, what it asks about, in each mode.
// Same modes and routes as the hiring agent (libs/agent/policy.js): Semi-auto = assisted, Auto = autopilot.
// Pure functions only, so every rule is unit-tested. Relative imports only.
import { AGENT_MODE, ROUTE, normaliseMode } from "../../agent/policy";
import { REPLY_ESCALATION_LABELS } from "../conversation/decide";

export { AGENT_MODE, ROUTE, normaliseMode };

export const SALES_PIPELINE = "sales_operator";

export const SALES_ACTION = {
  FIND_LEADS: "find_leads",
  RESEARCH: "research",
  SCORE: "score",
  WRITE_MESSAGE: "write_message",
  SKIP_LEAD: "skip_lead",
  SEND_EMAIL: "send_email",
  SEND_INVITE: "send_invite",
  CHECK_ACCEPTANCE: "check_acceptance",
  SEND_LINKEDIN_MESSAGE: "send_linkedin_message",
  READ_REPLY: "read_reply",
  SEND_REPLY: "send_reply",
  SEND_FOLLOW_UP: "send_follow_up",
  CLOSE_CONVERSATION: "close_conversation",
};

// Preparing work never reaches anyone, so it is automatic in both modes. Anything that contacts
// a person is asked about in Semi-auto and done within the daily caps in Auto.
export const SALES_POLICY = {
  [SALES_ACTION.FIND_LEADS]:            { label: "Find leads",             assisted: ROUTE.AUTO, autopilot: ROUTE.AUTO },
  [SALES_ACTION.RESEARCH]:              { label: "Research",               assisted: ROUTE.AUTO, autopilot: ROUTE.AUTO },
  [SALES_ACTION.SCORE]:                 { label: "Score fit",              assisted: ROUTE.AUTO, autopilot: ROUTE.AUTO },
  [SALES_ACTION.WRITE_MESSAGE]:         { label: "Write message",          assisted: ROUTE.AUTO, autopilot: ROUTE.AUTO },
  [SALES_ACTION.SKIP_LEAD]:             { label: "Skip lead",              assisted: ROUTE.AUTO, autopilot: ROUTE.AUTO },
  [SALES_ACTION.SEND_EMAIL]:            { label: "Send email",             assisted: ROUTE.ASK,  autopilot: ROUTE.AUTO },
  [SALES_ACTION.SEND_INVITE]:           { label: "Send LinkedIn invite",   assisted: ROUTE.ASK,  autopilot: ROUTE.AUTO },
  [SALES_ACTION.CHECK_ACCEPTANCE]:      { label: "Check accepted invites", assisted: ROUTE.AUTO, autopilot: ROUTE.AUTO },
  [SALES_ACTION.SEND_LINKEDIN_MESSAGE]: { label: "Send LinkedIn message",  assisted: ROUTE.ASK,  autopilot: ROUTE.AUTO },
  [SALES_ACTION.READ_REPLY]:            { label: "Read a reply",           assisted: ROUTE.AUTO, autopilot: ROUTE.AUTO },
  [SALES_ACTION.SEND_REPLY]:            { label: "Answer a reply",         assisted: ROUTE.ASK,  autopilot: ROUTE.AUTO },
  [SALES_ACTION.SEND_FOLLOW_UP]:        { label: "Send a follow-up",       assisted: ROUTE.ASK,  autopilot: ROUTE.AUTO },
  [SALES_ACTION.CLOSE_CONVERSATION]:    { label: "Close a conversation",   assisted: ROUTE.AUTO, autopilot: ROUTE.AUTO },
};

export const OUTREACH_ACTIONS = [SALES_ACTION.SEND_EMAIL, SALES_ACTION.SEND_INVITE, SALES_ACTION.SEND_LINKEDIN_MESSAGE, SALES_ACTION.SEND_REPLY, SALES_ACTION.SEND_FOLLOW_UP];
export const CONVERSATION_SENDS = [SALES_ACTION.SEND_REPLY, SALES_ACTION.SEND_FOLLOW_UP];

// Cases that are always asked about, in both modes
export const SALES_ESCALATION = {
  NO_RECIPIENT: "no_recipient",
  BORDERLINE_FIT: "borderline_fit",
  CONTACTED_ELSEWHERE: "contacted_elsewhere",
  TOO_LONG: "too_long",
};

// Replies add their own reasons to ask (libs/sales/conversation/decide.js)
export const SALES_ESCALATION_LABELS = {
  ...REPLY_ESCALATION_LABELS,
  [SALES_ESCALATION.NO_RECIPIENT]: "No email address or LinkedIn profile to send to",
  [SALES_ESCALATION.BORDERLINE_FIT]: "Fit score is close to the campaign's minimum",
  [SALES_ESCALATION.CONTACTED_ELSEWHERE]: "Already contacted in another campaign",
  [SALES_ESCALATION.TOO_LONG]: "Message is longer than LinkedIn allows",
};

export const DEFAULTS = {
  minFitScore: 50,        // below this a lead is skipped
  borderlineMargin: 10,   // within this many points above the minimum, a person decides
  dailyEmailCap: 20,
  dailyInviteCap: 15,
  linkedinMessageMax: 600,
  acceptanceCheckHours: 4,
};

/** Route one action. An escalated action is never automatic. */
export function decideSales(action, mode, { escalations = [] } = {}) {
  const policy = SALES_POLICY[action];
  if (!policy) throw new Error(`Unknown sales action: ${action}`);
  const route = policy[normaliseMode(mode)];
  return route === ROUTE.AUTO && escalations.length > 0 ? ROUTE.ASK : route;
}

/** The policy table for one mode, for the agent page ("what will it ask me about?"). */
export function describePolicy(mode) {
  const m = normaliseMode(mode);
  return Object.entries(SALES_POLICY).map(([action, p]) => ({ action, label: p.label, route: p[m] }));
}
