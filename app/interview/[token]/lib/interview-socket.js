// WebSocket client for the interview engine (protocol: docs/ai-hiring/09-interview-engine.md).
// Each (re)connect gets a fresh ticket from POST /api/interview/[token]/session.
// On an unexpected close it reconnects up to 5 times with backoff; the engine resumes the session.

const MAX_RECONNECTS = 5;
const PING_MS = 15 * 1000;

// Close codes after which reconnecting can't help
export const FATAL_CLOSE = {
  4004: "not_found",
  4009: "duplicate_session",
  4010: "completed",
  4011: "expired",
};

export class SessionError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function requestTicket(token) {
  const res = await fetch(`/api/interview/${encodeURIComponent(token)}/session`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new SessionError(body.error || "Could not start the interview", { code: body.code, status: res.status });
  return body;
}

export class InterviewSocket {
  /**
   * handlers: { onMessage(msg), onStatus(status: 'connecting'|'open'|'reconnecting'|'closed'|'failed', info) }
   */
  constructor(token, handlers) {
    this.token = token;
    this.handlers = handlers;
    this.ws = null;
    this.attempts = 0;
    this.closedByUs = false;
    this.pingTimer = null;
    this.retryTimer = null;
  }

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async connect() {
    this.handlers.onStatus?.(this.attempts ? "reconnecting" : "connecting", { attempt: this.attempts });
    let ticket;
    let wsUrl;
    try {
      ({ ticket, wsUrl } = await requestTicket(this.token));
    } catch (error) {
      // 4xx from the session route (expired, completed, cancelled…) is final
      if (error.status && error.status < 500 && error.status !== 429) {
        this.handlers.onStatus?.("failed", { code: error.code, message: error.message });
        return;
      }
      this.scheduleReconnect();
      return;
    }
    if (this.closedByUs) return;

    // wsUrl from the session route is the full socket URL, already ending in /ws
    const ws = new WebSocket(`${wsUrl}?ticket=${encodeURIComponent(ticket)}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      this.handlers.onStatus?.("open");
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send("ping", { t: Date.now() }), PING_MS);
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        this.handlers.onMessage?.(JSON.parse(event.data));
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = (event) => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closedByUs || event.code === 1000) {
        this.handlers.onStatus?.("closed", { code: event.code });
        return;
      }
      if (FATAL_CLOSE[event.code]) {
        this.handlers.onStatus?.("failed", { code: FATAL_CLOSE[event.code], message: event.reason });
        return;
      }
      this.scheduleReconnect();
    };
  }

  scheduleReconnect() {
    if (this.closedByUs) return;
    if (this.attempts >= MAX_RECONNECTS) {
      this.handlers.onStatus?.("failed", { code: "connection_lost" });
      return;
    }
    this.attempts += 1;
    this.handlers.onStatus?.("reconnecting", { attempt: this.attempts });
    const delay = Math.min(16000, 1000 * 2 ** (this.attempts - 1));
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  send(type, payload = {}) {
    if (!this.isOpen) return false;
    this.ws.send(JSON.stringify({ type, ...payload }));
    return true;
  }

  sendAudio(buffer) {
    // Drop audio when the socket is busy (> 1 s of backlog) rather than building latency
    if (!this.isOpen || this.ws.bufferedAmount > 64 * 1024) return;
    this.ws.send(buffer);
  }

  close() {
    this.closedByUs = true;
    clearInterval(this.pingTimer);
    clearTimeout(this.retryTimer);
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close(1000, "Client closed");
    this.ws = null;
  }
}
