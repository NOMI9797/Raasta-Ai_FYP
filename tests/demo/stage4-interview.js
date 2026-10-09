// Stage 4: the AI interview conversation (docs/ai-hiring/09-interview-engine.md).
// Real code: the InterviewSession loop (turn taking, silence, follow-ups, time budget, language rule,
// echo guard, end requests, resume), the answer analyzer and the fallback scorer.
// Fakes: a controllable clock (8 s of silence takes no real time), speech-to-text as plain strings,
// text-to-speech off, and in-memory storage that records every write.
import assert from "node:assert/strict";
import { InterviewSession, greetingText } from "../../libs/interview/session-engine";
import { analyzeAnswer } from "../../libs/interview/answer-analyzer";
import { fallbackScore, scoreAnswer } from "../../libs/interview/answer-scorer";
import { createFakeClock, settle } from "../hiring/helpers/fake-clock";

const QUESTIONS = [
  { id: "q1", question: "Explain how you would design a REST API for a library.", category: "technical", idealAnswer: "Resources, HTTP verbs, status codes, pagination.", expectedKeywords: ["resources", "verbs"], scoreWeight: 1 },
  { id: "q2", question: "Describe a deployment pipeline you built.", category: "technical", idealAnswer: "CI, tests, staging, rollbacks.", expectedKeywords: ["ci"], scoreWeight: 2 },
  { id: "q3", question: "Why do you want this role?", category: "behavioral", idealAnswer: null, expectedKeywords: [], scoreWeight: 1 },
];
const ANSWER = "I would model books and members as resources, use HTTP verbs for actions, return proper status codes and paginate large lists because clients need predictable behaviour";
const bank = (n) => Array.from({ length: n }, (_, i) => ({
  id: `b${i + 1}`, question: `Bank question number ${i + 1}?`, idealAnswer: null, expectedKeywords: [], scoreWeight: i % 8 === 0 ? 1 : 2,
  category: ["role", "technical", "technical", "technical", "technical", "role", "behavioral", "behavioral"][i % 8],
}));

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

/** One interview session with fake edges. `calls` records every write the engine would make to the database. */
function makeSession({ questions = QUESTIONS, maxMinutes = 25, analyze, score, state = null, pausedAt = null, clock = createFakeClock() } = {}) {
  const sent = [];
  const published = [];
  const calls = { appendTurn: [], createResponse: [], updateResponseScore: [], complete: [], abandon: [], enqueue: [], integrity: [] };
  let responseSeq = 0;
  const deps = {
    analyze: analyze || (async () => ({ shouldFollowUp: false, reasons: [], reasonForFollowUp: null })),
    followUp: async () => ({ question: "Can you give a concrete example?", fallback: false }),
    score: score || (async () => ({ score: 82, reasoning: "Solid", keywordsCovered: ["resources"], keywordsMissed: [], fallback: false })),
    tts: async () => null,
    repo: {
      markStarted: async () => {},
      appendTurn: async (id, turn) => { calls.appendTurn.push(turn); },
      createResponse: async (id, r) => { calls.createResponse.push(r); responseSeq += 1; return `r${responseSeq}`; },
      updateResponseScore: async (id, result) => { calls.updateResponseScore.push({ id, result }); },
      saveState: async () => {},
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
  const ackSpeech = async () => { session.onAiDoneSpeaking(lastSpeaking().turnId); await settle(); };
  return { session, clock, sent, published, calls, ofType, lastSpeaking, ackSpeech };
}

// Greeting heard, candidate says "yes ready", question 1 heard: now listening
async function toFirstQuestion(t) {
  await t.session.start({ resume: false });
  await t.ackSpeech();
  t.session.onSttFinal("yes ready", {});
  await settle();
  await t.ackSpeech();
}

async function answerAndContinue(t, text = ANSWER) {
  t.session.onSttFinal(text, {});
  t.session.onAnswerDone();
  await settle();
  await t.ackSpeech(); // the candidate's browser reports that it finished playing the interviewer's reply
}

const lastQuestion = (t) => t.ofType("question").at(-1);

export default {
  id: 4,
  title: "The AI interview conversation",
  tier: "offline",
  intro: "The interviewer greets, asks, listens, probes, keeps time and hands over a clean record. Time is simulated.",
  cases: [
    {
      id: "S4-01",
      title: "The interviewer introduces itself and waits for \"ready\" before question 1",
      requirement: "Greeting names the Raasta AI Interviewer, the question count, the time and the English rule (09 §3).",
      input: "start a 3-question, 25-minute interview; candidate first says \"hello there\", then \"yes ready\"",
      expect: "greeting says 3 questions / 25 minutes / English / Raasta AI Interviewer; no question until \"ready\"; then question 1 with an empty answer buffer",
      run: async () => {
        const t = makeSession();
        await t.session.start({ resume: false });
        const greeting = t.lastSpeaking();
        assert.equal(greeting.kind, "greeting");
        assert.equal(greeting.text, greetingText({ firstName: "Ayesha", jobTitle: "DevOps Engineer", total: 3, minutes: 25 }));
        for (const part of ["3 questions in up to 25 minutes", "conducted in English", "Raasta AI Interviewer"]) assert.match(greeting.text, new RegExp(part));
        await t.ackSpeech();
        t.session.onSttFinal("hello there", {});
        await settle();
        assert.equal(t.ofType("question").length, 0, "\"hello there\" must not start the interview");
        t.session.onSttFinal("yes ready", {});
        await settle();
        assert.equal(t.ofType("question").length, 1);
        assert.equal(lastQuestion(t).text, QUESTIONS[0].question);
        assert.equal(t.session.state.currentAnswerBuffer, "");
        return `greeting ok · "hello there" ignored · "yes ready" → question 1 of ${lastQuestion(t).total}`;
      },
    },
    {
      id: "S4-02",
      title: "Eight seconds of silence ends an answer: it is saved and the next question is asked",
      requirement: "Silence detection with a restartable window (09 §4).",
      input: "answer, then 7 s of silence, then 1.1 s more",
      expect: "nothing saved at 7 s; at 8.1 s the answer is saved for q1 and question 2 is asked",
      run: async () => {
        const t = makeSession();
        await toFirstQuestion(t);
        t.session.onSttFinal(ANSWER, { startMs: 0, endMs: 9000 });
        await t.clock.advance(7000);
        assert.equal(t.calls.createResponse.length, 0);
        await t.clock.advance(1100);
        assert.equal(t.calls.createResponse.length, 1);
        assert.equal(t.calls.createResponse[0].questionId, "q1");
        assert.equal(lastQuestion(t).text, QUESTIONS[1].question);
        return `after 7 s: 0 saved · after 8.1 s: 1 saved (q1) → next question "${lastQuestion(t).text}"`;
      },
    },
    {
      id: "S4-03",
      title: "The \"I've finished my answer\" button skips the wait",
      requirement: "The candidate can end an answer immediately (10 §3).",
      input: "answer then answer_done, no waiting",
      expect: "answer saved and question 2 asked at once",
      run: async () => {
        const t = makeSession();
        await toFirstQuestion(t);
        t.session.onSttFinal(ANSWER, {});
        t.session.onAnswerDone();
        await settle();
        assert.equal(t.calls.createResponse.length, 1);
        assert.equal(lastQuestion(t).text, QUESTIONS[1].question);
        return "saved 1 answer, asked question 2, no clock time passed";
      },
    },
    {
      id: "S4-04",
      title: "Noise and double triggers during thinking never produce two questions",
      requirement: "Concurrency guard: exactly one question per turn.",
      input: "while the AI is analysing: \"um\", \"ok\", a second answer_done, then the 8 s timer fires",
      expect: "question 1 + exactly one more; one answer saved",
      run: async () => {
        const gate = deferred();
        const t = makeSession({ analyze: async () => { await gate.promise; return { shouldFollowUp: false, reasons: [] }; } });
        await toFirstQuestion(t);
        t.session.onSttFinal(ANSWER, {});
        t.session.onAnswerDone();
        await settle();
        t.session.onSttFinal("um", {});
        t.session.onSttFinal("ok", {});
        t.session.onAnswerDone();
        await t.clock.advance(9000);
        gate.resolve();
        await settle();
        await t.clock.advance(20000);
        assert.equal(t.ofType("question").length, 2);
        assert.equal(t.calls.createResponse.length, 1);
        return `${t.ofType("question").length} questions spoken in total, ${t.calls.createResponse.length} answer saved`;
      },
    },
    {
      id: "S4-05",
      title: "The AI never talks over a candidate who keeps going",
      requirement: "Pre-speak guard: if the candidate speaks again while the AI is deciding, nothing is said or saved yet.",
      input: "answer + finished, then the candidate adds more words while the AI is still analysing",
      expect: "no follow-up spoken, follow-up depth rolled back, nothing saved; after the next silence the full answer is saved once",
      run: async () => {
        const gate = deferred();
        let analyses = 0;
        const t = makeSession({
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
        assert.equal(t.ofType("question").length, 1, "nothing was spoken over the candidate");
        assert.equal(t.session.state.followUpDepth, 0);
        assert.equal(t.calls.createResponse.length, 0);
        await t.clock.advance(8100);
        assert.equal(t.calls.createResponse.length, 1);
        assert.equal(t.calls.createResponse[0].answer, "I would use resources and also HTTP verbs with proper status codes");
        return "nothing spoken over the candidate; the two parts were merged into one saved answer";
      },
    },
    {
      id: "S4-06",
      title: "Follow-ups are capped at two per question",
      requirement: "maxFollowUps = 2 even if the analyzer always wants more (09 §5).",
      input: "an analyzer that always asks for a follow-up; four answers in a row",
      expect: "question kinds: follow_up, follow_up, then the next base question; saved as q1 base, q1 depth 1, q1 depth 2",
      run: async () => {
        const t = makeSession({ analyze: async () => ({ shouldFollowUp: true, reasons: [{ condition: "multi_step_required" }], reasonForFollowUp: { condition: "multi_step_required", message: "m" } }) });
        await toFirstQuestion(t);
        const kinds = [];
        for (let i = 0; i < 3; i += 1) {
          t.session.onSttFinal(`${ANSWER} ${i}`, {});
          t.session.onAnswerDone();
          await settle();
          kinds.push(lastQuestion(t).kind);
          await t.ackSpeech();
        }
        assert.deepEqual(kinds, ["follow_up", "follow_up", "question"]);
        assert.deepEqual(t.calls.createResponse.map((r) => [r.questionId, r.isFollowUp, r.followUpDepth]), [["q1", false, 0], ["q1", true, 1], ["q1", true, 2]]);
        return `kinds: ${kinds.join(", ")} · saved: ${t.calls.createResponse.map((r) => `${r.questionId}/depth${r.followUpDepth}`).join(", ")}`;
      },
    },
    {
      id: "S4-07",
      title: "A one-line weak answer earns a follow-up and a low score; a full answer does not",
      requirement: "Real answer analyzer (7 conditions) and the keyword-based fallback score, with the AI unavailable.",
      input: "weak: \"I don't know, maybe Docker.\" · strong: the 40-word q1-strong.wav transcript (Docker, Kubernetes, Helm, Terraform, AWS)",
      expect: "weak → follow-up (first reason answer_incomplete), score 17 · strong → no follow-up, score 88 (hand-calculated)",
      run: async () => {
        const question = {
          question: "How would you set up a CI/CD pipeline for a containerised service?", category: "technical",
          idealAnswer: "Build, test, push, deploy, roll back.", expectedKeywords: ["docker", "kubernetes", "helm", "terraform", "aws", "rollback"],
        };
        const weak = "I don't know, maybe Docker.";
        const strong = "I would build the Docker image on every pull request, run the unit tests, push it to a registry, and deploy to Kubernetes with Helm. Terraform manages the AWS infrastructure, and a failed health check rolls the release back automatically.";
        const offline = { llm: async () => { throw new Error("offline"); } };
        const weakAnalysis = await analyzeAnswer(weak, question, {}, offline);
        const strongAnalysis = await analyzeAnswer(strong, question, {}, offline);
        assert.equal(weakAnalysis.shouldFollowUp, true);
        assert.equal(weakAnalysis.reasonForFollowUp.condition, "answer_incomplete");
        assert.equal(strongAnalysis.shouldFollowUp, false);
        // By hand: weak = 0.7 × (1/6 keywords = 16.7) + 0.3 × (5/30 words = 16.7) = 16.7 → 17
        //          strong = 0.7 × (5/6 = 83.3) + 0.3 × 100 (40 words ≥ 30) = 88.3 → 88
        const weakScore = (await scoreAnswer(weak, question, offline)).score;
        const strongScore = (await scoreAnswer(strong, question, offline)).score;
        assert.equal(weakScore, 17);
        assert.equal(strongScore, 88);
        assert.equal(fallbackScore(strong, question).fallback, true);
        return `weak: follow-up (${weakAnalysis.reasonForFollowUp.condition}), score ${weakScore} · strong: no follow-up, score ${strongScore}`;
      },
    },
    {
      id: "S4-08",
      title: "\"I don't want to answer that\" gets no follow-up and a zero, and the interview moves on",
      requirement: "A refusal is respected and recorded, never pushed (09 §5).",
      input: "\"No, I don't want to answer that.\" with an analyzer that wants a follow-up",
      expect: "next base question asked, the scorer is not called, stored score 0 with reason \"The candidate declined to answer.\"",
      run: async () => {
        let scorerCalls = 0;
        const t = makeSession({
          analyze: async () => ({ shouldFollowUp: true, reasons: [{ condition: "answer_incomplete" }], reasonForFollowUp: { condition: "answer_incomplete", message: "short" } }),
          score: async () => { scorerCalls += 1; return { score: 80, reasoning: "x", keywordsCovered: [], keywordsMissed: [] }; },
        });
        await toFirstQuestion(t);
        t.session.onSttFinal("No, I don't want to answer that.", {});
        t.session.onAnswerDone();
        await settle();
        assert.equal(lastQuestion(t).kind, "question");
        assert.equal(lastQuestion(t).text, QUESTIONS[1].question);
        assert.equal(scorerCalls, 0);
        assert.equal(t.calls.updateResponseScore[0].result.score, 0);
        assert.equal(t.calls.updateResponseScore[0].result.reasoning, "The candidate declined to answer.");
        return `moved on to "${lastQuestion(t).text.slice(0, 30)}…", stored score ${t.calls.updateResponseScore[0].result.score}, scorer calls ${scorerCalls}`;
      },
    },
    {
      id: "S4-09",
      title: "The question echoing back through the speakers is not counted as the answer",
      requirement: "Echo guard: the AI's own voice picked up by the microphone is removed (09 §6).",
      input: "microphone hears the question text, then question text + the real answer",
      expect: "saved answer equals only the real answer; captions shown never contain the question",
      run: async () => {
        const t = makeSession();
        await toFirstQuestion(t);
        const question = QUESTIONS[0].question;
        t.session.onSttFinal(question, {});
        t.session.onSttFinal(`${question} ${ANSWER}`, {});
        t.session.onAnswerDone();
        await settle();
        assert.equal(t.calls.createResponse[0].answer, ANSWER);
        assert.ok(t.ofType("caption_final").every((c) => !c.text.includes("design a REST API")));
        return `saved answer = the candidate's ${ANSWER.split(" ").length} words only`;
      },
    },
    {
      id: "S4-10",
      title: "Speaking Urdu mid-question: English-only notice, answer dropped, question repeated, recruiter told",
      requirement: "The interview is conducted in English only (09 §7, libs/interview/language.js).",
      input: "candidate says half an answer, then Urdu speech is detected",
      expect: "interviewer says it noticed Urdu and repeats the question; half answer discarded; an integrity event is recorded for the recruiter",
      run: async () => {
        const t = makeSession();
        await toFirstQuestion(t);
        const asked = lastQuestion(t).text;
        t.session.onSttFinal("well I think", {});
        await t.session.onNonEnglishSpeech({ language: "urdu" });
        const spoken = t.lastSpeaking();
        assert.match(spoken.text, /^Ayesha, I noticed you spoke in Urdu\. This interview is conducted in English only/);
        assert.ok(spoken.text.endsWith(`Let me ask the question again. ${asked}`));
        assert.equal(t.session.state.currentAnswerBuffer, "");
        assert.equal(t.calls.createResponse.length, 0);
        assert.deepEqual(t.calls.integrity.map((e) => e.type), ["non_english_speech"]);
        return "notice spoken + question repeated; nothing saved; integrity event non_english_speech";
      },
    },
    {
      id: "S4-11",
      title: "The interview length decides the question count: 10 minutes asks 3 of 8, 45 minutes asks all 8",
      requirement: "A short interview is planned around its time, not cut off halfway (09 §8, time-plan).",
      input: "an 8-question bank at 10 minutes and at 45 minutes; the 10-minute run answered to the end",
      expect: "10 min: greeting says 3 questions, 3 answers end the interview \"3 of 3\" · 45 min: 8 questions",
      run: async () => {
        const short = makeSession({ questions: bank(8), maxMinutes: 10 });
        assert.equal(short.session.state.totalQuestions, 3);
        await short.session.start({ resume: false });
        assert.match(short.lastSpeaking().text, /3 questions in up to 10 minutes/);
        await short.ackSpeech();
        short.session.onSttFinal("yes ready", {});
        await settle();
        await short.ackSpeech();
        for (let i = 0; i < 3; i += 1) await answerAndContinue(short, `${ANSWER} number ${i}`);
        assert.equal(short.session.state.stage, "ended");
        assert.equal(short.calls.complete[0].totalQuestions, 3);
        const long = makeSession({ questions: bank(8), maxMinutes: 45 });
        assert.equal(long.session.state.totalQuestions, 8);
        return "10 min → 3 questions asked and completed as 3/3 · 45 min → 8 planned";
      },
    },
    {
      id: "S4-12",
      title: "\"Please end the interview\" by voice: polite goodbye, partial interview kept",
      requirement: "A candidate can stop at any time; what was answered is kept for the recruiter (09 §9).",
      input: "one answer given, then \"Actually I want to end the interview, so kindly end it right now.\"",
      expect: "closing line spoken, request not counted as an answer, reason ended_by_candidate, interview kept and queued for analysis",
      run: async () => {
        const t = makeSession();
        await toFirstQuestion(t);
        await answerAndContinue(t);
        t.session.onSttFinal("Actually I want to end the interview, so kindly end it right now.", {});
        t.session.onAnswerDone();
        await settle();
        assert.equal(t.lastSpeaking().kind, "closing");
        assert.match(t.lastSpeaking().text, /^Understood, Ayesha\. I'll end the interview here\./);
        assert.equal(t.calls.createResponse.length, 1);
        await t.ackSpeech();
        assert.deepEqual(t.ofType("interview_complete"), [{ type: "interview_complete", reason: "ended_by_candidate" }]);
        assert.equal(t.calls.complete.length, 1);
        assert.deepEqual(t.calls.enqueue.map((e) => e.type), ["analyse-interview"]);
        return "goodbye spoken · 1 answer kept · reason ended_by_candidate · analysis queued";
      },
    },
    {
      id: "S4-13",
      title: "A long answer that merely mentions \"ending the session\" is still an answer",
      requirement: "The end-request detector must not fire on technical talk.",
      input: `${ANSWER} and when the user logs out we end the session`,
      expect: "saved as an answer; question 2 asked",
      run: async () => {
        const t = makeSession();
        await toFirstQuestion(t);
        t.session.onSttFinal(`${ANSWER} and when the user logs out we end the session`, {});
        t.session.onAnswerDone();
        await settle();
        assert.equal(t.calls.createResponse.length, 1);
        assert.equal(lastQuestion(t).text, QUESTIONS[1].question);
        return "kept as an answer; interview continued";
      },
    },
    {
      id: "S4-14",
      title: "Time runs out mid-answer: 60 s grace, the answer is saved, the interview closes",
      requirement: "The time limit is firm but never throws away what the candidate was saying (09 §8).",
      input: "5-minute interview; the candidate keeps talking past the limit",
      expect: "one warning at 1 minute left; answer saved; closing spoken; reason time_up",
      run: async () => {
        const t = makeSession({ maxMinutes: 5 });
        await toFirstQuestion(t);
        await t.clock.advance(4 * 60 * 1000 + 59 * 1000);
        assert.deepEqual(t.ofType("time_warning").map((w) => w.minutesLeft), [1]);
        for (let i = 0; i < 25; i += 1) {
          t.session.onSttFinal(`still explaining part ${i}`, {});
          await t.clock.advance(3000);
        }
        assert.equal(t.calls.createResponse.length, 1);
        assert.equal(t.lastSpeaking().kind, "closing");
        await t.ackSpeech();
        assert.equal(t.ofType("interview_complete").at(-1).reason, "time_up");
        return `warning at ${t.ofType("time_warning")[0].minutesLeft} min left · answer saved · closed with reason time_up`;
      },
    },
    {
      id: "S4-15",
      title: "After a dropped connection the candidate resumes where they were, without losing time",
      requirement: "Resume window: the current question is asked again; time spent offline is not counted (09 §10).",
      input: "one answer given, 3 minutes offline in the middle of question 2, then reconnect",
      expect: "\"Welcome back, let's continue.\" + question 2; elapsed time unchanged by the 3 offline minutes",
      run: async () => {
        const t = makeSession();
        await toFirstQuestion(t);
        await answerAndContinue(t);
        t.session.onSttFinal("half an answer that is lost", {});
        t.session.pause();
        const saved = t.session.serializeState();
        await t.clock.advance(3 * 60 * 1000);
        const r = makeSession({ state: saved, pausedAt: saved.pausedAt, clock: t.clock });
        const before = r.session.elapsedMs();
        await r.session.start({ resume: true });
        assert.equal(r.lastSpeaking().text, `Welcome back, let's continue. ${QUESTIONS[1].question}`);
        assert.ok(r.session.elapsedMs() - before < 1000);
        await r.ackSpeech();
        await answerAndContinue(r);
        assert.equal(r.calls.createResponse[0].questionId, "q2");
        return `"${r.lastSpeaking().text.slice(0, 40)}…" · elapsed drift ${r.session.elapsedMs() - before} ms · next answer saved against q2`;
      },
    },
    {
      id: "S4-16",
      title: "The candidate's screen never receives scores, reasons or the ideal answers",
      requirement: "Everything sent to the browser is inspected for leaks (09 §11, hard rule).",
      input: "a whole interview with follow-ups; every message sent to the candidate is searched",
      expect: "none of: score, reasoning, idealAnswer, skill_avoided, keywords, or the ideal-answer text; scores go to the recruiter channel only",
      run: async () => {
        const t = makeSession({ analyze: async () => ({ shouldFollowUp: true, reasons: [{ condition: "skill_avoided" }], reasonForFollowUp: { condition: "skill_avoided", message: "Expected keywords/skills not adequately covered" } }) });
        await toFirstQuestion(t);
        for (let i = 0; i < 6; i += 1) {
          t.session.onSttFinal(`${ANSWER} ${i}`, {});
          t.session.onAnswerDone();
          await settle();
          if (t.session.ended) break;
          await t.ackSpeech();
        }
        const wire = JSON.stringify(t.sent);
        const forbidden = ["score", "reasoning", "idealAnswer", "skill_avoided", "keywords", "Resources, HTTP verbs, status codes", "CI, tests, staging"];
        for (const word of forbidden) assert.ok(!wire.includes(word), `candidate payloads must not contain "${word}"`);
        assert.ok(t.published.some((e) => e.type === "answer_scored"));
        return `${t.sent.length} messages to the candidate searched for ${forbidden.length} forbidden terms: 0 found · ${t.published.filter((e) => e.type === "answer_scored").length} scores went to the recruiter channel`;
      },
    },
    {
      id: "S4-17",
      title: "Finishing hands over cleanly: closing line, one completion, one analysis job",
      requirement: "interview_complete once, repo.complete once, analyse-interview queued once, turn numbers unique (09 §3).",
      input: "answer all 3 questions",
      expect: "closing \"Thank you, Ayesha. That concludes your interview for DevOps Engineer.\"; reason finished; 1 completion; 1 analyse-interview job",
      run: async () => {
        const t = makeSession();
        await toFirstQuestion(t);
        for (let i = 0; i < 3; i += 1) await answerAndContinue(t, `${ANSWER} number ${i}`);
        assert.equal(t.session.state.stage, "ended");
        assert.match(t.calls.appendTurn.find((turn) => turn.kind === "closing").text, /^Thank you, Ayesha\. That concludes your interview for DevOps Engineer\./);
        assert.deepEqual(t.ofType("interview_complete"), [{ type: "interview_complete", reason: "finished" }]);
        assert.equal(t.calls.complete.length, 1);
        assert.deepEqual(t.calls.enqueue, [{ type: "analyse-interview", payload: { interviewId: "iv1" } }]);
        const seqs = t.calls.appendTurn.map((turn) => turn.seq);
        assert.equal(new Set(seqs).size, seqs.length);
        return `${t.calls.createResponse.length} answers · ${seqs.length} transcript turns with unique numbers · 1 completion · 1 analysis job`;
      },
    },
    {
      id: "S4-18",
      title: "Browser integrity events are recorded; made-up event names are ignored",
      requirement: "Tab switches etc. are informational flags for the recruiter, never accepted blindly.",
      input: "tab_hidden (valid) and \"rm -rf\" (invalid)",
      expect: "only tab_hidden is stored, and it is relayed to the recruiter",
      run: async () => {
        const t = makeSession();
        await toFirstQuestion(t);
        t.session.onClientEvent({ event: "tab_hidden", at: "2026-01-01T10:01:00Z" });
        t.session.onClientEvent({ event: "rm -rf", at: "x" });
        await settle();
        assert.deepEqual(t.calls.integrity, [{ type: "tab_hidden", at: "2026-01-01T10:01:00.000Z" }]);
        assert.ok(t.published.some((e) => e.type === "integrity" && e.event === "tab_hidden"));
        return "stored: tab_hidden · ignored: \"rm -rf\"";
      },
    },
  ],
};
