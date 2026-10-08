// The interview is English only: noticing Urdu in a transcript or in the audio behind it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "events";
import {
  AudioTail,
  detectUrdu,
  isNonEnglishVerdict,
  isRegionalLanguage,
  languageNoticeText,
  noticeLanguage,
  worthIdentifying,
} from "../../libs/interview/language";
import { SessionManager } from "../../services/interview-engine/session-manager";
import { createFakeClock, settle } from "./helpers/fake-clock";

// ───────────────────────────── text rules ─────────────────────────────

test("Romanised Urdu is recognised, ordinary English is not", () => {
  for (const urdu of [
    "mera naam Ali hai aur main theek hoon",
    "haan ji, bilkul",
    "nahi, yeh sahi nahi hai",
    "mujhe kaam karna acha lagta hai",
  ]) {
    const r = detectUrdu(urdu);
    assert.equal(r.urdu, true, urdu);
    assert.equal(r.via, "roman");
  }
  for (const english of [
    "I would design a REST API with resources, verbs and pagination",
    "My main reason for applying is the team and the scope of the work",
    "So the pipeline runs the tests and then deploys to staging",
    "Yes I am ready",
    "He said me to do it",
  ]) {
    assert.equal(detectUrdu(english).urdu, false, english);
  }
});

test("a single Urdu word is only a suspicion; English with a few borrowed words is not flagged", () => {
  assert.deepEqual(
    [detectUrdu("the deployment is ok, yaar").urdu, detectUrdu("the deployment is ok, yaar").suspicious],
    [false, true],
  );
  assert.equal(detectUrdu("we shipped it, inshallah it works").urdu, false);
});

test("Urdu and Hindi script count as Urdu; Latin text with a stray symbol does not", () => {
  const script = detectUrdu("میرا نام علی ہے");
  assert.equal(script.urdu, true);
  assert.equal(script.via, "script");
  assert.equal(detectUrdu("मेरा नाम अली है").urdu, true);
  assert.equal(detectUrdu("I worked on the café app").urdu, false);
  assert.equal(detectUrdu("").urdu, false);
  assert.equal(detectUrdu("ok").urdu, false);
});

// ───────────────────────────── audio ─────────────────────────────

test("regional languages trigger the reminder, English and unrelated ones do not", () => {
  for (const name of ["urdu", "Urdu", "hindi", "ur", "punjabi", "arabic"]) assert.equal(isRegionalLanguage(name), true, name);
  for (const name of ["english", "en", "welsh", "nynorsk", "", undefined]) assert.equal(isRegionalLanguage(name), false, String(name));
  assert.equal(isNonEnglishVerdict({ language: "urdu", text: "" }), true);
  assert.equal(isNonEnglishVerdict({ language: "english", text: "I would use Docker" }), false);
  assert.equal(isNonEnglishVerdict({ language: "welsh", text: "میرا نام علی ہے" }), true, "the text itself can give it away");
});

test("only doubtful transcripts have their audio identified", () => {
  assert.equal(worthIdentifying({ text: "I would use Docker for that", confidence: 0.97 }), false);
  assert.equal(worthIdentifying({ text: "I would use Docker for that", confidence: 0.55 }), true);
  assert.equal(worthIdentifying({ text: "hmm", confidence: 0.3 }), false, "one word is too little to judge");
  assert.equal(worthIdentifying({ text: "I would use Docker for that", confidence: null }), false, "no confidence, nothing doubtful");
  assert.equal(worthIdentifying({ text: "that is ok yaar", confidence: 0.95 }), true, "a stray Urdu word is worth a listen");
});

test("the audio tail returns the stretch behind a transcript and forgets old audio", () => {
  const tail = new AudioTail({ sampleRate: 1000, keepMs: 4000 }); // 2 bytes per sample -> 2 bytes per ms
  const second = (value) => Buffer.alloc(2000, value);
  for (const v of [1, 2, 3, 4, 5, 6]) tail.write(second(v)); // 6 s; only the last ~4 s are kept
  assert.equal(tail.slice(0, 1000), null, "the first second is gone");
  const piece = tail.slice(4000, 5000, { padMs: 0 });
  assert.equal(piece.length, 2000);
  assert.equal(piece[0], 5);
  assert.equal(tail.slice(5500, 5600, { padMs: 0 }), null, "under 400 ms is not worth identifying");
});

test("notices name Urdu when it is Urdu, get firmer, and use the candidate's name", () => {
  assert.equal(noticeLanguage("hindi"), "urdu");
  assert.equal(noticeLanguage("arabic"), null);
  assert.match(languageNoticeText({ firstName: "Sara", count: 1, language: "urdu" }), /^Sara, I noticed you spoke in Urdu\. This interview is conducted in English only/);
  assert.match(languageNoticeText({ firstName: "there", count: 1 }), /^I noticed you spoke in a language other than English\./);
  assert.match(languageNoticeText({ firstName: "Sara", count: 2 }), /remind you again/);
  assert.match(languageNoticeText({ firstName: "Sara", count: 3 }), /^Sara, please answer in English/);
});

// ───────────────────────────── in the engine ─────────────────────────────

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1;
    this.sent = [];
  }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.emit("close"); }
  json(type) { return this.sent.filter((m) => m.type === type); }
  async client(message) { this.emit("message", Buffer.from(JSON.stringify(message)), false); await settle(); }
  // Audio frames are at most 64 KB: send it a second at a time (16 kHz, 16-bit mono = 32000 bytes per second)
  async audio(seconds) { for (let i = 0; i < seconds; i += 1) this.emit("message", Buffer.alloc(32000), true); await settle(); }
}

const QUESTIONS = [
  { id: "q1", question: "First question?", category: "technical", idealAnswer: null, expectedKeywords: [], scoreWeight: 1 },
  { id: "q2", question: "Second question?", category: "technical", idealAnswer: null, expectedKeywords: [], scoreWeight: 1 },
];

function setup({ detectLanguage, languageGuard } = {}) {
  const clock = createFakeClock();
  const calls = { stt: [], identify: 0, integrity: [] };
  const deps = {
    repo: {
      loadSessionContext: async () => ({
        interview: { id: "iv1", jobId: "j1", candidateId: "c1", status: "opened", state: null, lastActivityAt: null, expiresAt: new Date(clock.now() + 86400000) },
        job: { id: "j1", title: "SRE", hiringConfig: {} },
        candidate: { id: "c1", name: "Sam Lee", parsedData: {} },
      }),
      ensureQuestionSnapshot: async () => QUESTIONS,
      markStarted: async () => {},
      appendTurn: async () => {},
      createResponse: async () => "r1",
      updateResponseScore: async () => {},
      saveState: async () => {},
      recordIntegrityEvent: async (id, event) => { calls.integrity.push(event.type); },
      complete: async () => ({}),
      abandon: async () => {},
    },
    analyze: async () => ({ shouldFollowUp: false, reasons: [] }),
    score: async () => ({ score: 70, reasoning: "ok", keywordsCovered: [], keywordsMissed: [] }),
    followUp: async () => ({ question: "More?", fallback: false }),
    tts: async () => null,
    createStt: (handlers) => {
      const stt = { handlers, write() {}, keepAlive() {}, async flush() {}, async close() {} };
      calls.stt.push(stt);
      return stt;
    },
    detectLanguage: detectLanguage && (async (wav) => { calls.identify += 1; return detectLanguage(wav); }),
    publish: () => {},
    enqueue: async () => {},
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
  };
  const manager = new SessionManager({ deps, silenceMs: 8000, ...(languageGuard === undefined ? {} : { languageGuard }) });
  return { manager, clock, calls };
}

async function openRoom(t, { questionStage = false } = {}) {
  const ws = new FakeSocket();
  await t.manager.attach(ws, { interviewId: "iv1", candidateId: "c1" });
  await ws.client({ type: "ready" });
  await ws.client({ type: "ai_done_speaking", turnId: ws.json("ai_speaking")[0].turnId });
  if (questionStage) {
    t.calls.stt[0].handlers.onFinal("yes ready", {});
    await settle();
    await ws.client({ type: "ai_done_speaking", turnId: ws.json("ai_speaking").at(-1).turnId });
  }
  return { ws, say: async (text, timing = {}) => { t.calls.stt[0].handlers.onFinal(text, timing); await settle(); } };
}

test("engine: Urdu words in a transcript -> English-only notice, no caption, nothing counted as an answer", async () => {
  const t = setup();
  const { ws, say } = await openRoom(t);
  await say("mera naam Sam hai aur main theek hoon");
  assert.deepEqual(ws.json("caption_final"), [], "it never becomes a caption or an answer");
  const spoken = ws.json("ai_speaking").at(-1);
  assert.equal(spoken.kind, "system");
  assert.match(spoken.text, /^Sam, I noticed you spoke in Urdu\. This interview is conducted in English only/);
  assert.deepEqual(t.calls.integrity, ["non_english_speech"]);
  assert.equal(t.calls.identify, 0, "the text was certain: no audio check needed");
});

test("engine: a low-confidence transcript has its audio identified; Urdu audio gets the notice", async () => {
  const t = setup({ detectLanguage: async (wav) => ({ language: "urdu", text: "" }) });
  const { ws, say } = await openRoom(t, { questionStage: true });
  await ws.audio(3);
  await say("the mirror pit and cup is carried off", { startMs: 500, endMs: 2500, confidence: 0.42 });
  assert.equal(t.calls.identify, 1);
  assert.deepEqual(ws.json("caption_final"), [{ type: "caption_final", text: "yes ready" }]);
  const spoken = ws.json("ai_speaking").at(-1);
  assert.match(spoken.text, /I noticed you spoke in Urdu\./);
  assert.match(spoken.text, /Let me ask the question again\. First question\?$/);
});

test("engine: the audio check hands the audio to Whisper as a WAV of the right stretch", async () => {
  let wav = null;
  const t = setup({ detectLanguage: async (w) => { wav = w; return { language: "english", text: "I would use Docker" }; } });
  const { ws, say } = await openRoom(t, { questionStage: true });
  await ws.audio(4);
  await say("I would use darker for that", { startMs: 1000, endMs: 3000, confidence: 0.6 });
  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  assert.equal(wav.length, 44 + Math.round((2000 + 300) * 32), "2 s of speech plus 150 ms either side");
  assert.deepEqual(ws.json("caption_final").map((c) => c.text), ["yes ready", "I would use darker for that"], "English audio: the words are an answer as usual");
});

test("engine: confident English is never sent for identification", async () => {
  const t = setup({ detectLanguage: async () => ({ language: "urdu", text: "" }) });
  const { ws, say } = await openRoom(t, { questionStage: true });
  await ws.audio(3);
  await say("I would use Docker and a CI pipeline", { startMs: 500, endMs: 2500, confidence: 0.96 });
  assert.equal(t.calls.identify, 0);
  assert.equal(ws.json("caption_final").length, 2);
});

test("engine: identifications are rate limited and a slow or failing check lets the words through", async () => {
  let mode = "slow";
  const t = setup({
    detectLanguage: () => (mode === "slow" ? new Promise(() => {}) : Promise.reject(new Error("429"))),
  });
  const { ws, say } = await openRoom(t, { questionStage: true });
  await ws.audio(3);
  const talk = say("a doubtful sentence about pipelines", { startMs: 500, endMs: 2500, confidence: 0.5 });
  await settle(3); // the check is under way
  await t.clock.advance(1600); // it is given 1.5 s
  await talk;
  assert.equal(ws.json("caption_final").length, 2, "a check that takes too long never blocks the interview");

  mode = "fail";
  await t.clock.advance(3000);
  await say("another doubtful sentence about pipelines", { startMs: 600, endMs: 2600, confidence: 0.5 });
  assert.equal(ws.json("caption_final").length, 3, "a failing check never blocks it either");
  assert.equal(t.calls.identify, 2);

  await say("yet another doubtful sentence here", { startMs: 700, endMs: 2700, confidence: 0.5 });
  assert.equal(t.calls.identify, 2, "two checks within 2 s: the second is skipped");
});

test("engine: LANGUAGE_GUARD off lets everything through", async () => {
  const t = setup({ languageGuard: false });
  const { ws, say } = await openRoom(t);
  await say("mera naam Sam hai aur main theek hoon");
  assert.equal(ws.json("caption_final").length, 1);
  assert.deepEqual(t.calls.integrity, []);
});
