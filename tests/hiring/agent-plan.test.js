import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "../../libs/agent/recruiter-agent";
import { AGENT_MODE } from "../../libs/agent/policy";
import { ACTION_STATUS } from "../../libs/agent/actions";
import { CANDIDATE_STATUS } from "../../libs/hiring/statuses";

const hiringConfig = { minFitScore: 70, maxShortlist: null, finalThreshold: 70 };
const c = (id, status, extra = {}) => ({ id, name: id, status, appliedAt: new Date("2026-10-01"), fitAnalysis: {}, ...extra });
const action = (action, id, status = ACTION_STATUS.PENDING, extra = {}) => ({ action, dedupeKey: `${action}:${id}`, status, ...extra });

test("new applications are queued for screening; the shortlist waits until the batch is screened", () => {
  const state = { candidates: [c("n1", CANDIDATE_STATUS.NEW), c("s1", CANDIDATE_STATUS.SCREENED, { fitScore: 90 })], actions: [] };
  const plan = buildPlan(state, { mode: AGENT_MODE.AUTOPILOT, hiringConfig });
  assert.deepEqual(plan.screening.toQueue, ["n1"]);
  assert.equal(plan.screening.pending, 1);
  assert.equal(plan.shortlist.shortlist.length, 0);
});

test("an already-queued application isn't queued twice; a failed screening doesn't block the shortlist", () => {
  const queued = c("q", CANDIDATE_STATUS.NEW, { fitAnalysis: { queuedAt: "2026-10-04T10:00:00Z" } });
  const failed = c("f", CANDIDATE_STATUS.NEW, { fitAnalysis: { queuedAt: "2026-10-04T10:00:00Z", error: "Screening failed", failedAt: "2026-10-04T10:01:00Z" } });
  assert.deepEqual(buildPlan({ candidates: [queued], actions: [] }, { mode: AGENT_MODE.AUTOPILOT, hiringConfig }).screening.toQueue, []);
  const plan = buildPlan({ candidates: [failed, c("s", CANDIDATE_STATUS.SCREENED, { fitScore: 90 })], actions: [] }, { mode: AGENT_MODE.AUTOPILOT, hiringConfig });
  assert.equal(plan.screening.failed, 1);
  assert.equal(plan.screening.pending, 0);
  assert.deepEqual(plan.shortlist.shortlist.map((i) => i.candidateId), ["s"]);
});

test("Autopilot: auto-shortlisted candidates get invites in the same tick, within the daily cap", () => {
  const state = {
    candidates: [c("a", CANDIDATE_STATUS.SCREENED, { fitScore: 95 }), c("b", CANDIDATE_STATUS.SCREENED, { fitScore: 90 }), c("x", CANDIDATE_STATUS.SHORTLISTED)],
    actions: [],
    sentToday: 0,
    hasQuestions: false,
  };
  const plan = buildPlan(state, { mode: AGENT_MODE.AUTOPILOT, hiringConfig, dailyInviteCap: 2 });
  assert.deepEqual(plan.invites, { auto: ["x", "a"], ask: [], deferred: ["b"] });
  assert.equal(plan.needsQuestions, true);
});

test("Assisted: nothing outward happens without a request", () => {
  const state = { candidates: [c("a", CANDIDATE_STATUS.SCREENED, { fitScore: 95 }), c("x", CANDIDATE_STATUS.SHORTLISTED)], actions: [], hasQuestions: true };
  const plan = buildPlan(state, { mode: AGENT_MODE.ASSISTED, hiringConfig });
  assert.ok(plan.shortlist.shortlist.every((i) => i.route === "ask"));
  assert.deepEqual(plan.invites, { auto: [], ask: ["x"], deferred: [] });
  assert.equal(plan.needsQuestions, false);
});

test("candidates with an existing request are not proposed again; open proposals count towards the cap", () => {
  const state = {
    candidates: [c("a", CANDIDATE_STATUS.SCREENED, { fitScore: 95 }), c("b", CANDIDATE_STATUS.SCREENED, { fitScore: 90 }), c("x", CANDIDATE_STATUS.SHORTLISTED)],
    actions: [action("shortlist", "a"), action("send_invites", "x", ACTION_STATUS.REJECTED)],
  };
  const plan = buildPlan(state, { mode: AGENT_MODE.ASSISTED, hiringConfig: { ...hiringConfig, maxShortlist: 1 } });
  assert.deepEqual(plan.shortlist.shortlist, []);
  assert.deepEqual(plan.shortlist.holdBack.map((i) => i.candidateId), ["b"]);
  assert.deepEqual(plan.invites.ask, []); // the recruiter already said no to x's invite
});

test("a superseded request doesn't block a new one", () => {
  const state = { candidates: [c("a", CANDIDATE_STATUS.SCREENED, { fitScore: 95 })], actions: [action("shortlist", "a", ACTION_STATUS.SUPERSEDED)] };
  assert.equal(buildPlan(state, { mode: AGENT_MODE.ASSISTED, hiringConfig }).shortlist.shortlist.length, 1);
});

test("final decisions: proposed once per evaluation; a re-analysis replaces a pending request", () => {
  const evaluated = c("e", CANDIDATE_STATUS.INTERVIEW_COMPLETED, {
    finalScore: 80, finalAnalysis: { suggestedDecision: CANDIDATE_STATUS.FINAL_SHORTLISTED, computedAt: "t2" },
  });
  const same = buildPlan({ candidates: [evaluated], actions: [action("final_decision", "e", ACTION_STATUS.PENDING, { payload: { computedAt: "t2" } })] },
    { mode: AGENT_MODE.AUTOPILOT, hiringConfig });
  assert.equal(same.finals.length, 0);
  const newer = buildPlan({ candidates: [evaluated], actions: [action("final_decision", "e", ACTION_STATUS.PENDING, { payload: { computedAt: "t1" } })] },
    { mode: AGENT_MODE.AUTOPILOT, hiringConfig });
  assert.equal(newer.finals.length, 1);
  const decided = buildPlan({ candidates: [evaluated], actions: [action("final_decision", "e", ACTION_STATUS.REJECTED, { payload: { computedAt: "t1" } })] },
    { mode: AGENT_MODE.AUTOPILOT, hiringConfig });
  assert.equal(decided.finals.length, 0);
});

test("interview counts are reported", () => {
  const state = {
    candidates: [c("i", CANDIDATE_STATUS.INTERVIEW_INVITED), c("p", CANDIDATE_STATUS.INTERVIEW_IN_PROGRESS), c("x", CANDIDATE_STATUS.INTERVIEW_EXPIRED)],
    actions: [],
  };
  assert.deepEqual(buildPlan(state, { mode: AGENT_MODE.ASSISTED, hiringConfig }).interviews, { invited: 1, inProgress: 1, expired: 1, completed: 0 });
});
