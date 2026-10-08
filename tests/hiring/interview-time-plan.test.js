// The interview length shapes the interview: how many questions, which, follow-up room, warnings.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLOSE_RESERVE_MS,
  FOLLOW_UP_COST_MS,
  QUESTION_MIN_MS,
  clampMinutes,
  describeLength,
  followUpAffordable,
  planInterview,
  questionsThatFit,
  selectQuestions,
  warningThresholds,
} from "../../libs/interview/time-plan";

const bank = (specs) => specs.map(([category, scoreWeight], i) => ({ id: `q${i + 1}`, category, scoreWeight }));
// The usual 8-question bank: warm-up first, then technical, role, behavioural
const BANK = bank([["role", 1], ["technical", 3], ["technical", 3], ["technical", 3], ["technical", 3], ["role", 2], ["behavioral", 2], ["behavioral", 2]]);

test("how many questions fit: the pool caps it, one is always asked", () => {
  assert.equal(questionsThatFit(5, 8), 1);
  assert.equal(questionsThatFit(10, 8), 3);
  assert.equal(questionsThatFit(15, 8), 5);
  assert.equal(questionsThatFit(25, 8), 8, "the usual 25 minutes still asks the whole bank of 8");
  assert.equal(questionsThatFit(60, 8), 8);
  assert.equal(questionsThatFit(120, 15), 15);
  assert.equal(questionsThatFit(10, 0), 0);
});

test("lengths are kept between 5 and 120 minutes", () => {
  assert.equal(clampMinutes(1), 5);
  assert.equal(clampMinutes(500), 120);
  assert.equal(clampMinutes("30"), 30);
  assert.equal(clampMinutes(undefined), 25);
});

test("a trimmed interview covers every topic and keeps the bank's order", () => {
  const picked = selectQuestions(BANK, 3).map((q) => q.id);
  assert.deepEqual(picked, ["q2", "q6", "q7"], "one technical, one role, one behavioural: heavier first within a topic");
  assert.deepEqual(selectQuestions(BANK, 1).map((q) => q.id), ["q2"]);
  assert.deepEqual(selectQuestions(BANK, 2).map((q) => q.id), ["q2", "q6"]);
  assert.deepEqual(selectQuestions(BANK, 5).map((q) => q.id), ["q2", "q3", "q4", "q6", "q7"], "after every topic has one, the heaviest questions win");
  assert.deepEqual(selectQuestions(BANK, 8).map((q) => q.id), BANK.map((q) => q.id));
  assert.deepEqual(selectQuestions(BANK, 20).map((q) => q.id), BANK.map((q) => q.id), "room for all: nothing dropped");
});

test("plan: a short interview is trimmed, a long one has room for more questions than the bank holds", () => {
  const short = planInterview({ minutes: 10, questions: BANK, maxFollowUps: 2 });
  assert.equal(short.questionCount, 3);
  assert.equal(short.trimmed, true);
  assert.equal(short.maxMs, 10 * 60 * 1000);
  assert.equal(short.questionIds.length, 3);

  const usual = planInterview({ minutes: 25, questions: BANK });
  assert.equal(usual.questionCount, 8);
  assert.equal(usual.trimmed, false);
  assert.equal(usual.roomForMore, 1, "25 minutes would fit 9 questions: one more than the bank holds");

  const long = planInterview({ minutes: 60, questions: BANK, maxFollowUps: 2 });
  assert.equal(long.roomForMore, 15, "the spare time goes to follow-ups unless the bank grows");
  assert.equal(long.followUpsPerQuestion, 2);
});

test("a follow-up is asked only while every question still to come keeps its minimum time", () => {
  const slack = CLOSE_RESERVE_MS + 3 * QUESTION_MIN_MS;
  assert.equal(followUpAffordable({ remainingMs: slack + FOLLOW_UP_COST_MS, questionsLeft: 3 }), true);
  assert.equal(followUpAffordable({ remainingMs: slack + FOLLOW_UP_COST_MS - 1, questionsLeft: 3 }), false);
  assert.equal(followUpAffordable({ remainingMs: 4 * 60 * 1000, questionsLeft: 0 }), true, "last question: the whole remainder is free for follow-ups");
  assert.equal(followUpAffordable({ remainingMs: 60 * 1000, questionsLeft: 0 }), false);
});

test("warnings scale with the length: a quarter of it (at most 5 minutes), then the last minute", () => {
  assert.deepEqual(warningThresholds(5), [1]);
  assert.deepEqual(warningThresholds(8), [2, 1]);
  assert.deepEqual(warningThresholds(15), [3, 1]);
  assert.deepEqual(warningThresholds(25), [5, 1]);
  assert.deepEqual(warningThresholds(120), [5, 1]);
});

test("describeLength reads as a sentence", () => {
  assert.equal(describeLength({ minutes: 25, questionCount: 8 }), "8 questions in up to 25 minutes");
  assert.equal(describeLength({ minutes: 5, questionCount: 1 }), "1 question in up to 5 minutes");
});
