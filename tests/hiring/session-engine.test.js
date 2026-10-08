// InterviewSession loop (docs/ai-hiring/17-testing.md, scenarios 1–11) with fake timers and fake deps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { InterviewSession, looksAlreadyAnswered, greetingText } from "../../libs/interview/session-engine";
import { createFakeClock, settle } from "./helpers/fake-clock";

const QUESTIONS = [
  { id: "q1", question: "Explain how you would design a REST API for a library.", category: "technical", idealAnswer: "Resources, HTTP verbs, status codes, pagination.", expectedKeywords: ["resources", "verbs"], scoreWeight: 1 },
  { id: "q2", question: "Describe a deployment pipeline you built.", category: "technical", idealAnswer: "CI, tests, staging, rollbacks.", expectedKeywords: ["ci"], scoreWeight: 2 },
  { id: "q3", question: "Why do you want this role?", category: "behavioral", idealAnswer: null, expectedKeywords: [], scoreWeight: 1 },
];

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function setup({ questions = QUESTIONS, maxMinutes = 25, analyze, followUp, score, state = null, pausedAt = null, clock = createFakeClock() } = {}) {
  const sent = [];
  const published = [];
  const calls = { appendTurn: [], createResponse: [], updateResponseScore: [], saveState: [], complete: [], abandon: [], enqueue: [], markStarted: 0, integrity: [] };
  let responseSeq = 0;
  const deps = {
    analyze: analyze || (async () => ({ shouldFollowUp: false, reasons: [], reasonForFollowUp: null })),
    followUp: followUp || (async () => ({ question: "Can you give a concrete example?", fallback: false })),
    score: score || (async () => ({ score: 82, reasoning: "Solid", keywordsCovered: ["resources"], keywordsMissed: [], fallback: false })),
    tts: async () => null,
    repo: {
      markStarted: async () => { calls.markStarted += 1; },
      appendTurn: async (id, turn) => { calls.appendTurn.push(turn); },
      createResponse: async (id, r) => { calls.createResponse.push(r); responseSeq += 1; return `r${responseSeq}`; },
      updateResponseScore: async (id, result) => { calls.updateResponseScore.push({ id, result }); },
      saveState: async (id, s) => { calls.saveState.push(s); },
      recordIntegrityEvent: async (id, e) => { calls.integrity.push(e); },
      complete: async (interview, opts) => { calls.complete.push(opts); return { totalAnswers: 3 }; },
      abandon: async (interview, opts) => { calls.abandon.push(opts); },
    },
    send: (type, payload) => sent.push({ type, ...payload }),
    publish: (event) => published.push(event),
    enqueue: async (type, payload) => { calls.enqueue.push({ type, payload }); },
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  };
  const session = new InterviewSession({
    interview: { id: "iv1", candidateId: "c1", expiresAt: new Date(Date.now() + 86400000) },
    job: { id: "j1", title: "DevOps Engineer" },
    candidate: { id: "c1", name: "Ayesha Khan" },
    questions,
    config: { maxFollowUps: 2, interviewMaxMinutes: maxMinutes, silenceMs: 8000 },
    candidateContext: { firstName: "Ayesha", skills: ["docker"] },
    roleContext: { title: "DevOps Engineer", description: "Build pipelines" },
    state,
    pausedAt,
    deps,
  });
  const ofType = (type) => sent.filter((m) => m.type === type);
  const lastSpeaking = () => ofType("ai_speaking").at(-1);
  const ackSpeech = async () => {
    session.onAiDoneSpeaking(lastSpeaking().turnId);
    await settle();
  };
  return { session, clock, sent, published, calls, ofType, lastSpeaking, ackSpeech };
}

// Greeting acknowledged, candidate says "yes ready", Q1 acknowledged → listening for Q1
async function toFirstQuestion(t) {
  await t.session.start({ resume: false });
  await t.ackSpeech();
  t.session.onSttFinal("yes ready", {});
  await settle();
  await t.ackSpeech();
}

const LONG_ANSWER = "I would model books and members as resources, use HTTP verbs for actions, return proper status codes and paginate large lists because clients need predictable behaviour";

test("1. greeting → 'yes ready' → Q1 asked with an empty buffer", async () => {
  const t = setup();
  await t.session.start({ resume: false });
  assert.equal(t.calls.markStarted, 1);
  assert.equal(t.lastSpeaking().kind, "greeting");
  assert.equal(t.lastSpeaking().text, greetingText({ firstName: "Ayesha", jobTitle: "DevOps Engineer", total: 3, minutes: 25 }));
  assert.match(t.lastSpeaking().text, /3 questions in up to 25 minutes/);
  assert.match(t.lastSpeaking().text, /conducted in English/);
  assert.match(t.lastSpeaking().text, /Raasta AI Interviewer/);

  t.session.onSttFinal("hi", {}); // during greeting playback: ignored
  await t.ackSpeech();
  t.session.onSttFinal("hello there", {}); // no ready word
  await settle();
  assert.equal(t.ofType("question").length, 0);

  t.session.onSttFinal("yes ready", {});
  await settle();
  const questions = t.ofType("question");
  assert.equal(questions.length, 1);
  assert.deepEqual(questions[0], { type: "question", index: 1, total: 3, text: QUESTIONS[0].question, kind: "question" });
  assert.equal(t.session.state.currentAnswerBuffer, "");
  assert.equal(t.session.sideBuffer, "");
  assert.equal(t.calls.createResponse.length, 0);
});

test("1b. the Start button works like a ready word", async () => {
  const t = setup();
  await t.session.start({ resume: false });
  t.session.onBegin();
  await settle();
  assert.equal(t.ofType("question").length, 1);
});

test("2. answer + 8 s silence → response saved → next question", async () => {
  const t = setup();
  await toFirstQuestion(t);
  t.session.onSttFinal(LONG_ANSWER, { startMs: 0, endMs: 9000 });
  await t.clock.advance(7000);
  assert.equal(t.calls.createResponse.length, 0);
  await t.clock.advance(1100);
  assert.equal(t.calls.createResponse.length, 1);
  assert.equal(t.calls.createResponse[0].questionId, "q1");
  assert.equal(t.calls.createResponse[0].answer, LONG_ANSWER);
  assert.equal(t.calls.createResponse[0].isFollowUp, false);
  assert.equal(t.ofType("question").at(-1).text, QUESTIONS[1].question);
  assert.equal(t.ofType("question").at(-1).index, 2);
});

test("2b. new speech restarts the silence window", async () => {
  const t = setup();
  await toFirstQuestion(t);
  t.session.onSttFinal("First part of my answer about resources", {});
  await t.clock.advance(6000);
  t.session.onSttFinal("and the second part about verbs", {});
  await t.clock.advance(6000);
  assert.equal(t.calls.createResponse.length, 0);
  await t.clock.advance(2100);
  assert.equal(t.calls.createResponse.length, 1);
  assert.match(t.calls.createResponse[0].answer, /First part.*second part/);
});

test("3. answer + answer_done → immediate processing", async () => {
  const t = setup();
  await toFirstQuestion(t);
  t.session.onSttFinal(LONG_ANSWER, {});
  t.session.onAnswerDone();
  await settle();
  assert.equal(t.calls.createResponse.length, 1);
  assert.ok(t.ofType("processing").length >= 1);
  assert.equal(t.ofType("question").at(-1).text, QUESTIONS[1].question);
});

test("4. concurrency: finals and triggers during processing → only one question is spoken", async () => {
  const gate = deferred();
  const t = setup({ analyze: async () => { await gate.promise; return { shouldFollowUp: false, reasons: [] }; } });
  await toFirstQuestion(t);
  t.session.onSttFinal(LONG_ANSWER, {});
  t.session.onAnswerDone();
  await settle();
  // Short noises while processing, a second answer_done and the silence timer firing
  t.session.onSttFinal("um", {});
  t.session.onSttFinal("ok", {});
  t.session.onAnswerDone();
  await t.clock.advance(9000);
  gate.resolve();
  await settle();
  await t.clock.advance(20000);
  assert.equal(t.ofType("question").length, 2); // Q1 + exactly one more
  assert.equal(t.calls.createResponse.length, 1);
});

test("5. pre-speak guard: candidate keeps talking → nothing spoken or committed, then a reschedule", async () => {
  const gate = deferred();
  let analyses = 0;
  const t = setup({
    analyze: async () => {
      analyses += 1;
      if (analyses === 1) await gate.promise;
      return { shouldFollowUp: true, reasons: [{ condition: "answer_incomplete" }], reasonForFollowUp: { condition: "answer_incomplete", message: "short" } };
    },
  });
  await toFirstQuestion(t);
  t.session.onSttFinal("I would use resources", {});
  t.session.onAnswerDone();
  await settle();
  t.session.onSttFinal("and also HTTP verbs with proper status codes", {});
  gate.resolve();
  await settle();

  assert.equal(t.ofType("question").length, 1, "no follow-up spoken over the candidate");
  assert.equal(t.session.state.followUpDepth, 0, "follow-up depth rolled back");
  assert.equal(t.session.state.currentQuestionId, "q1");
  assert.equal(t.calls.createResponse.length, 0, "nothing persisted for the aborted plan");
  assert.match(t.session.state.currentAnswerBuffer, /^I would use resources and also HTTP verbs/);
  assert.equal(t.session.state.stage, "listening");

  await t.clock.advance(8100); // the rescheduled cycle
  assert.equal(t.calls.createResponse.length, 1);
  assert.equal(t.calls.createResponse[0].answer, "I would use resources and also HTTP verbs with proper status codes");
  assert.equal(t.ofType("question").at(-1).kind, "follow_up");
  assert.equal(t.session.state.followUpDepth, 1);
});

test("6. follow-up cap: always-follow-up analyzer → 2 follow-ups, then the next base question", async () => {
  const t = setup({ analyze: async () => ({ shouldFollowUp: true, reasons: [{ condition: "multi_step_required" }], reasonForFollowUp: { condition: "multi_step_required", message: "m" } }) });
  await toFirstQuestion(t);
  const kinds = [];
  for (let i = 0; i < 3; i += 1) {
    t.session.onSttFinal(`${LONG_ANSWER} ${i}`, {});
    t.session.onAnswerDone();
    await settle();
    kinds.push(t.ofType("question").at(-1).kind);
    await t.ackSpeech();
  }
  assert.deepEqual(kinds, ["follow_up", "follow_up", "question"]);
  assert.equal(t.ofType("question").at(-1).text, QUESTIONS[1].question);
  const responses = t.calls.createResponse;
  assert.deepEqual(responses.map((r) => [r.questionId, r.isFollowUp, r.followUpDepth]), [["q1", false, 0], ["q1", true, 1], ["q1", true, 2]]);
  assert.equal(responses[1].followUpReason, "multi_step_required");
  // Follow-ups keep the base question's index
  assert.deepEqual(t.ofType("question").map((q) => q.index), [1, 1, 1, 2]);
});

test("7. time budget: a warning scaled to the length, closing instead of a new question under 1.5 min", async () => {
  const t = setup({ maxMinutes: 8 });
  await toFirstQuestion(t);
  await t.clock.advance(6 * 60 * 1000 + 500); // 2 min left: the first warning for an 8-minute interview
  assert.deepEqual(t.ofType("time_warning").map((w) => w.minutesLeft), [2]);
  await t.clock.advance(25 * 1000); // ~1.6 min left
  t.session.onSttFinal(LONG_ANSWER, {});
  await t.clock.advance(10 * 1000); // ~1.4 min left after the silence window → under the threshold
  assert.equal(t.calls.createResponse.length, 1);
  assert.equal(t.lastSpeaking().kind, "closing");
  assert.equal(t.ofType("question").length, 1);
  await t.ackSpeech();
  assert.equal(t.ofType("interview_complete").at(-1).reason, "finished");
});

test("7b. time runs out mid-answer: 60 s grace, then the answer is saved and the interview closes", async () => {
  const t = setup({ maxMinutes: 5 });
  await toFirstQuestion(t);
  await t.clock.advance(4 * 60 * 1000 + 59 * 1000);
  // "5 minutes left" would be silly in a 5-minute interview: only the last-minute warning
  assert.deepEqual(t.ofType("time_warning").map((w) => w.minutesLeft), [1]);
  // Keep talking every few seconds so silence never finalises
  for (let i = 0; i < 25; i += 1) {
    t.session.onSttFinal(`still explaining part ${i}`, {});
    await t.clock.advance(3000);
  }
  assert.equal(t.calls.createResponse.length, 1);
  assert.equal(t.lastSpeaking().kind, "closing");
  await t.ackSpeech();
  assert.equal(t.ofType("interview_complete").at(-1).reason, "time_up");
});

test("8. questions exhausted → closing turn, interview_complete, repo.complete, analyse-interview queued", async () => {
  const t = setup();
  await toFirstQuestion(t);
  for (let i = 0; i < 3; i += 1) {
    t.session.onSttFinal(`${LONG_ANSWER} number ${i}`, {});
    t.session.onAnswerDone();
    await settle();
    await t.ackSpeech();
  }
  assert.equal(t.session.state.stage, "ended");
  const closingTurn = t.calls.appendTurn.find((turn) => turn.kind === "closing");
  assert.match(closingTurn.text, /^Thank you, Ayesha\. That concludes your interview for DevOps Engineer\./);
  assert.deepEqual(t.ofType("interview_complete"), [{ type: "interview_complete", reason: "finished" }]);
  assert.equal(t.calls.complete.length, 1);
  assert.equal(t.calls.complete[0].questions.length, 3);
  assert.deepEqual(t.calls.enqueue, [{ type: "analyse-interview", payload: { interviewId: "iv1" } }]);
  // Turn seq is monotonic and unique
  const seqs = t.calls.appendTurn.map((turn) => turn.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  assert.equal(new Set(seqs).size, seqs.length);
});

test("9. resume: serialized state → new session re-asks the current question", async () => {
  const t = setup();
  await toFirstQuestion(t);
  t.session.onSttFinal(LONG_ANSWER, {});
  t.session.onAnswerDone();
  await settle();
  await t.ackSpeech();
  t.session.onSttFinal("half an answer that is lost", {});
  t.session.pause();
  const saved = t.session.serializeState();
  assert.equal(saved.currentAnswerBuffer, "");
  assert.ok(saved.pausedAt);

  await t.clock.advance(3 * 60 * 1000); // disconnected for 3 minutes
  const r = setup({ state: saved, pausedAt: saved.pausedAt, clock: t.clock });
  const elapsedBefore = r.session.elapsedMs();
  await r.session.start({ resume: true });
  assert.equal(r.lastSpeaking().kind, "question");
  assert.equal(r.lastSpeaking().text, `Welcome back, let's continue. ${QUESTIONS[1].question}`);
  assert.deepEqual(r.ofType("question")[0], { type: "question", index: 2, total: 3, text: QUESTIONS[1].question, kind: "question" });
  assert.ok(r.session.elapsedMs() - elapsedBefore < 1000, "time spent disconnected is not counted");
  assert.equal(r.session.state.seq > saved.seq - 1, true);

  await r.ackSpeech();
  r.session.onSttFinal(LONG_ANSWER, {});
  r.session.onAnswerDone();
  await settle();
  assert.equal(r.calls.createResponse[0].questionId, "q2");
});

test("10. scoring: the base question is scored after it left the queue, using the full question list", async () => {
  const scored = [];
  const t = setup({ score: async (answer, question) => { scored.push(question.id); return { score: 75, reasoning: "Good", keywordsCovered: [], keywordsMissed: [] }; } });
  await toFirstQuestion(t);
  assert.ok(!t.session.state.questionQueue.includes("q1"));
  t.session.onSttFinal(LONG_ANSWER, {});
  t.session.onAnswerDone();
  await settle();
  assert.deepEqual(scored, ["q1"]);
  assert.deepEqual(t.calls.updateResponseScore, [{ id: "r1", result: { score: 75, reasoning: "Good", keywordsCovered: [], keywordsMissed: [] } }]);
  assert.ok(t.published.some((e) => e.type === "answer_scored" && e.responseId === "r1" && e.score === 75));
});

test("10b. questions without an ideal answer are not scored; end() waits for pending scores", async () => {
  const gate = deferred();
  const t = setup({ questions: [QUESTIONS[0]], score: async () => { await gate.promise; return { score: 60, reasoning: "x", keywordsCovered: [], keywordsMissed: [] }; } });
  await toFirstQuestion(t);
  t.session.onSttFinal(LONG_ANSWER, {});
  t.session.onAnswerDone();
  await settle();
  const ending = t.session.end("finished");
  await settle();
  assert.equal(t.calls.complete.length, 0, "waits for the score");
  gate.resolve();
  await ending;
  assert.equal(t.calls.updateResponseScore.length, 1);
  assert.equal(t.calls.complete.length, 1);
});

test("11. the candidate channel never receives scores, reasons or ideal answers", async () => {
  const t = setup({ analyze: async () => ({ shouldFollowUp: true, reasons: [{ condition: "skill_avoided" }], reasonForFollowUp: { condition: "skill_avoided", message: "Expected keywords/skills not adequately covered" } }) });
  await toFirstQuestion(t);
  for (let i = 0; i < 6; i += 1) {
    t.session.onSttFinal(`${LONG_ANSWER} ${i}`, {});
    t.session.onAnswerDone();
    await settle();
    if (t.session.ended) break;
    await t.ackSpeech();
  }
  const wire = JSON.stringify(t.sent);
  for (const forbidden of ["score", "reasoning", "idealAnswer", "skill_avoided", "keywords", "Resources, HTTP verbs, status codes", "CI, tests, staging"]) {
    assert.ok(!wire.includes(forbidden), `candidate payloads must not contain "${forbidden}"`);
  }
  assert.ok(t.published.some((e) => e.type === "answer_scored"), "scores go to the recruiter channel");
});

test("barge-in: words heard while the AI speaks are kept aside and merged only if the candidate keeps talking", async () => {
  const t = setup();
  await toFirstQuestion(t);
  t.session.onSttFinal(LONG_ANSWER, {});
  t.session.onAnswerDone();
  await settle(); // Q2 is now being spoken
  t.session.onSttFinal("so in my last job", {});
  await t.clock.advance(9000);
  assert.equal(t.calls.createResponse.length, 1, "no silence timer while the AI is speaking");
  t.session.onAiDoneSpeaking(t.lastSpeaking().turnId);
  t.session.onSttFinal("we built a CI pipeline with staging", {});
  t.session.onAnswerDone();
  await settle();
  assert.equal(t.calls.createResponse[1].answer, "so in my last job we built a CI pipeline with staging");
});

test("repeat_question: at most twice per question", async () => {
  const t = setup();
  await toFirstQuestion(t);
  t.session.onRepeatQuestion();
  await settle();
  await t.ackSpeech();
  t.session.onRepeatQuestion();
  await settle();
  await t.ackSpeech();
  t.session.onRepeatQuestion();
  await settle();
  assert.equal(t.ofType("question").length, 3);
  assert.equal(t.ofType("error").at(-1).code, "invalid_state");
});

test("missing ai_done_speaking: the ack timer continues the interview", async () => {
  const t = setup();
  await t.session.start({ resume: false });
  await t.clock.advance(60 * 1000);
  t.session.onSttFinal("okay", {});
  await settle();
  assert.equal(t.ofType("question").length, 1);
});

test("integrity events are recorded and relayed to the recruiter only", async () => {
  const t = setup();
  await toFirstQuestion(t);
  t.session.onClientEvent({ event: "tab_hidden", at: "2026-01-01T10:01:00Z" });
  t.session.onClientEvent({ event: "rm -rf", at: "x" });
  await settle();
  assert.deepEqual(t.calls.integrity, [{ type: "tab_hidden", at: "2026-01-01T10:01:00.000Z" }]);
  assert.ok(t.published.some((e) => e.type === "integrity" && e.event === "tab_hidden"));
});

test("abandoned with < 50% answered → abandon; with ≥ 50% → completed partial", async () => {
  const a = setup();
  await toFirstQuestion(a);
  await a.session.end("abandoned");
  assert.equal(a.calls.abandon.length, 1);
  assert.equal(a.calls.complete.length, 0);
  assert.equal(a.calls.enqueue.length, 0);

  const b = setup();
  await toFirstQuestion(b);
  for (let i = 0; i < 2; i += 1) {
    b.session.onSttFinal(`${LONG_ANSWER} ${i}`, {});
    b.session.onAnswerDone();
    await settle();
    await b.ackSpeech();
  }
  await b.session.end("abandoned");
  assert.equal(b.calls.complete.length, 1);
  assert.equal(b.calls.enqueue[0].type, "analyse-interview");
  assert.equal(b.ofType("interview_complete").length, 0);
});

test("skip heuristic: logs skips and is disabled when fewer than 6 questions remain", () => {
  assert.equal(looksAlreadyAnswered("Describe your Kubernetes deployment experience", ["I described my kubernetes deployment experience in detail"]), true);
  assert.equal(looksAlreadyAnswered("Why?", ["why not"]), false);

  const many = Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, question: i === 1 ? "Describe kubernetes deployment experience" : `Unrelated question number ${i} about topic${i}`, expectedKeywords: [] }));
  const t = setup({ questions: many });
  t.session.state.recentAnswers = ["my kubernetes deployment experience is extensive"];
  t.session.state.questionQueue = many.slice(1).map((q) => q.id); // 6 remain → heuristic on
  const next = t.session.peekNextQuestion();
  assert.equal(next.question.id, "m2");
  assert.deepEqual(next.skipped, [{ questionId: "m1", reason: "covered_in_earlier_answer" }]);
  t.session.commitQuestion(next);
  assert.equal(t.session.state.skipped[0].questionId, "m1");

  t.session.state.questionQueue = many.slice(2).map((q) => q.id); // 5 remain → off
  t.session.state.questionQueue.unshift("m1");
  t.session.state.questionQueue = t.session.state.questionQueue.slice(0, 5);
  assert.equal(t.session.peekNextQuestion().question.id, "m1");
});

test("speech activity keeps the silence window open while finals lag behind (Whisper mode)", async () => {
  const t = setup();
  await toFirstQuestion(t);
  t.session.onSttFinal("In my last job I moved our servers to AWS.", {});
  // 5 s pause, then 6 s of speech whose transcript only arrives when the utterance ends
  await t.clock.advance(5000);
  for (let i = 0; i < 24; i += 1) {
    t.session.onSpeechActivity();
    await t.clock.advance(250);
  }
  assert.equal(t.calls.createResponse.length, 0, "not finalised while the candidate is talking");
  t.session.onSttFinal("We used Terraform for the infrastructure.", {});
  await t.clock.advance(8100);
  assert.equal(t.calls.createResponse.length, 1);
  assert.equal(t.calls.createResponse[0].answer, "In my last job I moved our servers to AWS. We used Terraform for the infrastructure.");
});

// ─── Conversation fixes (echo of the interviewer's voice, "end the interview", refusals) ───

test("echo: the question heard back through the speakers is not part of the answer", async () => {
  const t = setup();
  await toFirstQuestion(t);
  const question = QUESTIONS[0].question;
  // The microphone hears the question, then the candidate answers: the transcript has both
  t.session.onSttFinal(question, {});
  t.session.onSttFinal(`${question} ${LONG_ANSWER}`, {});
  t.session.onAnswerDone();
  await settle();
  assert.equal(t.calls.createResponse.length, 1);
  assert.equal(t.calls.createResponse[0].answer, LONG_ANSWER);
  // Captions shown to the candidate never contained the question text
  assert.ok(t.ofType("caption_final").every((c) => !c.text.includes("design a REST API")));
});

test("echo: the greeting heard back does not start the interview by itself", async () => {
  const t = setup();
  await t.session.start({ resume: false });
  await t.ackSpeech();
  t.session.onSttFinal(greetingText({ firstName: "Ayesha", jobTitle: "DevOps Engineer", total: 3, minutes: 25 }), {});
  await settle();
  assert.equal(t.session.state.begun, false, "'ready to begin?' in the interviewer's own voice is not a ready word");
  t.session.onSttFinal("yes I am ready", {});
  await settle();
  assert.equal(t.session.state.begun, true);
});

test("end request by voice: not counted as an answer, the interviewer says goodbye and the interview ends", async () => {
  const t = setup();
  await toFirstQuestion(t);
  t.session.onSttFinal(LONG_ANSWER, {});
  t.session.onAnswerDone();
  await settle();
  await t.ackSpeech(); // Q2 spoken
  t.session.onSttFinal("Actually I want to end the interview, so kindly end it right now.", {});
  t.session.onAnswerDone();
  await settle();

  assert.equal(t.lastSpeaking().kind, "closing");
  assert.match(t.lastSpeaking().text, /^Understood, Ayesha\. I'll end the interview here\./);
  assert.equal(t.calls.createResponse.length, 1, "the request is in the transcript but is not an answered question");
  assert.ok(t.calls.appendTurn.some((turn) => turn.speaker === "candidate" && /end the interview/.test(turn.text)));
  await t.ackSpeech();
  assert.deepEqual(t.ofType("interview_complete"), [{ type: "interview_complete", reason: "ended_by_candidate" }]);
  assert.equal(t.calls.complete.length, 1, "1 of 3 answered: kept as a partial interview for the recruiter");
  assert.equal(t.calls.abandon.length, 0);
  assert.deepEqual(t.calls.enqueue.map((e) => e.type), ["analyse-interview"]);
});

test("end button mid-answer: what was said so far is saved, then the interview ends", async () => {
  const t = setup();
  await toFirstQuestion(t);
  t.session.onSttFinal("I would start with the routes and controllers", {});
  await t.session.onEndRequest({ source: "button" });
  await settle();
  assert.equal(t.calls.createResponse.length, 1);
  assert.equal(t.calls.createResponse[0].answer, "I would start with the routes and controllers");
  assert.equal(t.lastSpeaking().kind, "closing");
  await t.ackSpeech();
  assert.equal(t.ofType("interview_complete").at(-1).reason, "ended_by_candidate");
  assert.equal(t.calls.complete.length, 1);
});

test("ending before answering anything: nothing to evaluate, the interview is abandoned and the room still closes", async () => {
  const t = setup();
  await t.session.start({ resume: false });
  await t.ackSpeech();
  await t.session.onEndRequest({ source: "button" });
  await settle();
  await t.ackSpeech();
  assert.equal(t.calls.abandon.length, 1);
  assert.equal(t.calls.complete.length, 0);
  assert.equal(t.ofType("interview_complete").at(-1).reason, "ended_by_candidate");
});

test("a long answer that mentions ending the interview is still an answer", async () => {
  const t = setup();
  await toFirstQuestion(t);
  t.session.onSttFinal(`${LONG_ANSWER} and when the user logs out we end the session`, {});
  t.session.onAnswerDone();
  await settle();
  assert.equal(t.calls.createResponse.length, 1);
  assert.equal(t.ofType("question").at(-1).text, QUESTIONS[1].question);
});

test("a refusal gets no follow-up, scores zero without asking the scorer, and the interview moves on", async () => {
  let scored = 0;
  const t = setup({
    analyze: async () => ({ shouldFollowUp: true, reasons: [{ condition: "answer_incomplete" }], reasonForFollowUp: { condition: "answer_incomplete", message: "short" } }),
    score: async () => { scored += 1; return { score: 80, reasoning: "x", keywordsCovered: [], keywordsMissed: [], fallback: false }; },
  });
  await toFirstQuestion(t);
  t.session.onSttFinal("No, I don't want to answer that.", {});
  t.session.onAnswerDone();
  await settle();
  assert.equal(t.ofType("question").at(-1).kind, "question");
  assert.equal(t.ofType("question").at(-1).text, QUESTIONS[1].question);
  assert.equal(scored, 0);
  assert.equal(t.calls.updateResponseScore[0].result.score, 0);
  assert.equal(t.calls.updateResponseScore[0].result.reasoning, "The candidate declined to answer.");
});

// ───────────────────────────── interview length ─────────────────────────────

const mixedBank = (n) => Array.from({ length: n }, (_, i) => ({
  id: `b${i + 1}`,
  question: `Bank question number ${i + 1}?`,
  category: ["role", "technical", "technical", "technical", "technical", "role", "behavioral", "behavioral"][i % 8],
  idealAnswer: null,
  expectedKeywords: [],
  scoreWeight: i % 8 === 0 ? 1 : 2,
}));

test("length: a 10-minute interview asks only the questions that fit and says so in the greeting", async () => {
  const t = setup({ questions: mixedBank(8), maxMinutes: 10 });
  assert.equal(t.session.state.totalQuestions, 3);
  await t.session.start({ resume: false });
  assert.match(t.lastSpeaking().text, /3 questions in up to 10 minutes/);
  await t.ackSpeech();
  t.session.onSttFinal("yes ready", {});
  await settle();
  await t.ackSpeech();
  for (let i = 0; i < 3; i += 1) {
    t.session.onSttFinal(`${LONG_ANSWER} number ${i}`, {});
    t.session.onAnswerDone();
    await settle();
    await t.ackSpeech();
  }
  assert.equal(t.calls.createResponse.length, 3);
  assert.deepEqual(t.ofType("question").map((q) => q.total), [3, 3, 3]);
  assert.equal(t.session.state.stage, "ended");
  assert.equal(t.calls.complete[0].totalQuestions, 3, "the interview is complete at 3 of 3, not 3 of 8");
  assert.equal(t.calls.complete[0].questions.length, 8, "scoring still knows the whole bank");
});

test("length: a long interview asks the whole bank", () => {
  const t = setup({ questions: mixedBank(8), maxMinutes: 45 });
  assert.equal(t.session.state.totalQuestions, 8);
  assert.equal(t.session.config.maxMs, 45 * 60 * 1000);
});

test("length: follow-ups stop once the questions still to come need the remaining time", async () => {
  const always = async () => ({ shouldFollowUp: true, reasons: ["thin"], reasonForFollowUp: "thin" });
  const answerFirst = async (t) => {
    t.session.onSttFinal(LONG_ANSWER, {});
    t.session.onAnswerDone();
    await settle();
    return t.ofType("question").at(-1).kind;
  };

  const early = setup({ questions: mixedBank(8), maxMinutes: 10, analyze: always });
  await toFirstQuestion(early);
  assert.equal(await answerFirst(early), "follow_up", "plenty of time: a follow-up");

  const late = setup({ questions: mixedBank(8), maxMinutes: 10, analyze: always });
  await toFirstQuestion(late);
  await late.clock.advance(5.5 * 60 * 1000); // about 4.5 min left for 2 more questions
  assert.equal(await answerFirst(late), "question", "short of time: straight on to the next planned question");
});

// ───────────────────────────── English only ─────────────────────────────

test("language: Urdu before the first question -> English only, and are they ready", async () => {
  const t = setup();
  await t.session.start({ resume: false });
  await t.ackSpeech();
  await t.session.onNonEnglishSpeech({ language: "urdu" });
  const spoken = t.lastSpeaking();
  assert.equal(spoken.kind, "system");
  assert.equal(spoken.text, "Ayesha, I noticed you spoke in Urdu. This interview is conducted in English only, so please answer in English. Are you ready to begin?");
  assert.equal(t.session.state.begun, false);
  assert.deepEqual(t.calls.integrity.map((e) => e.type), ["non_english_speech"]);
  assert.deepEqual(t.published.filter((e) => e.type === "language_notice"), [{ type: "language_notice", count: 1 }]);

  await t.ackSpeech();
  assert.equal(t.session.state.stage, "greeting");
  t.session.onSttFinal("yes ready", {});
  await settle();
  assert.equal(t.ofType("question").length, 1, "an English ready still starts the interview");
});

test("language: Urdu mid-question -> nothing is saved, the notice is spoken and the question asked again", async () => {
  const t = setup();
  await toFirstQuestion(t);
  const asked = t.ofType("question").at(-1).text;
  t.session.onSttFinal("well I think", {});
  await t.session.onNonEnglishSpeech({ language: "urdu" });

  const spoken = t.lastSpeaking();
  assert.equal(spoken.kind, "question");
  assert.match(spoken.text, /^Ayesha, I noticed you spoke in Urdu\. This interview is conducted in English only/);
  assert.ok(spoken.text.endsWith(`Let me ask the question again. ${asked}`));
  assert.equal(t.session.state.currentAnswerBuffer, "", "the half answer is dropped: they answer afresh");
  assert.equal(t.calls.createResponse.length, 0);
  assert.equal(t.ofType("question").at(-1).text, asked, "the on-screen question is the plain question");

  await t.ackSpeech();
  t.session.onSttFinal(LONG_ANSWER, {});
  t.session.onAnswerDone();
  await settle();
  assert.equal(t.calls.createResponse.length, 1);
  assert.equal(t.calls.createResponse[0].answer, LONG_ANSWER);
});

test("language: one notice per spell, a firmer one when it happens again, none after five", async () => {
  const t = setup();
  await toFirstQuestion(t);
  await t.session.onNonEnglishSpeech({ language: "urdu" });
  const spoken = () => t.ofType("ai_speaking").length;
  const afterFirst = spoken();
  await t.ackSpeech();

  await t.session.onNonEnglishSpeech({ language: "urdu" }); // still the same spell
  assert.equal(spoken(), afterFirst, "within 20 s of the last notice: no second one");
  assert.equal(t.session.state.languageNotices, 1);

  await t.clock.advance(21 * 1000);
  await t.session.onNonEnglishSpeech({ language: "urdu" });
  assert.match(t.lastSpeaking().text, /I need to remind you again: this interview is conducted in English only/);

  for (let i = 0; i < 5; i += 1) {
    await t.ackSpeech();
    await t.clock.advance(21 * 1000);
    await t.session.onNonEnglishSpeech({ language: "urdu" });
  }
  assert.equal(t.session.state.languageNotices, 7);
  assert.equal(t.calls.integrity.length, 7, "every spell is recorded for the recruiter");
  const spokenNotices = t.calls.appendTurn.filter((turn) => turn.speaker === "ai" && /conducted in English only/.test(turn.text));
  assert.equal(spokenNotices.length, 5, "the interviewer stops interrupting after five");
});

test("language: another language is named only when it is Urdu", async () => {
  const t = setup();
  await t.session.start({ resume: false });
  await t.ackSpeech();
  await t.session.onNonEnglishSpeech({ language: null });
  assert.match(t.lastSpeaking().text, /I noticed you spoke in a language other than English\./);
});

test("language: a sentence in Urdu after a long English answer does not cut the answer off; the reminder rides on the next question", async () => {
  const t = setup();
  await toFirstQuestion(t);
  t.session.onSttFinal(LONG_ANSWER, {});
  const before = t.ofType("ai_speaking").length;
  await t.session.onNonEnglishSpeech({ language: "urdu" });
  assert.equal(t.ofType("ai_speaking").length, before, "no interruption");
  assert.equal(t.session.state.currentAnswerBuffer, LONG_ANSWER);
  assert.equal(t.session.state.languageReminderPending, true);

  t.session.onAnswerDone();
  await settle();
  assert.match(t.lastSpeaking().text, /^A quick reminder: please keep your answers in English\. /);
  assert.ok(!t.ofType("question").at(-1).text.startsWith("A quick reminder"), "the question on screen stays plain");
  assert.equal(t.session.state.languageReminderPending, false);
});

test("language: nothing is said while the interviewer is speaking, or after the interview ended", async () => {
  const t = setup();
  await t.session.start({ resume: false });
  const before = t.ofType("ai_speaking").length;
  await t.session.onNonEnglishSpeech({ language: "urdu" }); // the greeting is still playing
  assert.equal(t.ofType("ai_speaking").length, before);
  assert.equal(t.session.state.languageNotices, 0);
  await t.session.end("finished");
  await t.session.onNonEnglishSpeech({ language: "urdu" });
  assert.equal(t.session.state.languageNotices, 0);
});
