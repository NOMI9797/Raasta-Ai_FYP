// Stage 5: post-interview evaluation and the final suggestion (docs/ai-hiring/11-stage2-evaluation.md).
// Real code: the communication score, interview score, final score, decision rule, recommendation
// ladder and escalation rules. Every expected number below was worked out by hand from the formulas
// in doc 11 (the arithmetic is in each case's comment), not copied from the program's output.
import assert from "node:assert/strict";
import {
  NEEDS_REVIEW, communicationScore, composureScore, fallbackSummary, finalScore, fluencyScore,
  normaliseSummary, paceScore, recommendationFromScore, suggestDecision,
} from "../../libs/hiring/final-evaluator";
import { computeInterviewScore } from "../../libs/interview/repository";
import { countAnswered, selectEvidence } from "../../libs/hiring/finalize";
import { ESCALATION, finalEscalations } from "../../libs/agent/policy";

const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`);

export default {
  id: 5,
  title: "Evaluation and final suggestion",
  tier: "offline",
  intro: "How the interview becomes numbers, and when the system is allowed to suggest a decision. All arithmetic checked by hand.",
  cases: [
    {
      id: "S5-01",
      title: "Speaking pace: full marks at 110-160 words per minute, falling to zero at 70 and 210",
      requirement: "Pace score formula (11 §1.6).",
      input: "wpm 135, 110, 160, 90, 185, 70, 210, 250",
      expect: "100, 100, 100, 50, 50, 0, 0, 0; no wpm → no score",
      run: async () => {
        // 90 wpm: (90 - 70) / 40 × 100 = 50.  185 wpm: (210 - 185) / 50 × 100 = 50
        const got = [135, 110, 160, 90, 185, 70, 210, 250].map(paceScore);
        assert.deepEqual(got, [100, 100, 100, 50, 50, 0, 0, 0]);
        assert.equal(paceScore(undefined), null);
        return got.join(", ");
      },
    },
    {
      id: "S5-02",
      title: "Fluency: fillers (um, uh) and long pauses cost points",
      requirement: "fluency = 100 − min(100, fillers/min × 12) × 0.6 − min(100, pause ratio × 200) × 0.4",
      input: "2 fillers/min and 10% pauses · 10 fillers/min and 50% pauses · pauses only (10%)",
      expect: "77.6 · 0 · 80",
      run: async () => {
        // 100 − (2×12 = 24)×0.6 − (0.10×200 = 20)×0.4 = 100 − 14.4 − 8 = 77.6
        close(fluencyScore({ fillerPerMin: 2, pauseRatio: 0.1 }), 77.6, "normal speaker");
        // 100 − 100×0.6 − 100×0.4 = 0 (both penalties are capped at 100)
        close(fluencyScore({ fillerPerMin: 10, pauseRatio: 0.5 }), 0, "very hesitant");
        // no transcript: pauses only, 100 − 20 = 80
        close(fluencyScore({ pauseRatio: 0.1 }), 80, "pauses only");
        return "77.6 · 0 · 80";
      },
    },
    {
      id: "S5-03",
      title: "Composure: the share of calm, neutral or happy voice",
      requirement: "composure = 100 × (neutral + happy + calm share)",
      input: "neutral 0.5, happy 0.2, anxious 0.3 · calm 0.4, neutral 0.4, angry 0.2",
      expect: "70 · 80",
      run: async () => {
        close(composureScore({ distribution: { neutral: 0.5, happy: 0.2, anxious: 0.3 } }), 70, "first");
        close(composureScore({ distribution: { calm: 0.4, neutral: 0.4, angry: 0.2 } }), 80, "second");
        assert.equal(composureScore({}), null);
        return "70 · 80 · no data → none";
      },
    },
    {
      id: "S5-04",
      title: "Communication score with voice, eye contact and composure: the doc 11 worked example",
      requirement: "weights pace 0.30, fluency 0.30, eye contact 0.25, composure 0.15 (11 §1.6)",
      input: "135 wpm, 2 fillers/min, 10% pauses, eye contact 80, emotion neutral 0.7 + happy 0.1 + anxious 0.2",
      expect: "0.30×100 + 0.30×77.6 + 0.25×80 + 0.15×80 = 30 + 23.28 + 20 + 12 = 85.28 → 85",
      run: async () => {
        const result = communicationScore({
          voice: { wpm: 135, fillerPerMin: 2, pauseRatio: 0.1 },
          gaze: { eyeContactScore: 80 },
          emotion: { distribution: { neutral: 0.7, happy: 0.1, anxious: 0.2 } },
        });
        assert.equal(result.score, 85);
        assert.deepEqual(result.components, { pace: 100, fluency: 78, eyeContact: 80, composure: 80 });
        return `score ${result.score}, parts ${JSON.stringify(result.components)}`;
      },
    },
    {
      id: "S5-05",
      title: "No camera: the missing part is left out and the others are re-weighted, not scored as zero",
      requirement: "A missing measurement must not punish the candidate (11 §1.6).",
      input: "same as S5-04 but without eye contact",
      expect: "(30 + 23.28 + 12) / 0.75 = 87.04 → 87; eye contact reported as missing",
      run: async () => {
        const result = communicationScore({
          voice: { wpm: 135, fillerPerMin: 2, pauseRatio: 0.1 },
          emotion: { distribution: { neutral: 0.7, happy: 0.1, anxious: 0.2 } },
        });
        assert.equal(result.score, 87);
        assert.equal(result.components.eyeContact, null);
        assert.equal("eyeContact" in result.weights, false);
        return `score ${result.score}, eye contact ${result.components.eyeContact}, weights ${JSON.stringify(result.weights)}`;
      },
    },
    {
      id: "S5-06",
      title: "Interview score: follow-ups average into their question, harder questions weigh more",
      requirement: "Average per base question, weighted by scoreWeight; unscored answers are ignored (11 §1.5).",
      input: "q1 (weight 1): 80 and follow-up 60 · q2 (weight 2): 90 · q3 (weight 1): not scored",
      expect: "q1 = (80+60)/2 = 70; (70×1 + 90×2) / (1+2) = 83.33 → 83",
      run: async () => {
        const responses = [
          { questionId: "q1", score: 80 }, { questionId: "q1", score: 60, isFollowUp: true },
          { questionId: "q2", score: 90 }, { questionId: "q3", score: null },
        ];
        const questions = [{ id: "q1", scoreWeight: 1 }, { id: "q2", scoreWeight: 2 }, { id: "q3", scoreWeight: 1 }];
        assert.equal(computeInterviewScore(responses, questions), 83);
        assert.equal(computeInterviewScore([], questions), null);
        return "83 (and no scored answers → no score)";
      },
    },
    {
      id: "S5-07",
      title: "Final score = 30% resume + 50% interview + 20% communication",
      requirement: "Default final weights 0.3 / 0.5 / 0.2 (05 §1).",
      input: "fit 92, interview 80, communication 85",
      expect: "0.3×92 + 0.5×80 + 0.2×85 = 27.6 + 40 + 17 = 84.6 → 85",
      run: async () => {
        const weights = { resume: 0.3, interview: 0.5, communication: 0.2 };
        const full = finalScore({ fitScore: 92, interviewScore: 80, communicationScore: 85 }, weights);
        assert.equal(full.score, 85);
        return `final score ${full.score}`;
      },
    },
    {
      id: "S5-08",
      title: "If the communication part is missing, the other two are re-weighted",
      requirement: "Missing parts are dropped and the weights renormalised, never counted as zero.",
      input: "fit 80, interview 70, communication missing",
      expect: "(0.3×80 + 0.5×70) / 0.8 = (24 + 35) / 0.8 = 73.75 → 74",
      run: async () => {
        const result = finalScore({ fitScore: 80, interviewScore: 70, communicationScore: null }, { resume: 0.3, interview: 0.5, communication: 0.2 });
        assert.equal(result.score, 74);
        assert.equal("communication" in result.breakdown.weights, false);
        return `final score ${result.score}, weights used ${JSON.stringify(result.breakdown.weights)}`;
      },
    },
    {
      id: "S5-09",
      title: "The threshold decides the suggestion: 70 is shortlisted, 69 is not",
      requirement: "score >= finalThreshold → final_shortlisted, else final_rejected (11 §2).",
      input: "scores 70 and 69, threshold 70, all questions answered",
      expect: "final_shortlisted, final_rejected",
      run: async () => {
        const decide = (score) => suggestDecision({ score, threshold: 70, totalAnswers: 3, totalQuestions: 3 });
        assert.equal(decide(70), "final_shortlisted");
        assert.equal(decide(69), "final_rejected");
        return `70 → ${decide(70)} · 69 → ${decide(69)}`;
      },
    },
    {
      id: "S5-10",
      title: "A high score is not trusted if fewer than half the questions were answered",
      requirement: "needs_review guard: a person looks at thin interviews (11 §2).",
      input: "score 95 with 1 of 3 answered · score 95 with 2 of 4 answered · no score at all",
      expect: "needs_review · final_shortlisted (exactly half is enough) · needs_review",
      run: async () => {
        const one = suggestDecision({ score: 95, threshold: 70, totalAnswers: 1, totalQuestions: 3 });
        const half = suggestDecision({ score: 95, threshold: 70, totalAnswers: 2, totalQuestions: 4 });
        const none = suggestDecision({ score: null, threshold: 70, totalAnswers: 3, totalQuestions: 3 });
        assert.equal(one, NEEDS_REVIEW);
        assert.equal(half, "final_shortlisted");
        assert.equal(none, NEEDS_REVIEW);
        return `${one} · ${half} · ${none}`;
      },
    },
    {
      id: "S5-11",
      title: "Recommendation wording follows the score when the AI gives none",
      requirement: "strong_yes / yes / maybe / no ladder around the threshold (11 §2).",
      input: "threshold 70: scores 90, 85, 84, 70, 69, 55, 54",
      expect: "strong_yes, strong_yes, yes, yes, maybe, maybe, no",
      run: async () => {
        const got = [90, 85, 84, 70, 69, 55, 54].map((s) => recommendationFromScore(s, 70));
        assert.deepEqual(got, ["strong_yes", "strong_yes", "yes", "yes", "maybe", "maybe", "no"]);
        return got.join(", ");
      },
    },
    {
      id: "S5-12",
      title: "A garbage AI summary is replaced by safe values; the fallback summary states facts only",
      requirement: "The summary must never break the evaluation (11 §2).",
      input: "AI returns recommendation \"definitely\", summary 42, strengths as a string; AI unavailable",
      expect: "recommendation \"yes\" (from score 75), no summary, empty lists · fallback text with score, fit, interview, communication, answered count, marked fallback",
      run: async () => {
        const clean = normaliseSummary({ recommendation: "definitely", summary: 42, strengths: "x" }, { score: 75, threshold: 70 });
        assert.equal(clean.recommendation, "yes");
        assert.equal(clean.summary, null);
        assert.deepEqual(clean.strengths, []);
        const fallback = fallbackSummary({
          score: 75, threshold: 70, breakdown: { resume: 92, interview: 80, communication: 85 },
          fitAnalysis: { strengths: [], concerns: [] }, answered: 3, totalQuestions: 3,
        });
        assert.equal(fallback.summary, "The candidate's final score is 75 (threshold 70). Resume fit 92. Interview answers scored 80 on average. Communication 85. 3 of 3 questions were answered.");
        assert.equal(fallback.fallback, true);
        return `"${fallback.summary}"`;
      },
    },
    {
      id: "S5-13",
      title: "Scores near the threshold, thin interviews and long tab-hiding always need a person",
      requirement: "Escalation rules: even in automatic mode these are never decided by the system (policy.js).",
      input: "score 72 (threshold 70) · score 75 · suggestion needs_review · tab hidden 3 times",
      expect: "borderline · nothing · needs_review · integrity",
      run: async () => {
        const config = { finalThreshold: 70 };
        const make = (finalScore, suggestedDecision = "final_shortlisted") => ({ finalScore, finalAnalysis: { suggestedDecision } });
        assert.deepEqual(finalEscalations(make(72), config), [ESCALATION.BORDERLINE]);
        assert.deepEqual(finalEscalations(make(75), config), []);
        assert.ok(finalEscalations(make(95, NEEDS_REVIEW), config).includes(ESCALATION.NEEDS_REVIEW));
        assert.ok(finalEscalations(make(95), config, { tabHiddenCount: 3 }).includes(ESCALATION.INTEGRITY));
        return "72 → borderline · 75 → none · needs_review flagged · 3 hidden-tab events → integrity";
      },
    },
    {
      id: "S5-14",
      title: "The AI summary is shown the strongest and weakest answers as evidence",
      requirement: "Top 3 and bottom 3 scored answers, no duplicates; only base questions count as answered (11 §2).",
      input: "seven scored answers 95, 90, 85, 70, 60, 40, 10; plus a follow-up and a blank answer",
      expect: "top 95, 90, 85 · weakest 10, 40, 60 · 7 base questions answered (follow-up and blank not counted)",
      run: async () => {
        const responses = [95, 90, 85, 70, 60, 40, 10].map((score, i) => ({ questionId: `q${i + 1}`, answer: `answer ${i}`, score, isFollowUp: false }));
        const evidence = selectEvidence(responses);
        assert.deepEqual(evidence.top.map((r) => r.score), [95, 90, 85]);
        assert.deepEqual(evidence.bottom.map((r) => r.score), [10, 40, 60]);
        const noisy = [...responses, { questionId: "q1", answer: "more", score: 50, isFollowUp: true }, { questionId: "q8", answer: "  ", score: 0, isFollowUp: false }];
        assert.equal(countAnswered(noisy), 7);
        return `top ${evidence.top.map((r) => r.score).join(", ")} · weakest ${evidence.bottom.map((r) => r.score).join(", ")} · answered ${countAnswered(noisy)}`;
      },
    },
  ],
};
