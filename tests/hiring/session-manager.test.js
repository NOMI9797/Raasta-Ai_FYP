// Engine session manager: attach/duplicate/close codes, STT wiring, disconnect → resume window → abandon.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "events";
import { SessionManager, CLOSE_CODES } from "../../services/interview-engine/session-manager";
import { createFakeClock, settle } from "./helpers/fake-clock";

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1;
    this.sent = [];
    this.closedWith = null;
  }
  send(data) { this.sent.push(JSON.parse(data)); }
  close(code, reason) {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.closedWith = { code, reason };
    this.emit("close", code);
  }
  json(type) { return this.sent.filter((m) => m.type === type); }
  async client(message) { this.emit("message", Buffer.from(JSON.stringify(message)), false); await settle(); }
}

const QUESTIONS = [
  { id: "q1", question: "First question?", category: "technical", idealAnswer: "x", expectedKeywords: [], scoreWeight: 1 },
  { id: "q2", question: "Second question?", category: "technical", idealAnswer: null, expectedKeywords: [], scoreWeight: 1 },
];

function setup({ interview = {}, maxSessions = 20 } = {}) {
  const clock = createFakeClock();
  const calls = { saveState: [], abandon: [], complete: [], markStarted: 0, stt: [] };
  const row = {
    id: "iv1", jobId: "j1", candidateId: "c1", status: "opened", state: null, lastActivityAt: null,
    expiresAt: new Date(clock.now() + 86400000), ...interview,
  };
  const deps = {
    repo: {
      loadSessionContext: async (id) => (id === "iv1" ? { interview: row, job: { id: "j1", title: "SRE", hiringConfig: { resumeWindowMinutes: 15 } }, candidate: { id: "c1", name: "Sam Lee", parsedData: {} } } : null),
      ensureQuestionSnapshot: async () => QUESTIONS,
      markStarted: async () => { calls.markStarted += 1; },
      appendTurn: async () => {},
      createResponse: async () => "r1",
      updateResponseScore: async () => {},
      saveState: async (id, state) => { calls.saveState.push(state); },
      recordIntegrityEvent: async () => {},
      complete: async (iv, opts) => { calls.complete.push(opts); return { totalAnswers: 2 }; },
      abandon: async (iv, opts) => { calls.abandon.push(opts); },
    },
    analyze: async () => ({ shouldFollowUp: false, reasons: [] }),
    score: async () => ({ score: 70, reasoning: "ok", keywordsCovered: [], keywordsMissed: [] }),
    followUp: async () => ({ question: "More?", fallback: false }),
    tts: async () => null,
    createStt: (handlers) => {
      const stt = { handlers, writes: 0, flushed: 0, closed: 0, write() { this.writes += 1; }, keepAlive() {}, async flush() { this.flushed += 1; }, async close() { this.closed += 1; } };
      calls.stt.push(stt);
      return stt;
    },
    publish: () => {},
    enqueue: async () => {},
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
  };
  const manager = new SessionManager({ deps, maxSessions, silenceMs: 8000 });
  return { manager, clock, calls, row };
}

const CLAIMS = { interviewId: "iv1", candidateId: "c1" };

test("attach: session_ready with the job and question count; a second socket is refused with 4009", async () => {
  const { manager } = setup();
  const ws = new FakeSocket();
  await manager.attach(ws, CLAIMS);
  assert.deepEqual(ws.json("session_ready")[0], { type: "session_ready", interviewId: "iv1", resume: false, totalQuestions: 2, maxMinutes: 25, interviewerName: "Raasta AI Interviewer", jobTitle: "SRE" });
  const dup = new FakeSocket();
  await manager.attach(dup, CLAIMS);
  assert.equal(dup.closedWith.code, CLOSE_CODES.DUPLICATE_SESSION);
  assert.equal(dup.json("error")[0].code, "duplicate_session");
  assert.equal(ws.readyState, 1, "the first socket stays open");
});

test("attach: close codes for missing, mismatched, completed and expired interviews", async () => {
  const cases = [
    [{}, { interviewId: "nope", candidateId: "c1" }, CLOSE_CODES.NOT_FOUND],
    [{}, { interviewId: "iv1", candidateId: "other" }, CLOSE_CODES.BAD_TICKET],
    [{ status: "completed" }, CLAIMS, CLOSE_CODES.ALREADY_COMPLETED],
    [{ status: "expired" }, CLAIMS, CLOSE_CODES.EXPIRED],
    [{ status: "opened", expiresAt: new Date(Date.parse("2025-01-01")) }, CLAIMS, CLOSE_CODES.EXPIRED],
  ];
  for (const [interview, claims, code] of cases) {
    const { manager } = setup({ interview });
    const ws = new FakeSocket();
    await manager.attach(ws, claims);
    assert.equal(ws.closedWith?.code, code, JSON.stringify(interview));
    assert.equal(manager.activeSessions, 0);
  }
  // In progress past the invite expiry: still resumable
  const { manager } = setup({ interview: { status: "in_progress", expiresAt: new Date(Date.parse("2025-01-01")) } });
  const ws = new FakeSocket();
  await manager.attach(ws, CLAIMS);
  assert.equal(ws.closedWith, null);
});

test("capacity: over INTERVIEW_MAX_SESSIONS → error + 1013", async () => {
  const { manager } = setup({ maxSessions: 0 });
  const ws = new FakeSocket();
  await manager.attach(ws, CLAIMS);
  assert.equal(ws.closedWith.code, CLOSE_CODES.TRY_AGAIN_LATER);
});

test("ready opens STT and greets; audio frames reach STT only after ready and within limits", async () => {
  const { manager, calls } = setup();
  const ws = new FakeSocket();
  await manager.attach(ws, CLAIMS);
  ws.emit("message", Buffer.alloc(640), true);
  assert.equal(calls.stt.length, 0);
  await ws.client({ type: "ready", ua: "x".repeat(1000), devices: { mic: true, cam: 1 } });
  assert.equal(calls.markStarted, 1);
  assert.equal(calls.stt.length, 1);
  assert.equal(ws.json("ai_speaking")[0].kind, "greeting");
  ws.emit("message", Buffer.alloc(640), true);
  ws.emit("message", Buffer.alloc(70 * 1024), true); // too large
  ws.emit("message", Buffer.alloc(641), true);       // not PCM16
  await settle();
  assert.equal(calls.stt[0].writes, 1);
  await ws.client({ type: "ping", t: 42 });
  assert.deepEqual(ws.json("pong")[0], { type: "pong", t: 42 });
});

test("STT finals drive the session; answer_done flushes STT first", async () => {
  const { manager, calls } = setup();
  const ws = new FakeSocket();
  await manager.attach(ws, CLAIMS);
  await ws.client({ type: "ready" });
  await ws.client({ type: "ai_done_speaking", turnId: ws.json("ai_speaking")[0].turnId });
  calls.stt[0].handlers.onFinal("yes ready", {});
  await settle();
  assert.equal(ws.json("question")[0].text, "First question?");
  await ws.client({ type: "ai_done_speaking", turnId: ws.json("ai_speaking").at(-1).turnId });
  calls.stt[0].handlers.onPartial("my ans");
  calls.stt[0].handlers.onFinal("my answer to the first question", {});
  await ws.client({ type: "answer_done" });
  assert.equal(calls.stt[0].flushed, 1);
  assert.deepEqual(ws.json("caption_partial")[0], { type: "caption_partial", text: "my ans" });
  assert.equal(ws.json("question").at(-1).text, "Second question?");
});

test("disconnect: paused and saved; reconnect within the window resumes the same question", async () => {
  const { manager, clock, calls } = setup();
  const ws = new FakeSocket();
  await manager.attach(ws, CLAIMS);
  await ws.client({ type: "ready" });
  await ws.client({ type: "begin" });
  assert.equal(ws.json("question")[0].text, "First question?");
  ws.close(1006);
  await settle();
  assert.equal(calls.stt[0].closed, 1);
  assert.ok(calls.saveState.at(-1).pausedAt);
  assert.equal(manager.activeSessions, 1);

  await clock.advance(5 * 60 * 1000);
  const ws2 = new FakeSocket();
  await manager.attach(ws2, CLAIMS);
  assert.equal(ws2.json("session_ready")[0].resume, true);
  await ws2.client({ type: "ready" });
  assert.equal(ws2.json("ai_speaking")[0].text, "Welcome back, let's continue. First question?");
  assert.equal(ws2.json("question")[0].index, 1);
  assert.equal(calls.markStarted, 1);
  await clock.advance(20 * 60 * 1000);
  assert.equal(calls.abandon.length, 0, "the abandon timer was cancelled");
});

test("disconnect: no reconnect within the window → abandoned", async () => {
  const { manager, clock, calls } = setup();
  const ws = new FakeSocket();
  await manager.attach(ws, CLAIMS);
  await ws.client({ type: "ready" });
  ws.close(1006);
  await clock.advance(15 * 60 * 1000 + 10);
  assert.equal(calls.abandon.length, 1);
  assert.equal(manager.activeSessions, 0);
});

test("engine restart: a saved state resumes with the clock frozen at the last activity", async () => {
  const lastActivityAt = new Date(Date.parse("2026-01-01T09:00:00Z"));
  const state = { stage: "listening", hasGreeted: true, begun: true, questionQueue: ["q2"], questionsAsked: [{ questionId: "q1" }], questionsAnswered: [], currentQuestionId: "q1", currentBaseQuestionId: "q1", currentQuestionText: "First question?", currentKind: "question", questionIndex: 1, totalQuestions: 2, seq: 3, startedAt: Date.parse("2026-01-01T08:55:00Z"), pausedMs: 0, warningsSent: [], history: [], recentAnswers: [], skipped: [] };
  const { manager } = setup({ interview: { status: "in_progress", state, lastActivityAt } });
  const ws = new FakeSocket();
  const entry = await manager.attach(ws, CLAIMS);
  assert.equal(ws.json("session_ready")[0].resume, true);
  await ws.client({ type: "ready" });
  assert.equal(ws.json("ai_speaking")[0].text, "Welcome back, let's continue. First question?");
  // 5 minutes ran before the restart; the hour since the last activity does not count
  assert.ok(Math.abs(entry.session.elapsedMs() - 5 * 60 * 1000) < 2000);
});

test("finished interview: socket closed with 1000 and the session removed; shutdown snapshots and closes with 1012", async () => {
  const { manager, clock, calls } = setup();
  const ws = new FakeSocket();
  await manager.attach(ws, CLAIMS);
  await ws.client({ type: "ready" });
  await ws.client({ type: "begin" });
  for (let i = 0; i < 2; i += 1) {
    await ws.client({ type: "ai_done_speaking", turnId: ws.json("ai_speaking").at(-1).turnId });
    calls.stt[0].handlers.onFinal(`answer ${i}`, {});
    await ws.client({ type: "answer_done" });
  }
  await ws.client({ type: "ai_done_speaking", turnId: ws.json("ai_speaking").at(-1).turnId });
  assert.equal(ws.json("interview_complete")[0].reason, "finished");
  await clock.advance(2000);
  assert.equal(ws.closedWith.code, CLOSE_CODES.NORMAL);
  assert.equal(manager.activeSessions, 0);

  const s = setup();
  const ws3 = new FakeSocket();
  await s.manager.attach(ws3, CLAIMS);
  await ws3.client({ type: "ready" });
  await s.manager.shutdown();
  assert.equal(ws3.closedWith.code, CLOSE_CODES.SERVICE_RESTART);
  assert.ok(s.calls.saveState.at(-1).pausedAt);
});
