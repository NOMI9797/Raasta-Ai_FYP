// Live interview sessions, one per interview, held in memory (docs/ai-hiring/09-interview-engine.md).
// Owns the socket ↔ InterviewSession ↔ STT wiring, reconnects within the resume window, periodic
// state snapshots and shutdown. Every external dependency is injected (see deps.js), so the
// manager is tested without a database, Redis or network.
// Relative imports only.
import { InterviewSession } from "../../libs/interview/session-engine";
import { INTERVIEW_STATUS } from "../../libs/hiring/statuses";
import { getHiringConfig } from "../../libs/hiring/config";
import { toCandidateContext, toRoleContext, toSessionQuestions } from "../../libs/interview/mappers";
import { cleanTranscript } from "../../libs/interview/stt/clean";

export const CLOSE_CODES = {
  NORMAL: 1000,
  INTERNAL: 1011,
  SERVICE_RESTART: 1012,
  TRY_AGAIN_LATER: 1013,
  BAD_TICKET: 4001,
  NOT_FOUND: 4004,
  DUPLICATE_SESSION: 4009,
  ALREADY_COMPLETED: 4010,
  EXPIRED: 4011,
};

export const MAX_AUDIO_FRAME_BYTES = 64 * 1024;
const MAX_MESSAGES_PER_SECOND = 200;   // audio frames arrive at 10–50 per second
const KEEPALIVE_MS = 5000;
const FLUSH_TIMEOUT_MS = 2500;
const CLOSE_AFTER_COMPLETE_MS = 1500;
const CLIENT_TYPES = new Set(["ready", "begin", "ai_done_speaking", "answer_done", "repeat_question", "end_interview", "client_event", "ping"]);

function sendJson(ws, type, payload = {}) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type, ...payload }));
}

function sanitizeClientInfo(message) {
  const devices = message?.devices && typeof message.devices === "object" ? message.devices : {};
  return {
    ua: typeof message?.ua === "string" ? message.ua.slice(0, 300) : null,
    devices: { mic: Boolean(devices.mic), cam: Boolean(devices.cam) },
  };
}

export class SessionManager {
  /**
   * deps: {
   *   repo: { loadSessionContext, ensureQuestionSnapshot, markStarted, appendTurn, createResponse,
   *           updateResponseScore, saveState, recordIntegrityEvent, complete, abandon },
   *   analyze, score, followUp, tts, createStt, publish(interviewId, event), enqueue(type, payload),
   *   log(level, fields), now, setTimeout, clearTimeout, setInterval, clearInterval
   * }
   */
  constructor({ deps, maxSessions = 20, interviewerName = "Raasta AI Interviewer", silenceMs = 8000 } = {}) {
    this.deps = {
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (t) => clearTimeout(t),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (t) => clearInterval(t),
      log: () => {},
      ...deps,
    };
    this.maxSessions = maxSessions;
    this.interviewerName = interviewerName;
    this.silenceMs = silenceMs;
    this.sessions = new Map(); // interviewId -> entry
    this.attaching = new Set();
  }

  get activeSessions() {
    return this.sessions.size;
  }

  /** A verified ticket's socket: resume the in-memory session or create one from the database. */
  async attach(ws, { interviewId, candidateId }) {
    const existing = this.sessions.get(interviewId);
    if (this.attaching.has(interviewId) || (existing && existing.ws)) {
      sendJson(ws, "error", { code: "duplicate_session", message: "This interview is already open in another window.", retryable: false });
      ws.close(CLOSE_CODES.DUPLICATE_SESSION, "Duplicate session");
      return null;
    }

    if (existing) {
      // Reconnect within the resume window
      if (existing.candidateId !== candidateId) {
        ws.close(CLOSE_CODES.BAD_TICKET, "Ticket does not match this interview");
        return null;
      }
      this.deps.clearTimeout(existing.abandonTimer);
      existing.abandonTimer = null;
      this.bindSocket(existing, ws);
      this.sendReady(existing, true);
      this.deps.log("info", { msg: "session reattached", interviewId });
      return existing;
    }

    if (this.sessions.size >= this.maxSessions) {
      sendJson(ws, "error", { code: "internal", message: "The interviewer is busy. Please try again in a minute.", retryable: true });
      ws.close(CLOSE_CODES.TRY_AGAIN_LATER, "Engine at capacity");
      return null;
    }

    this.attaching.add(interviewId);
    try {
      const ctx = await this.deps.repo.loadSessionContext(interviewId);
      if (!ctx) {
        ws.close(CLOSE_CODES.NOT_FOUND, "Interview not found");
        return null;
      }
      const { interview, job, candidate } = ctx;
      if (interview.candidateId !== candidateId) {
        ws.close(CLOSE_CODES.BAD_TICKET, "Ticket does not match this interview");
        return null;
      }
      const status = interview.status;
      const notStarted = status === INTERVIEW_STATUS.INVITED || status === INTERVIEW_STATUS.OPENED;
      if (status === INTERVIEW_STATUS.EXPIRED || (notStarted && new Date(interview.expiresAt) <= new Date(this.deps.now()))) {
        sendJson(ws, "error", { code: "expired", message: "This interview link has expired.", retryable: false });
        ws.close(CLOSE_CODES.EXPIRED, "Interview expired");
        return null;
      }
      if (status !== INTERVIEW_STATUS.OPENED && status !== INTERVIEW_STATUS.IN_PROGRESS) {
        sendJson(ws, "error", { code: "invalid_state", message: "This interview is no longer available.", retryable: false });
        ws.close(CLOSE_CODES.ALREADY_COMPLETED, "Interview already completed");
        return null;
      }

      const snapshot = await this.deps.repo.ensureQuestionSnapshot(interview);
      const questions = toSessionQuestions(snapshot.map((q, i) => ({ ...q, orderIndex: i })));
      if (!questions.length) {
        sendJson(ws, "error", { code: "internal", message: "This interview has no questions yet. Please try again later.", retryable: true });
        ws.close(CLOSE_CODES.INTERNAL, "No questions");
        return null;
      }

      const config = getHiringConfig(job);
      const state = interview.state && typeof interview.state === "object" ? interview.state : null;
      // A saved state without pausedAt means the engine stopped mid-interview: the clock was frozen at the last activity
      const pausedAt = state ? state.pausedAt || interview.lastActivityAt || state.savedAt || null : null;
      const entry = {
        interviewId,
        candidateId,
        ws: null,
        stt: null,
        sttReconnects: 0,
        readyOnSocket: false,
        abandonTimer: null,
        keepAliveTimer: null,
        rate: { windowStart: 0, count: 0 },
        resumeWindowMs: config.resumeWindowMinutes * 60 * 1000,
        session: null,
      };
      entry.session = new InterviewSession({
        interview: { ...interview, totalQuestions: questions.length },
        job,
        candidate,
        questions,
        config: { maxFollowUps: config.maxFollowUps, interviewMaxMinutes: config.interviewMaxMinutes, silenceMs: this.silenceMs, interviewerName: this.interviewerName },
        candidateContext: toCandidateContext(candidate),
        roleContext: toRoleContext(job),
        state,
        pausedAt,
        deps: this.sessionDeps(entry),
      });
      this.sessions.set(interviewId, entry);
      this.bindSocket(entry, ws);
      this.sendReady(entry, Boolean(state?.hasGreeted));
      this.deps.log("info", { msg: "session attached", interviewId, resume: Boolean(state?.hasGreeted), activeSessions: this.sessions.size });
      return entry;
    } catch (error) {
      this.deps.log("error", { msg: "attach failed", interviewId, error: error.message });
      sendJson(ws, "error", { code: "internal", message: "Could not start the interview. Please try again.", retryable: true });
      ws.close(CLOSE_CODES.INTERNAL, "Internal error");
      return null;
    } finally {
      this.attaching.delete(interviewId);
    }
  }

  sessionDeps(entry) {
    const { repo } = this.deps;
    return {
      analyze: this.deps.analyze,
      score: this.deps.score,
      followUp: this.deps.followUp,
      tts: this.deps.tts,
      repo: {
        markStarted: repo.markStarted,
        appendTurn: repo.appendTurn,
        createResponse: repo.createResponse,
        updateResponseScore: repo.updateResponseScore,
        saveState: repo.saveState,
        recordIntegrityEvent: repo.recordIntegrityEvent,
        complete: repo.complete,
        abandon: repo.abandon,
      },
      send: (type, payload) => sendJson(entry.ws, type, payload),
      publish: (event) => this.deps.publish(entry.interviewId, event),
      enqueue: this.deps.enqueue,
      onEnded: (result) => this.onSessionEnded(entry, result),
      now: this.deps.now,
      setTimeout: this.deps.setTimeout,
      clearTimeout: this.deps.clearTimeout,
      log: this.deps.log,
    };
  }

  sendReady(entry, resume) {
    const { session } = entry;
    sendJson(entry.ws, "session_ready", {
      interviewId: entry.interviewId,
      resume,
      totalQuestions: session.state.totalQuestions,
      maxMinutes: Math.round(session.config.maxMs / 60000),
      interviewerName: this.interviewerName,
      jobTitle: session.job.title,
      // For the room's countdown; time spent disconnected is not counted
      remainingSec: Math.max(0, Math.round(session.remainingMs() / 1000)),
    });
  }

  bindSocket(entry, ws) {
    entry.ws = ws;
    entry.readyOnSocket = false;
    entry.rate = { windowStart: 0, count: 0 };
    ws.on("message", (data, isBinary) => {
      if (entry.ws !== ws) return;
      this.handleMessage(entry, data, isBinary).catch((error) => {
        this.deps.log("error", { msg: "message handling failed", interviewId: entry.interviewId, error: error.message });
        sendJson(ws, "error", { code: "internal", message: "Something went wrong.", retryable: true });
      });
    });
    ws.on("close", () => this.detach(entry.interviewId, ws));
  }

  overRateLimit(entry) {
    const now = this.deps.now();
    if (now - entry.rate.windowStart >= 1000) entry.rate = { windowStart: now, count: 0 };
    entry.rate.count += 1;
    return entry.rate.count > MAX_MESSAGES_PER_SECOND;
  }

  async handleMessage(entry, data, isBinary) {
    if (this.overRateLimit(entry)) return;
    const { session } = entry;

    if (isBinary) {
      if (!entry.readyOnSocket || !entry.stt || data.length > MAX_AUDIO_FRAME_BYTES || data.length % 2 !== 0) return;
      entry.stt.write(data);
      return;
    }

    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      sendJson(entry.ws, "error", { code: "invalid_state", message: "Messages must be JSON.", retryable: false });
      return;
    }
    if (!message || !CLIENT_TYPES.has(message.type)) return;

    switch (message.type) {
      case "ping":
        sendJson(entry.ws, "pong", { t: message.t ?? this.deps.now() });
        return;
      case "ready": {
        if (entry.readyOnSocket) return;
        entry.readyOnSocket = true;
        this.openStt(entry);
        this.startKeepAlive(entry);
        await session.start({ resume: Boolean(session.state.hasGreeted), clientInfo: sanitizeClientInfo(message) });
        return;
      }
      case "begin":
        if (entry.readyOnSocket) session.onBegin();
        return;
      case "ai_done_speaking":
        session.onAiDoneSpeaking(message.turnId);
        return;
      case "answer_done":
        if (!entry.readyOnSocket) return;
        // Let STT finish the words still in flight before finalising the answer
        if (entry.stt?.flush) await this.withTimeout(entry.stt.flush(), FLUSH_TIMEOUT_MS);
        session.onAnswerDone();
        return;
      case "repeat_question":
        session.onRepeatQuestion();
        return;
      case "end_interview":
        if (entry.readyOnSocket) await session.onEndRequest({ source: "button" });
        return;
      case "client_event":
        session.onClientEvent({ event: message.event, at: message.at });
        return;
      default:
    }
  }

  openStt(entry) {
    this.closeStt(entry);
    const { session } = entry;
    const stt = this.deps.createStt({
      onPartial: (text) => session.onSttPartial(text),
      // Speech models invent text on silence and noise; only real words reach the interview
      onFinal: (text, timing) => {
        const cleaned = cleanTranscript(text);
        if (cleaned) session.onSttFinal(cleaned, timing);
      },
      onActivity: () => session.onSpeechActivity(),
      onError: (error) => {
        this.deps.log("warn", { msg: "stt error", interviewId: entry.interviewId, error: error?.message });
      },
      onClose: (info) => {
        if (entry.stt !== stt) return;
        entry.stt = null;
        if (!info?.unexpected || !entry.ws) return;
        if (entry.sttReconnects < 1) {
          entry.sttReconnects += 1;
          this.deps.log("warn", { msg: "stt closed unexpectedly, reconnecting", interviewId: entry.interviewId });
          this.openStt(entry);
        } else {
          sendJson(entry.ws, "error", { code: "stt_unavailable", message: "Speech recognition is unavailable. Please refresh the page.", retryable: true });
        }
      },
    });
    entry.stt = stt;
  }

  closeStt(entry) {
    const stt = entry.stt;
    entry.stt = null;
    if (stt) stt.close().catch(() => {});
  }

  startKeepAlive(entry) {
    this.deps.clearInterval(entry.keepAliveTimer);
    entry.keepAliveTimer = this.deps.setInterval(() => entry.stt?.keepAlive(), KEEPALIVE_MS);
  }

  /**
   * Socket closed. A finished session is dropped; otherwise it is paused and kept for the
   * resume window, then ended as abandoned (or completed when ≥ 50% was answered).
   */
  detach(interviewId, ws) {
    const entry = this.sessions.get(interviewId);
    if (!entry || entry.ws !== ws) return;
    entry.ws = null;
    entry.readyOnSocket = false;
    this.closeStt(entry);
    this.deps.clearInterval(entry.keepAliveTimer);
    entry.keepAliveTimer = null;

    if (entry.session.ended) {
      this.sessions.delete(interviewId);
      return;
    }
    entry.session.pause();
    this.deps.repo.saveState(interviewId, entry.session.serializeState())
      .catch((error) => this.deps.log("warn", { msg: "state not saved on disconnect", interviewId, error: error.message }));
    this.deps.log("info", { msg: "session detached", interviewId, resumeWindowMs: entry.resumeWindowMs });

    entry.abandonTimer = this.deps.setTimeout(() => {
      entry.abandonTimer = null;
      if (entry.ws) return;
      this.sessions.delete(interviewId);
      entry.session.end("abandoned").catch((error) => this.deps.log("error", { msg: "abandon failed", interviewId, error: error.message }));
    }, entry.resumeWindowMs);
  }

  onSessionEnded(entry) {
    this.closeStt(entry);
    this.deps.clearInterval(entry.keepAliveTimer);
    entry.keepAliveTimer = null;
    const ws = entry.ws;
    // Give the client a moment to receive interview_complete, then close
    this.deps.setTimeout(() => {
      if (ws && ws.readyState === 1) ws.close(CLOSE_CODES.NORMAL, "Interview complete");
      if (this.sessions.get(entry.interviewId) === entry) this.sessions.delete(entry.interviewId);
    }, CLOSE_AFTER_COMPLETE_MS);
  }

  /** Every 15 s: persist each live session's state (resume after a crash). */
  async snapshotAll() {
    await Promise.allSettled([...this.sessions.values()]
      .filter((entry) => !entry.session.ended && entry.session.state.startedAt)
      .map((entry) => this.deps.repo.saveState(entry.interviewId, entry.session.serializeState())));
  }

  /** SIGTERM: snapshot every session (paused, so the clock stops), then close sockets with 1012. */
  async shutdown() {
    for (const entry of this.sessions.values()) {
      this.deps.clearTimeout(entry.abandonTimer);
      this.deps.clearInterval(entry.keepAliveTimer);
      this.closeStt(entry);
      if (!entry.session.ended) entry.session.pause();
    }
    await this.snapshotAll();
    for (const entry of this.sessions.values()) {
      if (entry.ws && entry.ws.readyState === 1) entry.ws.close(CLOSE_CODES.SERVICE_RESTART, "Engine restarting");
    }
    this.sessions.clear();
  }

  withTimeout(promise, ms) {
    return new Promise((resolve) => {
      const timer = this.deps.setTimeout(resolve, ms);
      Promise.resolve(promise).catch(() => {}).finally(() => {
        this.deps.clearTimeout(timer);
        resolve();
      });
    });
  }
}
