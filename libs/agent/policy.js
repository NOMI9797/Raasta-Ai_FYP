// Supervised recruiter agent: which actions it may take on its own, which it must ask about,
// and which are always left to a human (docs/ai-hiring/13-workers-automation.md, agent section).
// Pure functions only, so every rule is unit-tested. Relative imports only — runs in the worker.
import { CANDIDATE_STATUS } from "../hiring/statuses";
import { decideShortlist } from "../hiring/shortlist";
import { NEEDS_REVIEW } from "../hiring/final-evaluator";

export const AGENT_MODE = { ASSISTED: "assisted", AUTOPILOT: "autopilot" };
export const AGENT_MODES = Object.values(AGENT_MODE);

// Older recruiter configs used the generic runner's mode names
const LEGACY_MODES = { semi_auto: AGENT_MODE.ASSISTED, full_auto: AGENT_MODE.AUTOPILOT };

export function normaliseMode(mode) {
  if (AGENT_MODES.includes(mode)) return mode;
  return LEGACY_MODES[mode] || AGENT_MODE.ASSISTED;
}

// What the agent does with a proposed action
export const ROUTE = {
  AUTO: "auto",   // do it, then record it
  ASK: "ask",     // wait for the recruiter's approval
  HUMAN: "human", // never done by the agent; the recruiter acts directly
};

export const AGENT_ACTION = {
  WRITE_POST: "write_post",
  PUBLISH_POST: "publish_post",
  IMPORT_APPLICANTS: "import_applicants",
  SCREEN: "screen",
  PREPARE_QUESTIONS: "prepare_questions",
  SHORTLIST: "shortlist",
  HOLD_BACK: "hold_back",
  SEND_INVITES: "send_invites",
  FINAL_DECISION: "final_decision",
  HIRE: "hire",
};

// How much an action affects the candidate decides how much autonomy the agent gets
export const EFFECT = { NONE: "none", PUBLIC: "public", POSITIVE: "positive", OUTWARD: "outward", ADVERSE: "adverse", FINAL: "final" };

export const ACTION_POLICY = {
  [AGENT_ACTION.WRITE_POST]:        { label: "Write the job post",          effect: EFFECT.NONE,     assisted: ROUTE.AUTO,  autopilot: ROUTE.AUTO },
  [AGENT_ACTION.PUBLISH_POST]:      { label: "Publish the job post",        effect: EFFECT.PUBLIC,   assisted: ROUTE.ASK,   autopilot: ROUTE.AUTO },
  [AGENT_ACTION.IMPORT_APPLICANTS]: { label: "Import applicants",           effect: EFFECT.NONE,     assisted: ROUTE.AUTO,  autopilot: ROUTE.AUTO },
  [AGENT_ACTION.SCREEN]:            { label: "Screen applications",         effect: EFFECT.NONE,     assisted: ROUTE.AUTO,  autopilot: ROUTE.AUTO },
  [AGENT_ACTION.PREPARE_QUESTIONS]: { label: "Prepare interview questions", effect: EFFECT.NONE,     assisted: ROUTE.AUTO,  autopilot: ROUTE.AUTO },
  [AGENT_ACTION.SHORTLIST]:         { label: "Shortlist",                   effect: EFFECT.POSITIVE, assisted: ROUTE.ASK,   autopilot: ROUTE.AUTO },
  [AGENT_ACTION.HOLD_BACK]:         { label: "Hold back (not shortlisted)", effect: EFFECT.ADVERSE,  assisted: ROUTE.ASK,   autopilot: ROUTE.ASK },
  [AGENT_ACTION.SEND_INVITES]:      { label: "Send interview invite",       effect: EFFECT.OUTWARD,  assisted: ROUTE.ASK,   autopilot: ROUTE.AUTO },
  [AGENT_ACTION.FINAL_DECISION]:    { label: "Final decision",              effect: EFFECT.ADVERSE,  assisted: ROUTE.ASK,   autopilot: ROUTE.ASK },
  [AGENT_ACTION.HIRE]:              { label: "Hire",                        effect: EFFECT.FINAL,    assisted: ROUTE.HUMAN, autopilot: ROUTE.HUMAN },
};

/**
 * Route one action. An escalated action is never done automatically: AUTO becomes ASK.
 * HUMAN stays HUMAN in every case.
 */
export function decide(action, mode, { escalations = [] } = {}) {
  const policy = ACTION_POLICY[action];
  if (!policy) throw new Error(`Unknown agent action: ${action}`);
  const route = policy[normaliseMode(mode)];
  if (route === ROUTE.AUTO && escalations.length > 0) return ROUTE.ASK;
  return route;
}

// ─── Escalations: cases that always go to a human, in both modes ───

export const ESCALATION = {
  BORDERLINE: "borderline",
  UNREADABLE_RESUME: "unreadable_resume",
  NO_SCORE: "no_score",
  NEEDS_REVIEW: "needs_review",
  INTEGRITY: "integrity",
};

export const ESCALATION_LABELS = {
  [ESCALATION.BORDERLINE]: "Score is close to the threshold",
  [ESCALATION.UNREADABLE_RESUME]: "Resume could not be read",
  [ESCALATION.NO_SCORE]: "No score available",
  [ESCALATION.NEEDS_REVIEW]: "Fewer than half of the questions answered",
  [ESCALATION.INTEGRITY]: "Interview tab was hidden for a while",
};

// A score fewer than this many points from the threshold is too close to call automatically
export const BORDERLINE_MARGIN = 5;
// Tab-hidden totals that are worth a human look (informational, never proof of misconduct)
export const INTEGRITY_LIMITS = { tabHiddenCount: 3, tabHiddenSec: 30 };

const isNum = (value) => typeof value === "number" && Number.isFinite(value);

export function isBorderline(score, threshold, margin = BORDERLINE_MARGIN) {
  return isNum(score) && isNum(threshold) && Math.abs(score - threshold) < margin;
}

/** Why a screened candidate needs a human before the shortlist decision. */
export function screeningEscalations(candidate, config) {
  const reasons = [];
  if (candidate.fitAnalysis?.manualReview) reasons.push(ESCALATION.UNREADABLE_RESUME);
  if (!isNum(candidate.fitScore)) reasons.push(ESCALATION.NO_SCORE);
  else if (!candidate.fitAnalysis?.manualReview && isBorderline(candidate.fitScore, config.minFitScore)) {
    reasons.push(ESCALATION.BORDERLINE);
  }
  return reasons;
}

/** Why an evaluated candidate's final decision needs particular care. `integrity` from the interview analysis. */
export function finalEscalations(candidate, config, integrity = null) {
  const reasons = [];
  const suggestion = candidate.finalAnalysis?.suggestedDecision;
  if (suggestion === NEEDS_REVIEW) reasons.push(ESCALATION.NEEDS_REVIEW);
  if (!isNum(candidate.finalScore)) {
    if (suggestion !== NEEDS_REVIEW) reasons.push(ESCALATION.NO_SCORE);
  } else if (isBorderline(candidate.finalScore, config.finalThreshold)) {
    reasons.push(ESCALATION.BORDERLINE);
  }
  if (integrity && (
    (integrity.tabHiddenCount ?? 0) >= INTEGRITY_LIMITS.tabHiddenCount ||
    (integrity.tabHiddenSec ?? 0) >= INTEGRITY_LIMITS.tabHiddenSec
  )) {
    reasons.push(ESCALATION.INTEGRITY);
  }
  return reasons;
}

// ─── Planning: turn the job's current state into proposed actions ───

/**
 * Shortlist plan for the screened pool. Uses the same rule as the stage-1 shortlist
 * (threshold + top-N cap); `taken` counts candidates already past stage 1 or already proposed.
 * Returns { shortlist: [...], holdBack: [...] }, each item { candidateId, route, escalations }.
 * Hold-backs are adverse, so they are always asked about.
 */
export function planShortlist(pool, config, mode, taken = 0) {
  const scored = pool.filter((c) => isNum(c.fitScore) && !c.fitAnalysis?.manualReview);
  const decision = decideShortlist(scored, config, taken);
  const byId = new Map(pool.map((c) => [c.id, c]));
  const item = (id, action) => {
    const escalations = screeningEscalations(byId.get(id), config);
    return { candidateId: id, route: decide(action, mode, { escalations }), escalations };
  };
  const shortlist = decision.shortlisted.map((id) => item(id, AGENT_ACTION.SHORTLIST));
  const holdBack = decision.notShortlisted.map((id) => item(id, AGENT_ACTION.HOLD_BACK));
  // Unscored or unreadable resumes are never decided by the rule: a human reads them
  for (const c of pool) {
    if (!scored.includes(c)) holdBack.push(item(c.id, AGENT_ACTION.HOLD_BACK));
  }
  return { shortlist, holdBack };
}

/**
 * Invite plan for shortlisted candidates without an invite. In Autopilot, invites go out
 * automatically up to the daily cap; the rest wait for the next day. In Assisted, each one is asked.
 * Returns { auto: ids, ask: ids, deferred: ids }.
 */
export function planInvites(candidateIds, mode, { dailyCap = null, sentToday = 0 } = {}) {
  const route = decide(AGENT_ACTION.SEND_INVITES, mode);
  if (route !== ROUTE.AUTO) return { auto: [], ask: [...candidateIds], deferred: [] };
  const room = isNum(dailyCap) ? Math.max(0, dailyCap - sentToday) : candidateIds.length;
  return { auto: candidateIds.slice(0, room), ask: [], deferred: candidateIds.slice(room) };
}

/**
 * Final-decision plan for evaluated candidates. Always asked; the suggestion and the escalations
 * travel with the request. `integrityById` maps candidate id → interview integrity summary.
 */
export function planFinalDecisions(evaluated, config, mode, integrityById = {}) {
  return evaluated.map((c) => {
    const escalations = finalEscalations(c, config, integrityById[c.id] || null);
    return {
      candidateId: c.id,
      route: decide(AGENT_ACTION.FINAL_DECISION, mode, { escalations }),
      suggestion: c.finalAnalysis?.suggestedDecision || NEEDS_REVIEW,
      escalations,
    };
  });
}

// Choices a recruiter can make when approving a candidate action
export const ACTION_CHOICES = {
  [AGENT_ACTION.SHORTLIST]: [CANDIDATE_STATUS.SHORTLISTED, CANDIDATE_STATUS.NOT_SHORTLISTED],
  [AGENT_ACTION.HOLD_BACK]: [CANDIDATE_STATUS.NOT_SHORTLISTED, CANDIDATE_STATUS.SHORTLISTED],
  [AGENT_ACTION.FINAL_DECISION]: [CANDIDATE_STATUS.FINAL_SHORTLISTED, CANDIDATE_STATUS.FINAL_REJECTED],
};

/** The status an approved candidate action applies: the recruiter's choice, else the agent's proposal. */
export function resolveChoice(action, { choice, suggestion } = {}) {
  const allowed = ACTION_CHOICES[action];
  if (!allowed) return null;
  if (choice != null) {
    if (!allowed.includes(choice)) throw new Error(`"${choice}" is not a valid choice for ${action}`);
    return choice;
  }
  if (action === AGENT_ACTION.FINAL_DECISION) {
    // needs_review has no default: the recruiter must pick
    return allowed.includes(suggestion) ? suggestion : null;
  }
  return allowed[0];
}
