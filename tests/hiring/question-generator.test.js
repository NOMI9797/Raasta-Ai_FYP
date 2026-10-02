import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import {
  questionMix, mixTotal, normaliseQuestion, validateGeneratedQuestions, generateJobQuestions,
  generatePersonalisedQuestions, buildCandidateQuestionList, snapshotQuestions, WARMUP_FALLBACK,
} from "../../libs/interview/question-generator";
import { WARMUP_QUESTION, buildQuestionsUser } from "../../libs/ai/prompts/questions";
import { validateQuestionInput } from "../../libs/interview/question-bank";

const job = JSON.parse(fs.readFileSync("tests/fixtures/jobs/devops-engineer.json", "utf8"));
const q = (question, category = "technical", extra = {}) => ({
  question, category, difficulty: "medium", idealAnswer: "A strong answer explains the approach clearly.",
  expectedKeywords: ["docker", "kubernetes", "pipelines"], scoreWeight: 3, ...extra,
});

test("question mix: 8 → 1 warm-up, 2+2 technical, 1 role, 2 behavioral; other counts scale", () => {
  assert.deepEqual(questionMix(8), { warmup: 1, technicalMedium: 2, technicalHard: 2, role: 1, behavioral: 2 });
  for (const n of [3, 5, 8, 10, 12, 15]) {
    const mix = questionMix(n);
    assert.equal(mixTotal(mix), n, `total for ${n}`);
    assert.ok(mix.technicalMedium + mix.technicalHard >= 1, `technical for ${n}`);
  }
  assert.equal(questionMix(5, { includeWarmup: false }).warmup, 0);
  assert.equal(mixTotal(questionMix(5, { includeWarmup: false })), 5);
});

test("normaliseQuestion drops invalid questions and fixes enums/weights", () => {
  assert.equal(normaliseQuestion(q("What is Docker?", "technical", { idealAnswer: "" })), null);
  assert.equal(normaliseQuestion(q("What is Docker?", "technical", { expectedKeywords: ["one"] })), null);
  assert.equal(normaliseQuestion(q(Array(41).fill("word").join(" "))), null);
  const fixed = normaliseQuestion(q("Explain blue/green deploys.", "weird", { difficulty: "extreme", scoreWeight: 9 }));
  assert.equal(fixed.category, "technical");
  assert.equal(fixed.difficulty, "medium");
  assert.equal(fixed.scoreWeight, 3);
  const dedupedKeywords = normaliseQuestion(q("x?", "role", { expectedKeywords: ["A", "a", " b ", "", 3, "c"] }));
  assert.deepEqual(dedupedKeywords.expectedKeywords, ["A", "b", "c"]);
});

test("validation orders warm-up, technical, role, behavioral and removes duplicates", () => {
  const raw = [
    q("Tell me about a time you handled an outage.", "behavioral"),
    q("How would you design a CI/CD pipeline for microservices?"),
    q("Walk me through a typical first week setting up our platform.", "role"),
    q(WARMUP_QUESTION, "role", { difficulty: "easy", scoreWeight: 3 }),
    q("How would you design a CI/CD pipeline for microservices?"), // duplicate
    q("How do you secure an EKS cluster?"),
  ];
  const out = validateGeneratedQuestions(raw, { count: 8, existing: ["How do you secure an EKS cluster?"], needsWarmup: true });
  assert.deepEqual(out.map((x) => x.question), [
    WARMUP_QUESTION,
    "How would you design a CI/CD pipeline for microservices?",
    "Walk me through a typical first week setting up our platform.",
    "Tell me about a time you handled an outage.",
  ]);
  assert.equal(out[0].scoreWeight, 1); // warm-up always weight 1
});

test("missing warm-up gets the standard one; append mode never adds a second", () => {
  const raw = [q("How do you size Kubernetes nodes?"), q("Tell me about a time you led a migration.", "behavioral")];
  const withWarmup = validateGeneratedQuestions(raw, { count: 3, needsWarmup: true });
  assert.equal(withWarmup[0].question, WARMUP_QUESTION);
  assert.equal(withWarmup[0].idealAnswer, WARMUP_FALLBACK.idealAnswer);
  const append = validateGeneratedQuestions([q(WARMUP_QUESTION, "role", { difficulty: "easy" }), ...raw], { count: 5, needsWarmup: false });
  assert.equal(append.some((x) => x.question === WARMUP_QUESTION), false);
});

test("the cap keeps the warm-up and the first questions of each section", () => {
  const raw = Array.from({ length: 12 }, (_, i) => q(`Technical question number ${i}?`));
  const out = validateGeneratedQuestions(raw, { count: 8, needsWarmup: true });
  assert.equal(out.length, 8);
  assert.equal(out[0].question, WARMUP_QUESTION);
});

test("generateJobQuestions retries when too few survive, then succeeds", async () => {
  let calls = 0;
  const good = Array.from({ length: 7 }, (_, i) => q(`Valid question ${i}?`));
  const llm = async () => {
    calls += 1;
    return { questions: calls === 1 ? [q("Only one?")] : good };
  };
  const out = await generateJobQuestions({ job, count: 8 }, { llm });
  assert.equal(calls, 2);
  assert.equal(out.length, 8); // 7 + standard warm-up
});

test("generateJobQuestions fails after 3 attempts with too few valid questions", async () => {
  let calls = 0;
  const llm = async () => { calls += 1; return { questions: [q("Lonely?")] }; };
  await assert.rejects(generateJobQuestions({ job, count: 8 }, { llm }), /valid/);
  assert.equal(calls, 3);
});

test("the prompt asks for the doc's mix and lists existing questions", () => {
  const user = buildQuestionsUser({ job, mix: questionMix(8), existing: ["How do you secure an EKS cluster?"] });
  assert.match(user, /exactly 8 interview questions/);
  assert.match(user, /2 technical, medium/);
  assert.match(user, /2 behavioral/);
  assert.match(user, /- How do you secure an EKS cluster\?/);
});

test("personalised questions come from screening gaps and are never behavioral", async () => {
  const candidate = { fitAnalysis: { concerns: ["No Terraform experience"], skillMatch: { missing: ["Terraform"] } } };
  const llm = async () => ({ questions: [q("Your resume doesn't mention Terraform; how have you managed infrastructure?", "behavioral"), q("How would you learn Terraform quickly?", "role")] });
  const out = await generatePersonalisedQuestions({ job, candidate, count: 2 }, { llm });
  assert.equal(out.length, 2);
  assert.ok(out.every((x) => x.category !== "behavioral"));
  assert.deepEqual(await generatePersonalisedQuestions({ job, candidate: { fitAnalysis: {} }, count: 2 }, { llm }), []);
});

test("candidate question list slots personalised questions after the technical block", () => {
  const bank = [
    { id: "w", category: "role", orderIndex: 0 }, { id: "t1", category: "technical", orderIndex: 1 },
    { id: "t2", category: "technical", orderIndex: 2 }, { id: "r", category: "role", orderIndex: 3 },
    { id: "b", category: "behavioral", orderIndex: 4 },
  ];
  const personal = [{ id: "p2", category: "technical", orderIndex: 1 }, { id: "p1", category: "technical", orderIndex: 0 }];
  assert.deepEqual(buildCandidateQuestionList(bank, personal).map((x) => x.id), ["w", "t1", "t2", "p1", "p2", "r", "b"]);
  const noTech = bank.filter((x) => x.category !== "technical");
  assert.deepEqual(buildCandidateQuestionList(noTech, personal).map((x) => x.id), ["w", "r", "p1", "p2", "b"]);
  assert.deepEqual(buildCandidateQuestionList(bank).map((x) => x.id), ["w", "t1", "t2", "r", "b"]);
});

test("snapshots are independent copies", () => {
  const source = [{ id: "1", question: "Q?", category: "technical", difficulty: "hard", idealAnswer: "A", expectedKeywords: ["k1", "k2"], scoreWeight: 3, userId: "u1" }];
  const snap = snapshotQuestions(source);
  source[0].question = "Edited?";
  source[0].expectedKeywords.push("k3");
  assert.equal(snap[0].question, "Q?");
  assert.deepEqual(snap[0].expectedKeywords, ["k1", "k2"]);
  assert.equal("userId" in snap[0], false);
});

test("manual question validation", () => {
  assert.deepEqual(validateQuestionInput({ question: "  Why Kubernetes? " }).errors, []);
  assert.equal(validateQuestionInput({ question: "Why?" }).value.idealAnswer, "");
  const bad = validateQuestionInput({ question: "", category: "trivia", scoreWeight: 9, expectedKeywords: "x" });
  assert.equal(bad.errors.length, 4);
  const partial = validateQuestionInput({ isActive: false, orderIndex: 2 }, { partial: true });
  assert.deepEqual(partial, { value: { isActive: false, orderIndex: 2 }, errors: [] });
});
