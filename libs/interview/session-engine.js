// The Raasta AI Interviewer's conversation loop (docs/ai-hiring/09-interview-engine.md,
// rules in docs/ai-hiring/04-source-port-map.md "Interview loop rules").
//
// One InterviewSession per live interview. Every side effect goes through `deps`, so the loop is
// tested with fake timers and fakes (tests/hiring/session-engine.test.js).
//
// Fixes over the earlier loop:
//  - the pre-speak guard measures speech that arrived after the buffer was cleared (it used to
//    compare against the length before clearing, so it rarely fired);
//  - the next question is only peeked at until it is actually spoken, so an aborted plan loses
//    nothing; nothing is persisted for an aborted plan either (the answer goes back to the buffer);
//  - fallback scores and fallback follow-ups are used (flagged), not discarded;
//  - the follow-up prompt receives the analysis reasons.
//  - the interviewer's own voice, heard again through the speakers, is cut out of the answer (echo-guard);
//  - "end the interview" is honoured, and a refusal moves on instead of earning a follow-up (intent).
// Relative imports only — runs in the interview engine.
import { randomUUID } from "crypto";
import { stripEchoes } from "./echo-guard";
import { detectEndRequest, isDecline } from "./intent";
import { languageNoticeText, languageReminderText } from "./language";
import { DEFAULT_INTERVIEW_MINUTES, QUESTION_MIN_MS, describeLength, followUpAffordable, planInterview, warningThresholds } from "./time-plan";

export const READY_WORDS = /\b(yes|ready|sure|okay|ok|yeah|let'?s|start|begin)\b/i;
export const GUARD_CHARS = 10;            // candidate kept talking → don't speak over them
export const TIME_UP_GRACE_MS = 60 * 1000;
export { QUESTION_MIN_MS };
export const MAX_REPEATS = 2;
export const LANGUAGE_NOTICE_COOLDOWN_MS = 20 * 1000;  // a notice and the candidate's reply to it take about this long
export const MAX_LANGUAGE_NOTICES = 5;                  // after this many the interviewer stops interrupting (it is still recorded)
const KEEP_ANSWER_WORDS = 25;                           // a long English answer is not cut off by one sentence in another language
export const SKIP_MIN_REMAINING = 6;      // skip heuristic is off when fewer questions remain
const ACK_SLACK_MS = 4000;                // client never sent ai_done_speaking → continue anyway
const TICK_MS = 1000;
const HISTORY_LIMIT = 12;
const RECENT_ANSWERS = 10;
const ECHO_WINDOW_MS = 90 * 1000;         // how long after the interviewer spoke its words can come back as echo
const RECENT_SPOKEN = 4;
const INTEGRITY_EVENTS = new Set(["tab_hidden", "tab_visible", "mic_muted", "mic_unmuted", "net_offline", "net_online", "fullscreen_exit"]);
const MAX_INTEGRITY_EVENTS = 200;

export function greetingText({ firstName, jobTitle, total, minutes }) {
  const scope = minutes ? `I'll ask you ${describeLength({ minutes, questionCount: total })}` : `I'll ask you about ${total} questions`;
  return `Hello ${firstName}! I'm the Raasta AI Interviewer for the ${jobTitle} role. ${scope}, and the interview is conducted in English. Take your time, and press 'I've finished my answer' when you're done. Are you ready to begin?`;
}

export function closingText({ firstName, jobTitle }) {
  return `Thank you, ${firstName}. That concludes your interview for ${jobTitle}. The hiring team will be in touch. You may now close this window.`;
}

export function endedByCandidateText({ firstName }) {
  return `Understood, ${firstName}. I'll end the interview here. Thank you for your time. The hiring team will review what we covered and be in touch. You may now close this window.`;
}

/**
 * Skip-if-already-answered heuristic from the earlier loop: ≥ 50% of the question's words longer
 * than 3 characters appear in the last 10 candidate answers. Questions without such words are never skipped.
 */
export function looksAlreadyAnswered(questionText, recentAnswers) {
  const words = String(questionText || "").toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z0-9+#.-]/g, "")).filter((w) => w.length > 3);
  if (!words.length) return false;
  const text = recentAnswers.join(" ").toLowerCase();
  const hits = words.filter((w) => text.includes(w)).length;
  return hits >= Math.ceil(words.length * 0.5);
}

function estimateSpeechMs(text) {
  // ~150 words per minute
  return Math.max(1500, String(text).split(/\s+/).length * 400);
}

export class InterviewSession {
  /**
   * @param {object} p
   * @param p.interview  interviews row
   * @param p.job        jobs row
   * @param p.candidate  candidates row
   * @param p.questions  frozen question snapshot (session question shape)
   * @param p.config     { maxFollowUps, interviewMaxMinutes, silenceMs, interviewerName }; the interview length
   *                     decides how many of the questions are asked (libs/interview/time-plan.js)
   * @param p.candidateContext / p.roleContext  from mappers.js
   * @param p.state      serialized state to resume from (interviews.state)
   * @param p.deps       { analyze, score, followUp, tts, repo, publish, send, enqueue, onEnded, now, setTimeout, clearTimeout, log }
   */
  constructor({ interview, job, candidate, questions, config, candidateContext, roleContext, state = null, pausedAt = null, deps }) {
    this.interview = interview;
    this.job = job;
    this.candidate = candidate;
    this.questions = questions;
    this.questionById = new Map(questions.map((q) => [q.id, q]));
    this.candidateContext = candidateContext;
    this.roleContext = roleContext;
    // The recruiter's interview length shapes the plan: how many questions fit, which ones, and when to warn
    this.plan = planInterview({
      minutes: config?.interviewMaxMinutes ?? DEFAULT_INTERVIEW_MINUTES,
      questions,
      maxFollowUps: config?.maxFollowUps ?? 2,
    });
    this.config = {
      maxFollowUps: config?.maxFollowUps ?? 2,
      maxMs: this.plan.maxMs,
      silenceMs: config?.silenceMs ?? 8000,
      interviewerName: config?.interviewerName || "Raasta AI Interviewer",
    };
    this.warnAt = warningThresholds(this.plan.minutes);
    this.deps = {
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (t) => clearTimeout(t),
      log: () => {},
      publish: () => {},
      enqueue: async () => {},
      ...deps,
    };

    this.state = state ? { ...InterviewSession.initialState(questions), ...state } : InterviewSession.initialState(questions, this.plan);
    // Speech in the middle of an answer is never resumed: the question is asked again
    this.state.currentAnswerBuffer = "";

    // Runtime-only (never serialized)
    this.isProcessingAnswer = false;
    this.isAiSpeaking = false;
    this.recentSpoken = [];         // what the interviewer said lately, newest first (to recognise its echo)
    this.sideBuffer = "";           // finals heard while the AI was speaking (barge-in)
    this.mergeSideBuffer = false;   // the AI finished: merge the side buffer if the candidate keeps talking
    this.currentTurnId = null;
    this.answerStartedAt = null;
    this.timers = { silence: null, ack: null, tick: null };
    this.pendingScores = new Set();
    this.ended = this.state.stage === "ended";
    this.paused = Boolean(pausedAt);
    this.pausedAt = pausedAt ? new Date(pausedAt).getTime() : null;
    this.started = false;
    this.processing = null;
  }

  static initialState(questions, plan = null) {
    const queue = plan ? plan.questionIds : questions.map((q) => q.id);
    return {
      stage: "waiting",
      hasGreeted: false,
      begun: false,
      questionQueue: queue,
      questionsAsked: [],
      questionsAnswered: [],
      currentQuestionId: null,
      currentQuestionText: null,
      currentBaseQuestionId: null,
      currentKind: null,
      followUpDepth: 0,
      followUpContext: null,
      currentAnswerBuffer: "",
      lastAnswerAt: null,
      startedAt: null,
      pausedMs: 0,
      questionIndex: 0,
      totalQuestions: queue.length,
      seq: 0,
      skipped: [],
      warningsSent: [],
      history: [],
      recentAnswers: [],
      repeatCount: 0,
      timeUpAt: null,
      endedByCandidate: false,
      languageNotices: 0,
      languageNoticeAt: null,
      languageReminderPending: false,
    };
  }

  // ───────────────────────────── public surface ─────────────────────────────

  /** Client sent `ready`. First start: greeting. Resume: "Welcome back" + current question. */
  async start({ resume = false, clientInfo = null } = {}) {
    if (this.ended) return;
    // A reconnect while the previous answer is still being processed: let it settle first
    if (this.processing) await this.processing.catch(() => {});
    if (this.paused) {
      this.state.pausedMs += this.deps.now() - this.pausedAt;
      this.paused = false;
      this.pausedAt = null;
    }
    this.clearTimer("silence");
    this.clearTimer("ack");
    this.isAiSpeaking = false;
    this.sideBuffer = "";
    this.state.currentAnswerBuffer = "";

    if (!this.state.startedAt) this.state.startedAt = this.deps.now();
    if (!this.started) {
      await this.deps.repo.markStarted(this.interview, { clientInfo });
      this.started = true;
    }
    this.publish({ type: "status", status: "in_progress", resume });
    this.startTicker();

    if (resume && this.state.begun && this.state.currentQuestionText && this.state.stage !== "closing") {
      this.state.repeatCount = 0;
      await this.speak({
        kind: this.state.currentKind || "question",
        text: `Welcome back, let's continue. ${this.state.currentQuestionText}`,
        questionText: this.state.currentQuestionText,
      });
      return;
    }
    if (this.state.stage === "closing") {
      await this.close();
      return;
    }
    this.state.stage = "greeting";
    this.state.hasGreeted = true;
    await this.speak({ kind: "greeting", text: greetingText(this.textVars()), cache: true });
  }

  onSttPartial(text) {
    if (this.ended || this.paused || !text) return;
    this.deps.send("caption_partial", { text });
  }

  /**
   * The candidate is audibly talking (voice activity or a partial transcript). Finals can lag
   * many seconds behind speech (Whisper only transcribes once an utterance ends), so the silence
   * window counts from the last sign of speech, not only from the last final.
   */
  onSpeechActivity() {
    if (this.ended || this.paused || !this.state.begun || this.isAiSpeaking) return;
    if (this.state.stage === "listening" || this.state.stage === "processing") this.state.lastAnswerAt = this.deps.now();
  }

  /**
   * Take the interviewer's own words out of what the microphone heard. Outside the window after it
   * spoke (or before it ever spoke) the text is left alone.
   */
  withoutEcho(text) {
    const value = String(text || "").trim();
    if (!value || !this.recentSpoken.length) return value;
    if (!this.isAiSpeaking && this.deps.now() - this.recentSpoken[0].at > ECHO_WINDOW_MS) return value;
    return stripEchoes(value, this.recentSpoken.map((s) => s.text)).text;
  }

  onSttFinal(text, timing = {}) {
    if (this.ended || this.paused) return;
    const clean = this.withoutEcho(text);
    if (!clean) return;
    this.deps.send("caption_final", { text: clean });
    this.publish({ type: "caption_final", text: clean });

    if (!this.state.begun || this.state.stage === "greeting") {
      // Rule 2: a ready word after the greeting starts the interview; nothing said before Q1 is an answer
      if (!this.state.begun && this.state.stage === "greeting" && !this.isAiSpeaking && READY_WORDS.test(clean)) {
        this.begin().catch((error) => this.fail(error));
      }
      return;
    }
    if (this.state.stage === "closing") return;

    if (this.isAiSpeaking) {
      // Rule 10: keep it aside; no silence timer until the AI has finished speaking
      this.sideBuffer = `${this.sideBuffer} ${clean}`.trim();
      return;
    }
    if (this.mergeSideBuffer && this.sideBuffer) {
      // The candidate kept talking after the question ended: their earlier words belong to the answer
      this.appendToBuffer(this.sideBuffer, timing);
    }
    this.mergeSideBuffer = false;
    this.sideBuffer = "";
    this.appendToBuffer(clean, timing);
    this.scheduleSilence();
  }

  /**
   * The candidate spoke something other than English (Urdu, mostly). The interview is English only, so the
   * words are never part of an answer: the interviewer says so and asks the question again. A long
   * English answer in progress is not interrupted; the reminder comes with the next question instead.
   * @param {{ language?: string|null }} p language: "urdu" when known
   */
  async onNonEnglishSpeech({ language = null } = {}) {
    if (this.ended || this.paused || !this.state.hasGreeted || this.isAiSpeaking || this.isProcessingAnswer) return;
    if (!["greeting", "listening", "asking"].includes(this.state.stage)) return;
    const now = this.deps.now();
    if (this.state.languageNoticeAt && now - this.state.languageNoticeAt < LANGUAGE_NOTICE_COOLDOWN_MS) return;

    this.state.languageNotices += 1;
    this.state.languageNoticeAt = now;
    this.deps.repo.recordIntegrityEvent(this.interview.id, { type: "non_english_speech", at: new Date(now).toISOString() })
      .catch((error) => this.deps.log("warn", { msg: "language event not saved", error: error.message }));
    this.publish({ type: "language_notice", count: this.state.languageNotices });
    this.deps.log("info", { msg: "candidate spoke a language other than English", interviewId: this.interview.id, count: this.state.languageNotices });
    if (this.state.languageNotices > MAX_LANGUAGE_NOTICES) return;

    const heard = `${this.state.currentAnswerBuffer} ${this.sideBuffer}`.trim();
    const words = heard ? heard.split(/\s+/).length : 0;
    if (this.state.begun && words >= KEEP_ANSWER_WORDS) {
      this.state.languageReminderPending = true;
      return;
    }

    const notice = languageNoticeText({ firstName: this.textVars().firstName, count: this.state.languageNotices, language });
    this.clearTimer("silence");
    this.clearTimer("ack");
    this.state.currentAnswerBuffer = "";
    this.sideBuffer = "";
    if (!this.state.begun) {
      // Before the first question: they cannot say "ready" in Urdu
      await this.speak({ kind: "system", text: `${notice} Are you ready to begin?` });
    } else if (this.state.currentQuestionText) {
      await this.persistState();
      await this.speak({
        kind: this.state.currentKind || "question",
        text: `${notice} Let me ask the question again. ${this.state.currentQuestionText}`,
        questionText: this.state.currentQuestionText,
      });
    }
  }

  /** The one-line reminder owed from a mid-answer switch of language, once; "" when none is due. */
  takeLanguageReminder() {
    if (!this.state.languageReminderPending) return "";
    this.state.languageReminderPending = false;
    return `${languageReminderText()} `;
  }

  onAiDoneSpeaking(turnId) {
    if (this.ended || turnId !== this.currentTurnId || !this.isAiSpeaking) return;
    this.clearTimer("ack");
    this.isAiSpeaking = false;

    if (this.state.stage === "closing") {
      const reason = this.state.endedByCandidate ? "candidate_ended" : this.state.timeUpAt ? "time_up" : "finished";
      this.end(reason).catch((error) => this.fail(error));
      return;
    }
    if (this.state.stage === "greeting") {
      this.sideBuffer = "";
      this.deps.send("listening", { silenceMs: this.config.silenceMs });
      return;
    }
    this.state.stage = "listening";
    this.mergeSideBuffer = Boolean(this.sideBuffer);
    this.deps.send("listening", { silenceMs: this.config.silenceMs });
    if (this.state.currentAnswerBuffer) this.scheduleSilence();
    if (this.state.timeUpAt) this.checkTime();
  }

  /** Candidate pressed "I've finished my answer". */
  onAnswerDone() {
    if (this.ended || this.paused || !this.state.begun) return;
    if (!["listening", "asking"].includes(this.state.stage)) return;
    if (!this.state.currentAnswerBuffer && this.sideBuffer) {
      // Answered over the end of the question, then pressed done
      this.appendToBuffer(this.sideBuffer, {});
      this.sideBuffer = "";
    }
    if (this.isAiSpeaking) {
      this.clearTimer("ack");
      this.isAiSpeaking = false;
    }
    this.processAnswer({ trigger: "answer_done" }).catch((error) => this.fail(error));
  }

  /** Candidate clicked "Start" after the greeting. */
  onBegin() {
    if (this.ended || this.paused || this.state.begun || this.state.stage !== "greeting") return;
    this.begin().catch((error) => this.fail(error));
  }

  /**
   * The candidate wants to stop: the "End interview" button, or they said so (see runProcessing).
   * What they were saying is kept, the interviewer says goodbye, and the interview ends.
   */
  async onEndRequest({ source = "button" } = {}) {
    if (this.ended || this.paused || this.state.endedByCandidate || this.state.stage === "closing") return;
    // An answer being processed settles first (it may already be the last one)
    if (this.processing) await this.processing.catch(() => {});
    if (this.ended || this.state.stage === "closing") return;
    this.clearTimer("silence");
    this.clearTimer("ack");
    this.isAiSpeaking = false;
    const pending = this.withoutEcho(`${this.state.currentAnswerBuffer} ${this.sideBuffer}`.trim());
    this.state.currentAnswerBuffer = "";
    this.sideBuffer = "";
    if (pending && this.state.begun && ["listening", "asking"].includes(this.state.stage) && !detectEndRequest(pending)) {
      await this.saveAnswer({ answer: pending, ...this.questionSnapshot(), answeredAt: new Date(this.answerStartedAt || this.deps.now()) });
    }
    this.deps.log("info", { msg: "candidate ended the interview", interviewId: this.interview.id, source });
    this.publish({ type: "status", status: "ending", source });
    await this.close({ byCandidate: true });
  }

  onRepeatQuestion() {
    if (this.ended || this.paused || !this.state.begun || this.isProcessingAnswer) return;
    if (!["listening", "asking"].includes(this.state.stage) || !this.state.currentQuestionText) return;
    if (this.state.repeatCount >= MAX_REPEATS) {
      this.deps.send("error", { code: "invalid_state", message: "This question has already been repeated twice.", retryable: false });
      return;
    }
    this.state.repeatCount += 1;
    this.clearTimer("silence");
    this.state.currentAnswerBuffer = "";
    this.sideBuffer = "";
    this.speak({ kind: this.state.currentKind, text: this.state.currentQuestionText, questionText: this.state.currentQuestionText })
      .catch((error) => this.fail(error));
  }

  onClientEvent(evt) {
    if (this.ended || !evt || !INTEGRITY_EVENTS.has(evt.event)) return;
    this.integrityCount = (this.integrityCount || 0) + 1;
    if (this.integrityCount > MAX_INTEGRITY_EVENTS) return;
    const at = typeof evt.at === "string" || typeof evt.at === "number" ? new Date(evt.at) : new Date(this.deps.now());
    const event = { type: evt.event, at: Number.isNaN(at.getTime()) ? new Date(this.deps.now()).toISOString() : at.toISOString() };
    this.deps.repo.recordIntegrityEvent(this.interview.id, event).catch((error) => this.deps.log("warn", { msg: "integrity event not saved", error: error.message }));
    this.publish({ type: "integrity", event: event.type });
  }

  /** Socket closed: freeze the clock and every timer until the candidate reconnects. */
  pause() {
    if (this.ended || this.paused) return;
    this.paused = true;
    this.pausedAt = this.deps.now();
    this.clearTimer("silence");
    this.clearTimer("ack");
    this.clearTimer("tick");
    this.isAiSpeaking = false;
    this.sideBuffer = "";
    this.state.currentAnswerBuffer = "";
    this.publish({ type: "status", status: "disconnected" });
  }

  /**
   * End the interview.
   * finished | time_up | ended_by_system → completed.
   * abandoned | error → completed when ≥ 50% of base questions were answered, otherwise abandoned.
   */
  async end(reason = "finished") {
    if (this.ended) return null;
    this.ended = true;
    this.state.stage = "ended";
    for (const name of Object.keys(this.timers)) this.clearTimer(name);
    this.isAiSpeaking = false;
    await Promise.allSettled([...this.pendingScores]);

    const state = this.serializeState();
    const answeredBase = new Set(this.state.questionsAnswered.filter((a) => !a.isFollowUp).map((a) => a.questionId)).size;
    const partial = reason === "abandoned" || reason === "error";
    // Someone who ends the interview before answering anything has nothing to evaluate
    const leftBeforeAnswering = reason === "candidate_ended" && this.state.questionsAnswered.length === 0;
    if (leftBeforeAnswering || (partial && answeredBase < Math.ceil(this.state.totalQuestions * 0.5))) {
      await this.deps.repo.abandon(this.interview, { state });
      if (reason === "candidate_ended") this.deps.send("interview_complete", { reason: "ended_by_candidate" });
      this.publish({ type: "status", status: "abandoned" });
      this.deps.log("info", { msg: "interview abandoned", interviewId: this.interview.id, answered: answeredBase });
      this.deps.onEnded?.({ status: "abandoned", reason });
      return { status: "abandoned" };
    }

    const stats = await this.deps.repo.complete(this.interview, { questions: this.questions, state, totalQuestions: this.state.totalQuestions });
    if (!partial) {
      const wire = { time_up: "time_up", finished: "finished", candidate_ended: "ended_by_candidate" };
      this.deps.send("interview_complete", { reason: wire[reason] || "ended_by_system" });
    }
    this.publish({ type: "status", status: "completed", reason });
    try {
      await this.deps.enqueue("analyse-interview", { interviewId: this.interview.id });
    } catch (error) {
      // The interview is already saved; a queue outage must not break the ending (analysis can be re-queued)
      this.deps.log("error", { msg: "analysis not queued", interviewId: this.interview.id, error: error?.message });
    }
    this.deps.log("info", { msg: "interview completed", interviewId: this.interview.id, reason, answers: stats?.totalAnswers });
    this.deps.onEnded?.({ status: "completed", reason, stats });
    return { status: "completed", stats };
  }

  serializeState() {
    // Never persist half an answer
    return JSON.parse(JSON.stringify({ ...this.state, currentAnswerBuffer: "", pausedAt: this.paused ? new Date(this.pausedAt).toISOString() : null, savedAt: new Date(this.deps.now()).toISOString() }));
  }

  /** Elapsed interview time, excluding time spent disconnected. */
  elapsedMs() {
    if (!this.state.startedAt) return 0;
    const pausedNow = this.paused ? this.deps.now() - this.pausedAt : 0;
    return Math.max(0, this.deps.now() - this.state.startedAt - this.state.pausedMs - pausedNow);
  }

  remainingMs() {
    return this.config.maxMs - this.elapsedMs();
  }

  // ───────────────────────────── loop internals ─────────────────────────────

  async begin() {
    if (this.state.begun) return;
    this.state.begun = true;
    // Rule 1/2: stray words before Q1 ("hi", "yes ready") are never part of an answer
    this.clearTimer("silence");
    this.clearTimer("ack");
    this.isAiSpeaking = false;
    this.state.currentAnswerBuffer = "";
    this.sideBuffer = "";
    this.state.followUpDepth = 0;
    const next = this.peekNextQuestion();
    if (!next) {
      await this.close();
      return;
    }
    this.commitQuestion(next);
    await this.persistState();
    await this.speak({ kind: "question", text: next.question.question, questionText: next.question.question });
  }

  appendToBuffer(text, timing) {
    if (!this.state.currentAnswerBuffer) this.answerStartedAt = this.deps.now() - Math.max(0, (timing?.endMs ?? 0) - (timing?.startMs ?? 0));
    this.state.currentAnswerBuffer = `${this.state.currentAnswerBuffer} ${text}`.trim();
    this.state.lastAnswerAt = this.deps.now();
  }

  scheduleSilence(delay = this.config.silenceMs) {
    this.clearTimer("silence");
    this.timers.silence = this.deps.setTimeout(() => {
      this.timers.silence = null;
      if (this.ended || this.paused) return;
      const quietFor = this.deps.now() - (this.state.lastAnswerAt || 0);
      if (quietFor < this.config.silenceMs) {
        this.scheduleSilence(this.config.silenceMs - quietFor);
        return;
      }
      this.processAnswer({ trigger: "silence" }).catch((error) => this.fail(error));
    }, delay);
  }

  /**
   * Rules 5–7: finalise the answer, decide the next step, speak it unless the candidate kept talking.
   */
  async processAnswer({ trigger, force = false } = {}) {
    // Single-flight lock, taken before any await
    if (this.isProcessingAnswer || this.ended || this.paused) return;
    if (!["listening", "asking"].includes(this.state.stage)) return;
    if (this.isAiSpeaking && !force) return;
    if (!this.state.currentAnswerBuffer && trigger === "silence") return;
    this.isProcessingAnswer = true;
    this.clearTimer("silence");
    this.processing = this.runProcessing({ force });
    try {
      await this.processing;
    } finally {
      this.processing = null;
    }
  }

  questionSnapshot() {
    const snap = {
      questionId: this.state.currentQuestionId,
      questionText: this.state.currentQuestionText,
      baseQuestionId: this.state.currentBaseQuestionId,
      depth: this.state.followUpDepth,
      kind: this.state.currentKind,
      followUpContext: this.state.followUpContext,
      answerStartedAt: this.answerStartedAt,
    };
    return { snap, base: this.questionById.get(snap.baseQuestionId) };
  }

  async runProcessing({ force }) {
    const { snap, base } = this.questionSnapshot();
    // The interviewer's own voice can be heard again through the speakers: it is not the answer
    const answer = this.withoutEcho(this.state.currentAnswerBuffer.trim());
    const answeredAt = new Date(this.answerStartedAt || this.deps.now());
    this.state.currentAnswerBuffer = ""; // the guard measures everything heard from here on
    this.state.stage = "processing";
    this.deps.send("processing", {});

    try {
      if (!force && answer && detectEndRequest(answer)) {
        // "End the interview": keep the words in the transcript, but they are not an answer
        await this.deps.repo.appendTurn(this.interview.id, {
          seq: ++this.state.seq,
          speaker: "candidate",
          kind: "answer",
          questionId: snap.baseQuestionId,
          text: answer,
          startedAt: answeredAt,
          endedAt: new Date(this.deps.now()),
          offsetMs: this.offsetMs(answeredAt.getTime()),
        });
        this.deps.log("info", { msg: "candidate asked to end the interview", interviewId: this.interview.id });
        this.publish({ type: "status", status: "ending", source: "voice" });
        await this.close({ byCandidate: true });
        return;
      }

      const declined = isDecline(answer);
      const plan = await this.planNext({ answer, snap, base, force, declined });

      // Pre-speak guard: the candidate is still answering → keep listening, commit nothing
      if (!force && plan.type !== "closing_forced" && this.state.currentAnswerBuffer.length > GUARD_CHARS) {
        this.state.currentAnswerBuffer = `${answer} ${this.state.currentAnswerBuffer}`.trim();
        this.answerStartedAt = snap.answerStartedAt;
        this.state.stage = "listening";
        this.deps.log("debug", { msg: "pre-speak guard: candidate still talking", interviewId: this.interview.id });
        return;
      }

      await this.saveAnswer({ answer, snap, base, answeredAt, declined });

      if (plan.type === "follow_up") {
        this.state.followUpDepth = snap.depth + 1;
        this.state.currentQuestionId = `fu-${randomUUID()}`;
        this.state.currentQuestionText = plan.text;
        this.state.currentKind = "follow_up";
        this.state.followUpContext = { reason: plan.reason?.condition || null, fallback: plan.fallback };
        this.state.repeatCount = 0;
        await this.persistState();
        await this.speak({ kind: "follow_up", text: `${this.takeLanguageReminder()}${plan.text}`, questionText: plan.text });
      } else if (plan.type === "question") {
        this.commitQuestion(plan.next);
        await this.persistState();
        await this.speak({ kind: "question", text: `${this.takeLanguageReminder()}${plan.next.question.question}`, questionText: plan.next.question.question });
      } else {
        await this.close();
      }
    } finally {
      this.isProcessingAnswer = false;
      // Rule 7: speech that arrived meanwhile is never lost
      if (!this.ended && !this.paused && this.state.currentAnswerBuffer && this.state.stage === "listening") {
        this.scheduleSilence();
      }
    }
  }

  async planNext({ answer, snap, base, force, declined = false }) {
    if (force || this.state.timeUpAt) return { type: force ? "closing_forced" : "closing" };

    // A refusal or "I don't know" gets no follow-up: asking again only repeats the question
    if (answer && !declined && snap.depth < this.config.maxFollowUps && this.canAffordFollowUp()) {
      const questionForAnalysis = snap.kind === "follow_up"
        ? { question: snap.questionText, category: null, expectedKeywords: [] }
        : base || { question: snap.questionText, expectedKeywords: [] };
      const analysis = await this.deps.analyze(answer, questionForAnalysis, { candidateSkills: this.candidateContext?.skills || [] });
      if (analysis?.shouldFollowUp) {
        const followUp = await this.deps.followUp({
          question: questionForAnalysis,
          answer,
          analysis,
          reason: analysis.reasonForFollowUp,
          history: this.state.history,
          candidate: this.candidateContext,
          role: this.roleContext,
          depth: snap.depth,
        });
        if (followUp?.question) return { type: "follow_up", text: followUp.question, reason: analysis.reasonForFollowUp, fallback: followUp.fallback };
      }
    }
    if (this.remainingMs() < QUESTION_MIN_MS) return { type: "closing" };
    const next = this.peekNextQuestion();
    return next ? { type: "question", next } : { type: "closing" };
  }

  /** A follow-up is only asked while every question still to come keeps its minimum time. */
  canAffordFollowUp() {
    return followUpAffordable({ remainingMs: this.remainingMs(), questionsLeft: this.state.questionQueue.length });
  }

  /** Rule 8, without side effects: the next base question plus the ones it would skip. */
  peekNextQuestion() {
    const answered = new Set(this.state.questionsAnswered.map((a) => a.questionId));
    const skipped = [];
    const queue = this.state.questionQueue;
    for (let i = 0; i < queue.length; i += 1) {
      const question = this.questionById.get(queue[i]);
      if (!question) continue;
      const remaining = queue.length - i;
      if (answered.has(question.id)) {
        skipped.push({ questionId: question.id, reason: "already_answered" });
        continue;
      }
      if (remaining >= SKIP_MIN_REMAINING && looksAlreadyAnswered(question.question, this.state.recentAnswers)) {
        skipped.push({ questionId: question.id, reason: "covered_in_earlier_answer" });
        continue;
      }
      return { question, skipped };
    }
    return null;
  }

  commitQuestion({ question, skipped }) {
    const drop = new Set([question.id, ...skipped.map((s) => s.questionId)]);
    this.state.questionQueue = this.state.questionQueue.filter((id) => !drop.has(id));
    const at = new Date(this.deps.now()).toISOString();
    for (const s of skipped) {
      this.state.skipped.push({ ...s, at });
      this.deps.log("info", { msg: "question skipped", interviewId: this.interview.id, questionId: s.questionId, reason: s.reason });
    }
    this.state.questionsAsked.push({ questionId: question.id, questionText: question.question, at });
    this.state.currentQuestionId = question.id;
    this.state.currentBaseQuestionId = question.id;
    this.state.currentQuestionText = question.question;
    this.state.currentKind = "question";
    this.state.followUpDepth = 0;
    this.state.followUpContext = null;
    this.state.repeatCount = 0;
    this.state.questionIndex += 1;
  }

  async saveAnswer({ answer, snap, base, answeredAt, declined = false }) {
    const seq = ++this.state.seq;
    const isFollowUp = snap.depth > 0;
    await this.deps.repo.appendTurn(this.interview.id, {
      seq,
      speaker: "candidate",
      kind: "answer",
      questionId: snap.baseQuestionId,
      text: answer,
      startedAt: answeredAt,
      endedAt: new Date(this.deps.now()),
      offsetMs: this.offsetMs(answeredAt.getTime()),
    });
    const responseId = await this.deps.repo.createResponse(this.interview.id, {
      questionId: snap.baseQuestionId,
      questionText: snap.questionText,
      answer,
      isFollowUp,
      followUpDepth: snap.depth,
      followUpReason: isFollowUp ? snap.followUpContext?.reason || null : null,
      answeredAt,
    });
    this.state.questionsAnswered.push({ questionId: snap.baseQuestionId, isFollowUp, at: answeredAt.toISOString() });
    if (answer) {
      this.state.recentAnswers = [...this.state.recentAnswers, answer].slice(-RECENT_ANSWERS);
      this.pushHistory("candidate", answer);
    }
    this.publish({ type: "answer_finalized", responseId, questionId: snap.baseQuestionId, isFollowUp, text: answer });

    // Rule 6.2: score in the background against the base question from the full list
    if (base?.idealAnswer) {
      const question = isFollowUp ? { ...base, question: `${base.question}\nFollow-up asked: ${snap.questionText}` } : base;
      const job = Promise.resolve()
        .then(() => (declined
          ? { score: 0, reasoning: "The candidate declined to answer.", keywordsCovered: [], keywordsMissed: base.expectedKeywords || [], fallback: false }
          : this.deps.score(answer, question)))
        .then(async (result) => {
          if (!result) return;
          await this.deps.repo.updateResponseScore(responseId, result);
          this.publish({ type: "answer_scored", responseId, score: result.score, reasoning: result.reasoning, fallback: Boolean(result.fallback) });
        })
        .catch((error) => this.deps.log("warn", { msg: "scoring failed", interviewId: this.interview.id, error: error.message }))
        .finally(() => this.pendingScores.delete(job));
      this.pendingScores.add(job);
    }
    return responseId;
  }

  async close({ byCandidate = Boolean(this.state.endedByCandidate) } = {}) {
    if (this.ended) return;
    this.clearTimer("silence");
    this.state.stage = "closing";
    this.state.endedByCandidate = byCandidate;
    this.state.currentAnswerBuffer = "";
    await this.persistState();
    await this.speak(byCandidate
      ? { kind: "closing", text: endedByCandidateText(this.textVars()) }
      : { kind: "closing", text: closingText(this.textVars()), cache: true });
  }

  /**
   * Say something: transcript turn, TTS, then `question` (for questions) and `ai_speaking`.
   * The client answers with ai_done_speaking; if it never does, an ack timer continues anyway.
   */
  async speak({ kind, text, questionText = null, cache = false }) {
    const seq = ++this.state.seq;
    const turnId = `t${seq}`;
    const startedAt = new Date(this.deps.now());
    await this.deps.repo.appendTurn(this.interview.id, {
      seq,
      speaker: "ai",
      kind,
      questionId: kind === "question" || kind === "follow_up" ? this.state.currentBaseQuestionId : null,
      text,
      startedAt,
      offsetMs: this.offsetMs(startedAt.getTime()),
    });
    this.pushHistory("interviewer", text);
    this.rememberSpoken(text, questionText);

    let speech = null;
    try {
      speech = await this.deps.tts(text, { cache });
    } catch {
      speech = null; // the browser speaks it instead
    }
    if (this.ended && kind !== "closing") return;
    if (this.paused) return; // re-asked on reconnect

    // Anything heard while we prepared this utterance is barge-in, not part of the next answer
    if (kind === "question" || kind === "follow_up") {
      if (this.state.currentAnswerBuffer) this.sideBuffer = `${this.sideBuffer} ${this.state.currentAnswerBuffer}`.trim();
      this.state.currentAnswerBuffer = "";
      this.clearTimer("silence");
      this.state.stage = "asking";
      this.deps.send("question", { index: this.state.questionIndex, total: this.state.totalQuestions, text: questionText || text, kind });
      this.publish({ type: "question", index: this.state.questionIndex, total: this.state.totalQuestions, text: questionText || text, kind });
    }
    this.currentTurnId = turnId;
    this.isAiSpeaking = true;
    this.deps.send("ai_speaking", {
      turnId,
      kind,
      text,
      audio: speech?.audio ? Buffer.from(speech.audio).toString("base64") : null,
      mime: "audio/wav",
    });
    this.clearTimer("ack");
    const ackMs = (speech?.durationMs || estimateSpeechMs(text)) + ACK_SLACK_MS;
    this.timers.ack = this.deps.setTimeout(() => {
      this.timers.ack = null;
      this.onAiDoneSpeaking(turnId);
    }, ackMs);
  }

  // ───────────────────────────── time budget ─────────────────────────────

  startTicker() {
    this.clearTimer("tick");
    const tick = () => {
      this.timers.tick = null;
      if (this.ended || this.paused) return;
      this.checkTime();
      if (!this.ended) this.timers.tick = this.deps.setTimeout(tick, TICK_MS);
    };
    this.timers.tick = this.deps.setTimeout(tick, TICK_MS);
  }

  checkTime() {
    const remaining = this.remainingMs();
    const crossed = this.warnAt.filter((m) => remaining <= m * 60 * 1000 && !this.state.warningsSent.includes(m));
    if (crossed.length && remaining > 0) {
      // Only the most urgent warning if several thresholds were crossed at once (e.g. after a reconnect)
      const minutes = Math.min(...crossed);
      for (const m of this.warnAt) if (m >= minutes && !this.state.warningsSent.includes(m)) this.state.warningsSent.push(m);
      this.deps.send("time_warning", { minutesLeft: minutes });
    }
    if (remaining > 0) return;

    if (!this.state.timeUpAt) {
      this.state.timeUpAt = this.deps.now();
      this.publish({ type: "status", status: "time_up" });
    }
    if (["closing", "ended"].includes(this.state.stage) || this.isProcessingAnswer) return;
    const graceOver = this.deps.now() - this.state.timeUpAt >= TIME_UP_GRACE_MS;

    if (!this.state.begun) {
      this.close().catch((error) => this.fail(error));
    } else if (this.state.stage === "listening" && !this.isAiSpeaking) {
      // Let the candidate finish the current answer (60 s grace), then close
      if (!this.state.currentAnswerBuffer) this.close().catch((error) => this.fail(error));
      else if (graceOver) this.processAnswer({ trigger: "time_up", force: true }).catch((error) => this.fail(error));
    } else if (graceOver) {
      this.close().catch((error) => this.fail(error));
    }
  }

  // ───────────────────────────── helpers ─────────────────────────────

  rememberSpoken(text, questionText) {
    const at = this.deps.now();
    const entries = [{ text, at }];
    if (questionText && questionText !== text) entries.push({ text: questionText, at });
    this.recentSpoken = [...entries, ...this.recentSpoken].slice(0, RECENT_SPOKEN);
  }

  textVars() {
    return {
      firstName: this.candidateContext?.firstName || "there",
      jobTitle: this.job.title,
      total: this.state.totalQuestions,
      minutes: this.plan.minutes,
    };
  }

  /**
   * Position on the recording. The recorder stops while the candidate is disconnected (a page
   * reload), so time spent disconnected is left out, just like the interview clock.
   */
  offsetMs(at) {
    return this.state.startedAt ? Math.max(0, at - this.state.startedAt - (this.state.pausedMs || 0)) : null;
  }

  pushHistory(role, content) {
    this.state.history = [...this.state.history, { role, content: String(content).slice(0, 500) }].slice(-HISTORY_LIMIT);
  }

  publish(event) {
    try {
      this.deps.publish(event);
    } catch {
      // live view is best-effort
    }
  }

  async persistState() {
    try {
      await this.deps.repo.saveState(this.interview.id, this.serializeState());
    } catch (error) {
      this.deps.log("warn", { msg: "state not saved", interviewId: this.interview.id, error: error.message });
    }
  }

  clearTimer(name) {
    if (this.timers[name]) {
      this.deps.clearTimeout(this.timers[name]);
      this.timers[name] = null;
    }
  }

  fail(error) {
    this.deps.log("error", { msg: "interview loop error", interviewId: this.interview.id, error: error?.message });
    this.deps.send("error", { code: "internal", message: "Something went wrong. Please refresh to continue.", retryable: true });
  }
}
