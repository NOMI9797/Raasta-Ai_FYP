// Stage 2 formulas (docs/ai-hiring/11-stage2-evaluation.md): communication score, final score,
// renormalisation, decision guard, summary validation. All deterministic.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NEEDS_REVIEW, communicationScore, composureScore, fallbackSummary, finalScore, fluencyScore,
  normaliseSummary, paceScore, recommendationFromScore, suggestDecision, weightedAverage,
} from "../../libs/hiring/final-evaluator";
import { countAnswered, selectEvidence } from "../../libs/hiring/finalize";
import { buildFinalUser, FINAL_SYSTEM } from "../../libs/ai/prompts/final";

const WEIGHTS = { resume: 0.3, interview: 0.5, communication: 0.2 };

test("pace: 100 inside 110–160 wpm, linear to 0 at 70 and 210", () => {
  assert.equal(paceScore(110), 100);
  assert.equal(paceScore(135), 100);
  assert.equal(paceScore(160), 100);
  assert.equal(paceScore(90), 50);
  assert.equal(paceScore(70), 0);
  assert.equal(paceScore(50), 0);
  assert.equal(paceScore(185), 50);
  assert.equal(paceScore(210), 0);
  assert.equal(paceScore(260), 0);
  assert.equal(paceScore(null), null);
  assert.equal(paceScore(NaN), null);
});

test("fluency: 100 − min(100, fillers×12)×0.6 − min(100, pauses×200)×0.4", () => {
  assert.equal(fluencyScore({ fillerPerMin: 0, pauseRatio: 0 }), 100);
  // 3.1 fillers/min → 37.2 × 0.6 = 22.32; 0.18 pause ratio → 36 × 0.4 = 14.4
  assert.ok(Math.abs(fluencyScore({ fillerPerMin: 3.1, pauseRatio: 0.18 }) - 63.28) < 1e-9);
  assert.equal(fluencyScore({ fillerPerMin: 20, pauseRatio: 1 }), 0);
  // No transcript: the pause part alone, full range
  assert.equal(fluencyScore({ fillerPerMin: null, pauseRatio: 0.25 }), 50);
  assert.equal(fluencyScore({ fillerPerMin: 5, pauseRatio: null }), 40);
  assert.equal(fluencyScore({}), null);
});

test("composure: neutral + happy (+ calm) share × 100", () => {
  assert.ok(Math.abs(composureScore({ distribution: { neutral: 0.62, happy: 0.2, sad: 0.18 } }) - 82) < 1e-9);
  assert.ok(Math.abs(composureScore({ distribution: { calm: 0.5, angry: 0.5 } }) - 50) < 1e-9);
  assert.equal(composureScore({ distribution: {} }), null);
  assert.equal(composureScore(null), null);
});

test("weighted average renormalises over the parts that are present", () => {
  assert.deepEqual(weightedAverage({ a: 80, b: 60 }, { a: 0.5, b: 0.5 }), { score: 70, weights: { a: 0.5, b: 0.5 } });
  const r = weightedAverage({ a: 80, b: null, c: 50 }, { a: 0.3, b: 0.5, c: 0.2 });
  assert.equal(r.score, 68); // (80×0.3 + 50×0.2) / 0.5
  assert.deepEqual(r.weights, { a: 0.6, c: 0.4 });
  assert.deepEqual(weightedAverage({ a: null }, { a: 1 }), { score: null, weights: {} });
});

test("communication score: doc 11 example, and without video the eye-contact weight is redistributed", () => {
  const analysis = {
    voice: { wpm: 132, pauseRatio: 0.18, fillerPerMin: 3.1 },
    emotion: { distribution: { neutral: 0.62, happy: 0.2, sad: 0.18 } },
    gaze: { eyeContactScore: 78 },
  };
  const full = communicationScore(analysis);
  // 100×0.3 + 63.28×0.3 + 78×0.25 + 82×0.15 = 80.784
  assert.equal(full.score, 81);
  assert.deepEqual(full.components, { pace: 100, fluency: 63, eyeContact: 78, composure: 82 });

  const noVideo = communicationScore({ ...analysis, gaze: null });
  // (30 + 18.984 + 12.3) / 0.75 = 81.712
  assert.equal(noVideo.score, 82);
  assert.equal(noVideo.components.eyeContact, null);
  assert.deepEqual(noVideo.weights, { pace: 0.4, fluency: 0.4, composure: 0.2 });

  assert.equal(communicationScore({}).score, null);
  assert.equal(communicationScore(null).score, null);
});

test("final score: weighted, with missing parts dropped", () => {
  assert.deepEqual(finalScore({ fitScore: 80, interviewScore: 70, communicationScore: 60 }, WEIGHTS).score, 71);
  const noComm = finalScore({ fitScore: 80, interviewScore: 70, communicationScore: null }, WEIGHTS);
  assert.equal(noComm.score, 74); // (24 + 35) / 0.8 = 73.75
  assert.deepEqual(noComm.breakdown, { resume: 80, interview: 70, communication: null, weights: { resume: 0.375, interview: 0.625 } });
  assert.equal(finalScore({ fitScore: null, interviewScore: null, communicationScore: null }, WEIGHTS).score, null);
});

test("decision: threshold, and needs_review when < 50% answered or no score", () => {
  assert.equal(suggestDecision({ score: 70, threshold: 70, totalAnswers: 3, totalQuestions: 3 }), "final_shortlisted");
  assert.equal(suggestDecision({ score: 69, threshold: 70, totalAnswers: 3, totalQuestions: 3 }), "final_rejected");
  assert.equal(suggestDecision({ score: 95, threshold: 70, totalAnswers: 1, totalQuestions: 3 }), NEEDS_REVIEW);
  assert.equal(suggestDecision({ score: 95, threshold: 70, totalAnswers: 2, totalQuestions: 4 }), "final_shortlisted");
  assert.equal(suggestDecision({ score: null, threshold: 70, totalAnswers: 3, totalQuestions: 3 }), NEEDS_REVIEW);
});

test("LLM summary is validated; bad fields fall back to deterministic values", () => {
  const ok = normaliseSummary({ recommendation: "yes", summary: " Good. ", strengths: ["a", 3, ""], risks: "x", suggestedNextSteps: ["1", "2", "3", "4"] }, { score: 80, threshold: 70 });
  assert.deepEqual(ok, { recommendation: "yes", summary: "Good.", strengths: ["a"], risks: [], suggestedNextSteps: ["1", "2", "3"] });
  const bad = normaliseSummary({ recommendation: "hire!!", summary: "" }, { score: 50, threshold: 70 });
  assert.equal(bad.recommendation, "no");
  assert.equal(bad.summary, null);
  assert.equal(recommendationFromScore(90, 70), "strong_yes");
  assert.equal(recommendationFromScore(72, 70), "yes");
  assert.equal(recommendationFromScore(60, 70), "maybe");
  assert.equal(recommendationFromScore(null, 70), "maybe");
});

test("fallback summary uses only computed facts", () => {
  const s = fallbackSummary({
    score: 74, threshold: 70, breakdown: { resume: 80, interview: 70, communication: null },
    fitAnalysis: { strengths: ["Docker"], concerns: ["No Terraform"] }, answered: 3, totalQuestions: 3,
    topAnswers: [{ questionText: "CI/CD?" }], weakAnswers: [{ questionText: "Rollback?" }],
  });
  assert.equal(s.recommendation, "yes");
  assert.match(s.summary, /final score is 74 \(threshold 70\)\. Resume fit 80\. Interview answers scored 70 on average\. 3 of 3 questions/);
  assert.deepEqual(s.strengths, ["Docker", "Strong answer on: CI/CD?"]);
  assert.deepEqual(s.risks, ["No Terraform", "Weak answer on: Rollback?"]);
  assert.equal(s.fallback, true);
});

test("evidence: top 3 and bottom 3 scored answers; answered counts base questions only", () => {
  const responses = [90, 80, 70, 60, 50, 40, 30].map((score, i) => ({ questionId: `q${i % 4}`, questionText: `Q${i}`, answer: "x", score, isFollowUp: i >= 4 }));
  responses.push({ questionId: "q9", answer: "  ", score: 0, isFollowUp: false }, { questionId: "q8", answer: "y", score: null, isFollowUp: false });
  const { top, bottom } = selectEvidence(responses);
  assert.deepEqual(top.map((r) => r.score), [90, 80, 70]);
  assert.deepEqual(bottom.map((r) => r.score), [30, 40, 50]);
  assert.equal(countAnswered(responses), 5); // q0..q3 + q8 (the blank q9 doesn't count)
});

test("final prompt: evidence only, no protected attributes, communication secondary", () => {
  assert.match(FINAL_SYSTEM, /never penalise accent/);
  assert.match(FINAL_SYSTEM, /Never mention or infer name, gender, age, religion/);
  const user = buildFinalUser({
    job: { title: "SRE", requiredSkills: ["Go"] }, fitScore: 80, fitAnalysis: null, interviewScore: 70,
    communication: { score: 60 }, analysis: { voice: { wpm: 120 } }, answers: [{ questionText: "Q", answer: "A", score: 70 }],
    answered: 3, totalQuestions: 3, finalScore: 71, threshold: 70,
  });
  assert.match(user, /Final score: 71\/100 \(shortlist threshold 70\)/);
  assert.match(user, /DELIVERY \(secondary\)/);
});
