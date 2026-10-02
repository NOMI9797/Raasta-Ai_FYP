// Answer analyzer, scorer, follow-ups, mappers, TTS client and STT adapters (docs/ai-hiring/17-testing.md §2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeAnswer, calculateCompletenessScore, checkAnswerCompleteness, countWords } from "../../libs/interview/answer-analyzer";
import { fallbackScore, scoreAnswer } from "../../libs/interview/answer-scorer";
import { FALLBACK_FOLLOW_UPS, generateFollowUp } from "../../libs/interview/follow-up";
import { buildFollowUpPrompt } from "../../libs/ai/prompts/interview";
import { toCandidateContext, toRoleContext, toSessionQuestions } from "../../libs/interview/mappers";
import { synthesize, clearTtsCache } from "../../libs/interview/tts-client";
import { createWhisperStt, pcmToWav } from "../../libs/interview/stt/whisper-chunked";
import { createDeepgramStt, handleDeepgramMessage, DEEPGRAM_OPTIONS } from "../../libs/interview/stt/deepgram";
import { EventEmitter } from "events";

const noLlm = async () => ({ opensNewTopic: false, hasContradictions: false, showsDeepExperience: false });
const failingLlm = async () => { throw new Error("upstream down"); };
const TECH_Q = { question: "What is a REST API?", category: "technical", expectedKeywords: ["http", "resources"] };
const GOOD = "A REST API exposes resources over HTTP, for example books and members, because clients can then use standard verbs, and the specific status codes explain exactly what happened to every request they make";

// ─── analyzer: the seven conditions ───
test("analyzer 1: short answers are incomplete", async () => {
  const a = await analyzeAnswer("HTTP resources mostly.", TECH_Q, {}, { llm: noLlm });
  assert.equal(a.isComplete, false);
  assert.equal(a.reasonForFollowUp.condition, "answer_incomplete");
  assert.match(a.reasonForFollowUp.message, /too short \(3 words\)/);
});

test("analyzer 1b: how/why structure and completeness score", () => {
  const how = { question: "How do you deploy?" };
  const noHow = "I deploy to production every week with the team and it usually works well for everyone";
  assert.equal(checkAnswerCompleteness(noHow, countWords(noHow), how), false);
  assert.equal(calculateCompletenessScore("word ".repeat(30)), 100);
  assert.equal(Math.round(calculateCompletenessScore("one two three because example")), 37); // 5/30 + 10 + 10
});

test("analyzer 2: new topic (LLM) and its keyword fallback", async () => {
  const llm = async () => ({ opensNewTopic: true, hasContradictions: false, showsDeepExperience: false });
  const a = await analyzeAnswer(GOOD, TECH_Q, {}, { llm });
  assert.deepEqual(a.reasons.map((r) => r.condition), ["new_topic_opened"]);
  const b = await analyzeAnswer(`${GOOD} using an internal framework`, TECH_Q, {}, { llm: failingLlm });
  assert.equal(b.opensNewTopic, true);
  assert.equal(b.llmUsed, false);
});

test("analyzer 3: skill avoided when < 50% of keywords are mentioned", async () => {
  const q = { question: "Tell us about containers", expectedKeywords: ["docker", "kubernetes", "helm", "registry"] };
  const a = await analyzeAnswer(`${GOOD} with docker`, q, {}, { llm: noLlm });
  assert.ok(a.reasons.some((r) => r.condition === "skill_avoided"));
  const b = await analyzeAnswer(`${GOOD} with docker and kubernetes`, q, {}, { llm: noLlm });
  assert.ok(!b.reasons.some((r) => r.condition === "skill_avoided"));
});

test("analyzer 4: contradiction (LLM only; false when the LLM fails); candidate skills reach the prompt", async () => {
  let prompt = null;
  const llm = async ({ user }) => { prompt = user; return { opensNewTopic: false, hasContradictions: true, showsDeepExperience: false }; };
  const a = await analyzeAnswer(GOOD, TECH_Q, { candidateSkills: ["golang"] }, { llm });
  assert.deepEqual(a.reasons.map((r) => r.condition), ["contradiction"]);
  assert.match(prompt, /golang/);
  const b = await analyzeAnswer(GOOD, TECH_Q, {}, { llm: failingLlm });
  assert.equal(b.hasContradictions, false);
});

test("analyzer 5: deep experience and its ≥ 2 indicator fallback", async () => {
  const deep = `${GOOD}, focusing on scalability and performance`;
  const a = await analyzeAnswer(deep, TECH_Q, {}, { llm: failingLlm });
  assert.equal(a.showsDeepExperience, true);
  assert.ok(a.reasons.some((r) => r.condition === "deep_experience"));
});

test("analyzer 6: natural cues", async () => {
  const a = await analyzeAnswer(`${GOOD}. I can explain more if useful`, TECH_Q, {}, { llm: noLlm });
  assert.deepEqual(a.reasons.map((r) => r.condition), ["natural_cues"]);
});

test("analyzer 7: behavioral / STAR questions need multiple steps; a complete technical answer needs nothing", async () => {
  const a = await analyzeAnswer(GOOD, { question: "Tell me about a time you failed", category: "behavioral" }, {}, { llm: noLlm });
  assert.deepEqual(a.reasons.map((r) => r.condition), ["multi_step_required"]);
  const b = await analyzeAnswer(GOOD, TECH_Q, {}, { llm: noLlm });
  assert.equal(b.shouldFollowUp, false);
  assert.equal(b.reasonForFollowUp, null);
});

test("analyzer: primary reason follows the documented order", async () => {
  const llm = async () => ({ opensNewTopic: true, hasContradictions: true, showsDeepExperience: true });
  const a = await analyzeAnswer("Short.", { question: "Walk me through it", expectedKeywords: ["x"] }, {}, { llm });
  assert.deepEqual(a.reasons.map((r) => r.condition), ["answer_incomplete", "new_topic_opened", "skill_avoided", "contradiction", "deep_experience", "multi_step_required"]);
});

// ─── scorer ───
test("scorer: JSON result is clamped and cleaned", async () => {
  const llm = async () => ({ score: 140.4, reasoning: "Great", keywordsCovered: ["http", 3], keywordsMissed: "none" });
  const r = await scoreAnswer(GOOD, { ...TECH_Q, idealAnswer: "Resources over HTTP" }, { llm });
  assert.deepEqual(r, { score: 100, reasoning: "Great", keywordsCovered: ["http"], keywordsMissed: [], fallback: false });
});

test("scorer: keyword fallback on LLM failure is kept and flagged", async () => {
  const q = { ...TECH_Q, idealAnswer: "Resources over HTTP" };
  const r = await scoreAnswer("Resources are things", q, { llm: failingLlm });
  // 1/2 keywords → 50 × 0.7 = 35; 3 words → 10 × 0.3 = 3
  assert.equal(r.score, 38);
  assert.equal(r.fallback, true);
  assert.deepEqual(r.keywordsCovered, ["resources"]);
  assert.deepEqual(r.keywordsMissed, ["http"]);
  assert.equal(fallbackScore("anything", { expectedKeywords: [] }).score, 36); // no keywords → 50% assumed
});

test("scorer: nothing to score without an ideal answer; empty answers score 0", async () => {
  assert.equal(await scoreAnswer(GOOD, TECH_Q, { llm: failingLlm }), null);
  const r = await scoreAnswer("  ", { ...TECH_Q, idealAnswer: "x" }, { llm: failingLlm });
  assert.equal(r.score, 0);
});

// ─── follow-up ───
test("follow-up: LLM text is cleaned; the fallback table is used on failure", async () => {
  const ok = await generateFollowUp({ question: TECH_Q, answer: GOOD, reason: { condition: "skill_avoided" } }, { llm: async () => 'Follow-up: "How did you version it?"' });
  assert.deepEqual(ok, { question: "How did you version it?", fallback: false });
  const fb = await generateFollowUp({ question: TECH_Q, answer: GOOD, reason: { condition: "skill_avoided" } }, { llm: failingLlm });
  assert.deepEqual(fb, { question: FALLBACK_FOLLOW_UPS.skill_avoided, fallback: true });
  const generic = await generateFollowUp({ question: TECH_Q, answer: GOOD }, { llm: async () => "" });
  assert.equal(generic.question, "Can you elaborate on that?");
});

test("follow-up prompt lists the detected issues and drills deeper after the first follow-up", () => {
  const prompt = buildFollowUpPrompt({
    question: TECH_Q, answer: GOOD, depth: 1,
    analysis: { wordCount: 30, completenessScore: 80, reasons: [{ condition: "skill_avoided" }, { condition: "natural_cues" }] },
    reason: { condition: "skill_avoided", message: "keywords missing" },
    history: [{ role: "interviewer", content: "Q" }, { role: "candidate", content: "A" }],
    candidate: { candidateName: "Ayesha Khan", skills: ["docker"] }, role: { title: "DevOps Engineer", description: "pipelines" },
  });
  assert.match(prompt, /Issues Detected: skill_avoided, natural_cues/);
  assert.match(prompt, /follow-up #2 - be more specific and drill deeper/);
  assert.match(prompt, /Role: DevOps Engineer/);
});

// ─── mappers ───
test("mappers: candidate, role and session questions", () => {
  const c = toCandidateContext({ name: "Ayesha Khan", parsedData: { skills: ["go"], experience: [{ title: "SRE", company: "Acme", period: "2021-2024" }], education: [], yearsExperience: 3 } });
  assert.equal(c.firstName, "Ayesha");
  assert.deepEqual(c.experience, ["SRE at Acme (2021-2024)"]);
  assert.equal(toCandidateContext({ name: "" }).firstName, "there");
  const r = toRoleContext({ id: "j", title: "SRE", requiredSkills: ["go"], techStack: ["k8s"] });
  assert.deepEqual(r.skills, ["go", "k8s"]);
  assert.equal(r.description, "SRE");
  const qs = toSessionQuestions([{ id: "b", question: "B", orderIndex: 2 }, { id: "a", question: "A", orderIndex: 1 }, { id: "x", question: "X", isActive: false }]);
  assert.deepEqual(qs.map((q) => [q.id, q.scoreWeight]), [["a", 1], ["b", 1]]);
});

// ─── TTS client ───
test("tts: returns audio bytes and duration; null on failure; caches when asked", async () => {
  clearTtsCache();
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls += 1;
    assert.match(url, /\/tts$/);
    assert.match(init.headers.Authorization, /^Bearer /);
    return new Response(Buffer.from("RIFFxxxx"), { status: 200, headers: { "X-Audio-Duration-Ms": "1234" } });
  };
  const a = await synthesize("Hello", { cache: true, fetchImpl });
  assert.equal(a.durationMs, 1234);
  assert.equal(a.mime, "audio/wav");
  assert.equal(a.audio.toString(), "RIFFxxxx");
  await synthesize("Hello", { cache: true, fetchImpl });
  assert.equal(calls, 1);
  assert.equal(await synthesize("Hi", { fetchImpl: async () => new Response("no", { status: 503 }) }), null);
  assert.equal(await synthesize("Hi", { fetchImpl: async () => { throw new Error("down"); } }), null);
});

// ─── STT: Whisper chunked ───
function tone(ms, amp = 0.3, sampleRate = 16000) {
  const n = Math.round((sampleRate * ms) / 1000);
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i += 1) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * amp * 32767), i * 2);
  return buf;
}
function frames(buf, frameMs = 20) {
  const size = 16000 * 2 * (frameMs / 1000);
  const out = [];
  for (let i = 0; i < buf.length; i += size) out.push(buf.subarray(i, i + size));
  return out;
}

test("whisper STT: cuts utterances on 700 ms of silence and emits finals in order with timings", async () => {
  const finals = [];
  let n = 0;
  const wavs = [];
  const stt = createWhisperStt(
    { onFinal: (text, timing) => finals.push({ text, ...timing }) },
    { transcribe: async ({ wavBuffer }) => { wavs.push(wavBuffer); n += 1; await new Promise((r) => setTimeout(r, n === 1 ? 20 : 0)); return `utterance ${n}`; } }
  );
  const audio = Buffer.concat([tone(500, 0), tone(1000), tone(800, 0), tone(600), tone(800, 0)]);
  for (const f of frames(audio)) stt.write(f);
  await stt.drain();
  assert.deepEqual(finals.map((f) => f.text), ["utterance 1", "utterance 2"]);
  assert.ok(finals[0].startMs >= 150 && finals[0].startMs <= 500, `start ${finals[0].startMs}`);
  assert.ok(finals[1].startMs > finals[0].endMs - 800);
  assert.equal(wavs[0].subarray(0, 4).toString(), "RIFF");
  assert.equal(pcmToWav(Buffer.alloc(4)).length, 48);
});

test("whisper STT: reports speech activity while someone is talking (no partials)", async () => {
  let activity = 0;
  const stt = createWhisperStt({ onActivity: () => { activity += 1; } }, { transcribe: async () => "x" });
  for (const f of frames(Buffer.concat([tone(500, 0), tone(1000)]))) stt.write(f);
  assert.ok(activity >= 3 && activity <= 5, `activity ${activity}`); // every 250 ms of loud audio
  await stt.close();
});

test("whisper STT: flush() transcribes the words still buffered (answer_done)", async () => {
  const finals = [];
  const stt = createWhisperStt({ onFinal: (text) => finals.push(text) }, { transcribe: async () => "last words" });
  for (const f of frames(tone(600))) stt.write(f);
  assert.deepEqual(finals, []);
  await stt.flush();
  assert.deepEqual(finals, ["last words"]);
  await stt.close();
});

test("whisper STT: transcription errors go to onError and the stream keeps working", async () => {
  const errors = [];
  const finals = [];
  let n = 0;
  const stt = createWhisperStt({ onFinal: (t) => finals.push(t), onError: (e) => errors.push(e.message) }, { transcribe: async () => { n += 1; if (n === 1) throw new Error("429"); return "second"; } });
  for (const f of frames(Buffer.concat([tone(400), tone(800, 0), tone(400), tone(800, 0)]))) stt.write(f);
  await stt.drain();
  assert.deepEqual(errors, ["429"]);
  assert.deepEqual(finals, ["second"]);
});

// ─── STT: Deepgram ───
function fakeDeepgram() {
  const socket = new EventEmitter();
  socket.sent = [];
  socket.connect = () => {};
  socket.waitForOpen = async () => {};
  socket.sendMedia = (pcm) => socket.sent.push(["media", pcm.length]);
  socket.sendKeepAlive = (m) => socket.sent.push(["control", m.type]);
  socket.sendFinalize = (m) => {
    socket.sent.push(["control", m.type]);
    setImmediate(() => socket.emit("message", { type: "Results", is_final: true, start: 1, duration: 0.5, channel: { alternatives: [{ transcript: "finalised" }] } }));
  };
  socket.sendCloseStream = (m) => socket.sent.push(["control", m.type]);
  socket.close = () => socket.emit("close");
  let options = null;
  const client = { listen: { v1: { connect: async (opts) => { options = opts; return socket; } } } };
  return { socket, client, options: () => options };
}

test("deepgram STT: options, partial/final routing, queued audio, keep-alive, flush and close", async () => {
  const fake = fakeDeepgram();
  const partials = [];
  const finals = [];
  let closed = 0;
  const stt = createDeepgramStt({ onPartial: (t) => partials.push(t), onFinal: (t, timing) => finals.push({ t, ...timing }), onClose: () => { closed += 1; } }, { client: fake.client });
  stt.write(Buffer.alloc(640)); // before the socket opens → queued
  await stt.ready;
  assert.deepEqual(fake.options(), DEEPGRAM_OPTIONS);
  assert.equal(DEEPGRAM_OPTIONS.model, "nova-3");
  assert.deepEqual(fake.socket.sent[0], ["media", 640]);
  fake.socket.emit("message", { type: "Results", is_final: false, channel: { alternatives: [{ transcript: "hel" }] } });
  fake.socket.emit("message", { type: "Results", is_final: true, start: 2, duration: 1.5, channel: { alternatives: [{ transcript: "hello world" }] } });
  stt.keepAlive();
  await stt.flush();
  await stt.close();
  await stt.close();
  assert.deepEqual(partials, ["hel"]);
  assert.deepEqual(finals[0], { t: "hello world", startMs: 2000, endMs: 3500 });
  assert.equal(finals[1].t, "finalised");
  assert.deepEqual(fake.socket.sent.filter((s) => s[0] === "control").map((s) => s[1]), ["KeepAlive", "Finalize", "CloseStream"]);
  assert.equal(closed, 1);
});

test("deepgram STT: an unexpected close is reported so the caller can reconnect", async () => {
  const fake = fakeDeepgram();
  const infos = [];
  const stt = createDeepgramStt({ onClose: (info) => infos.push(info) }, { client: fake.client });
  await stt.ready;
  fake.socket.emit("close");
  assert.deepEqual(infos, [{ unexpected: true }]);
});

test("deepgram message parsing ignores empty transcripts and non-result events", () => {
  const out = [];
  handleDeepgramMessage({ type: "UtteranceEnd" }, { onFinal: (t) => out.push(t) });
  let activity = 0;
  handleDeepgramMessage({ type: "SpeechStarted" }, { onActivity: () => { activity += 1; } });
  handleDeepgramMessage({ type: "Results", is_final: false, channel: { alternatives: [{ transcript: "he" }] } }, { onActivity: () => { activity += 1; } });
  assert.equal(activity, 2);
  handleDeepgramMessage({ type: "Results", is_final: true, channel: { alternatives: [{ transcript: "  " }] } }, { onFinal: (t) => out.push(t) });
  assert.deepEqual(out, []);
});

// ─── interview score ───
test("interview score: follow-ups average into their base question, weighted by scoreWeight", async () => {
  const { computeInterviewScore } = await import("../../libs/interview/repository");
  const questions = [{ id: "a", scoreWeight: 1 }, { id: "b", scoreWeight: 3 }];
  const responses = [
    { questionId: "a", score: 90 }, { questionId: "a", score: 70, isFollowUp: true }, // a → 80
    { questionId: "b", score: 60 }, { questionId: "b", score: null },                // b → 60
  ];
  assert.equal(computeInterviewScore(responses, questions), 65); // (80×1 + 60×3) / 4
  assert.equal(computeInterviewScore([{ questionId: "a", score: null }], questions), null);
});
