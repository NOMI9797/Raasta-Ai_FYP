import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTION_POLICY, AGENT_ACTION, AGENT_MODE, ESCALATION, ROUTE, decide, finalEscalations, isBorderline,
  normaliseMode, planFinalDecisions, planInvites, planShortlist, resolveChoice, screeningEscalations,
} from "../../libs/agent/policy";
import { CANDIDATE_STATUS } from "../../libs/hiring/statuses";
import { NEEDS_REVIEW } from "../../libs/hiring/final-evaluator";

const { ASSISTED, AUTOPILOT } = AGENT_MODE;
const config = { minFitScore: 70, maxShortlist: null, finalThreshold: 70 };

test("the policy matrix: every action routed per mode as designed", () => {
  const expected = {
    write_post: ["auto", "auto"],
    publish_post: ["ask", "auto"],
    import_applicants: ["auto", "auto"],
    screen: ["auto", "auto"],
    prepare_questions: ["auto", "auto"],
    shortlist: ["ask", "auto"],
    hold_back: ["ask", "ask"],
    send_invites: ["ask", "auto"],
    final_decision: ["ask", "ask"],
    hire: ["human", "human"],
  };
  assert.deepEqual(Object.keys(ACTION_POLICY).sort(), Object.keys(expected).sort());
  for (const [action, [assisted, autopilot]] of Object.entries(expected)) {
    assert.equal(decide(action, ASSISTED), assisted, `${action} in assisted`);
    assert.equal(decide(action, AUTOPILOT), autopilot, `${action} in autopilot`);
  }
});

test("adverse and final actions are never automatic, whatever the mode", () => {
  for (const mode of [ASSISTED, AUTOPILOT, "full_auto", "semi_auto", undefined]) {
    assert.notEqual(decide(AGENT_ACTION.HOLD_BACK, mode), ROUTE.AUTO);
    assert.notEqual(decide(AGENT_ACTION.FINAL_DECISION, mode), ROUTE.AUTO);
    assert.equal(decide(AGENT_ACTION.HIRE, mode), ROUTE.HUMAN);
  }
});

test("an escalation turns an automatic action into a request; human stays human", () => {
  assert.equal(decide(AGENT_ACTION.SHORTLIST, AUTOPILOT, { escalations: [ESCALATION.BORDERLINE] }), ROUTE.ASK);
  assert.equal(decide(AGENT_ACTION.HIRE, AUTOPILOT, { escalations: [ESCALATION.BORDERLINE] }), ROUTE.HUMAN);
  assert.throws(() => decide("delete_everything", AUTOPILOT), /Unknown agent action/);
});

test("legacy and unknown modes map safely (unknown → assisted)", () => {
  assert.equal(normaliseMode("full_auto"), AUTOPILOT);
  assert.equal(normaliseMode("semi_auto"), ASSISTED);
  assert.equal(normaliseMode("autopilot"), AUTOPILOT);
  assert.equal(normaliseMode("yolo"), ASSISTED);
  assert.equal(normaliseMode(null), ASSISTED);
});

test("borderline means fewer than 5 points from the threshold", () => {
  assert.equal(isBorderline(66, 70), true);
  assert.equal(isBorderline(74, 70), true);
  assert.equal(isBorderline(65, 70), false);
  assert.equal(isBorderline(75, 70), false);
  assert.equal(isBorderline(null, 70), false);
});

test("screening escalations: unreadable resume, missing score, borderline", () => {
  assert.deepEqual(screeningEscalations({ fitScore: 0, fitAnalysis: { manualReview: true } }, config), [ESCALATION.UNREADABLE_RESUME]);
  assert.deepEqual(screeningEscalations({ fitScore: null, fitAnalysis: {} }, config), [ESCALATION.NO_SCORE]);
  assert.deepEqual(screeningEscalations({ fitScore: 72, fitAnalysis: {} }, config), [ESCALATION.BORDERLINE]);
  assert.deepEqual(screeningEscalations({ fitScore: 90, fitAnalysis: {} }, config), []);
});

test("final escalations: needs review, borderline, integrity", () => {
  const c = (finalScore, suggestedDecision) => ({ finalScore, finalAnalysis: { suggestedDecision } });
  assert.deepEqual(finalEscalations(c(85, CANDIDATE_STATUS.FINAL_SHORTLISTED), config), []);
  assert.deepEqual(finalEscalations(c(68, CANDIDATE_STATUS.FINAL_REJECTED), config), [ESCALATION.BORDERLINE]);
  assert.deepEqual(finalEscalations(c(null, NEEDS_REVIEW), config), [ESCALATION.NEEDS_REVIEW]);
  assert.deepEqual(finalEscalations(c(90, CANDIDATE_STATUS.FINAL_SHORTLISTED), config, { tabHiddenCount: 4, tabHiddenSec: 10 }), [ESCALATION.INTEGRITY]);
  assert.deepEqual(finalEscalations(c(90, CANDIDATE_STATUS.FINAL_SHORTLISTED), config, { tabHiddenCount: 1, tabHiddenSec: 45 }), [ESCALATION.INTEGRITY]);
  assert.deepEqual(finalEscalations(c(90, CANDIDATE_STATUS.FINAL_SHORTLISTED), config, { tabHiddenCount: 1, tabHiddenSec: 5 }), []);
});

const cand = (id, fitScore, appliedAt = "2026-10-01", fitAnalysis = {}) => ({ id, fitScore, appliedAt: new Date(appliedAt), fitAnalysis });
const pool = [cand("a", 95), cand("b", 85), cand("c", 72), cand("d", 60), cand("e", 0, "2026-10-01", { manualReview: true })];

test("shortlist plan in Autopilot: clear positives automatic, borderline asked, hold-backs always asked", () => {
  const plan = planShortlist(pool, config, AUTOPILOT);
  const route = (list) => Object.fromEntries(list.map((i) => [i.candidateId, i.route]));
  assert.deepEqual(route(plan.shortlist), { a: "auto", b: "auto", c: "ask" });
  assert.deepEqual(route(plan.holdBack), { d: "ask", e: "ask" });
  assert.deepEqual(plan.holdBack.find((i) => i.candidateId === "e").escalations, [ESCALATION.UNREADABLE_RESUME]);
});

test("shortlist plan in Assisted asks about everything", () => {
  const plan = planShortlist(pool, config, ASSISTED);
  assert.ok([...plan.shortlist, ...plan.holdBack].every((i) => i.route === ROUTE.ASK));
});

test("shortlist plan respects the cap, counting candidates already taken", () => {
  const plan = planShortlist(pool, { ...config, maxShortlist: 2 }, AUTOPILOT, 1);
  assert.deepEqual(plan.shortlist.map((i) => i.candidateId), ["a"]);
  assert.deepEqual(plan.holdBack.map((i) => i.candidateId).sort(), ["b", "c", "d", "e"]);
});

test("invite plan: Autopilot sends up to the daily cap and defers the rest; Assisted asks", () => {
  assert.deepEqual(planInvites(["a", "b", "c"], AUTOPILOT, { dailyCap: 2, sentToday: 1 }), { auto: ["a"], ask: [], deferred: ["b", "c"] });
  assert.deepEqual(planInvites(["a", "b"], AUTOPILOT, { dailyCap: 2, sentToday: 5 }), { auto: [], ask: [], deferred: ["a", "b"] });
  assert.deepEqual(planInvites(["a", "b"], ASSISTED, { dailyCap: 2 }), { auto: [], ask: ["a", "b"], deferred: [] });
});

test("final-decision plan: always asked, with the suggestion and escalations", () => {
  const evaluated = [
    { id: "x", finalScore: 88, finalAnalysis: { suggestedDecision: CANDIDATE_STATUS.FINAL_SHORTLISTED } },
    { id: "y", finalScore: null, finalAnalysis: { suggestedDecision: NEEDS_REVIEW } },
  ];
  const plan = planFinalDecisions(evaluated, config, AUTOPILOT);
  assert.deepEqual(plan.map((p) => [p.candidateId, p.route, p.suggestion]), [
    ["x", "ask", CANDIDATE_STATUS.FINAL_SHORTLISTED],
    ["y", "ask", NEEDS_REVIEW],
  ]);
  assert.deepEqual(plan[1].escalations, [ESCALATION.NEEDS_REVIEW]);
});

test("approval choices: default to the proposal; needs_review requires a pick; invalid picks refused", () => {
  assert.equal(resolveChoice(AGENT_ACTION.SHORTLIST), CANDIDATE_STATUS.SHORTLISTED);
  assert.equal(resolveChoice(AGENT_ACTION.HOLD_BACK), CANDIDATE_STATUS.NOT_SHORTLISTED);
  assert.equal(resolveChoice(AGENT_ACTION.HOLD_BACK, { choice: CANDIDATE_STATUS.SHORTLISTED }), CANDIDATE_STATUS.SHORTLISTED);
  assert.equal(resolveChoice(AGENT_ACTION.FINAL_DECISION, { suggestion: CANDIDATE_STATUS.FINAL_REJECTED }), CANDIDATE_STATUS.FINAL_REJECTED);
  assert.equal(resolveChoice(AGENT_ACTION.FINAL_DECISION, { suggestion: NEEDS_REVIEW }), null);
  assert.throws(() => resolveChoice(AGENT_ACTION.FINAL_DECISION, { choice: CANDIDATE_STATUS.HIRED }), /not a valid choice/);
  assert.equal(resolveChoice(AGENT_ACTION.SEND_INVITES), null);
});
