/**
 * Raasta AI Interviewer — interview engine (docs/ai-hiring/09-interview-engine.md).
 *
 * Usage: npm run engine:dev   (tsx watch services/interview-engine/index.js)
 *
 * Phase 0 skeleton: GET /health and WS /ws?ticket=<jwt>, which verifies the ticket and
 * replies session_ready. The interview loop arrives in Phase 5.
 * Runs as a single instance: sessions live in memory.
 */
import "../../libs/load-env";
import http from "http";
import { WebSocketServer } from "ws";
import { verifyTicket } from "../../libs/interview/tokens";
import { DEFAULT_HIRING_CONFIG } from "../../libs/hiring/config";

const PORT = Number(process.env.INTERVIEW_ENGINE_PORT) || 8090;
const MAX_SESSIONS = Number(process.env.INTERVIEW_MAX_SESSIONS) || 20;
const INTERVIEWER_NAME = process.env.INTERVIEWER_NAME || "Raasta AI Interviewer";

export const CLOSE_CODES = {
  BAD_TICKET: 4001,
  NOT_FOUND: 4004,
  DUPLICATE_SESSION: 4009,
  ALREADY_COMPLETED: 4010,
  EXPIRED: 4011,
  TRY_AGAIN_LATER: 1013,
  SERVICE_RESTART: 1012,
};

// interviewId -> WebSocket (one live socket per interview)
const sessions = new Map();

function log(level, fields) {
  const line = JSON.stringify({ service: "interview-engine", level, at: new Date().toISOString(), ...fields });
  (level === "error" ? console.error : console.log)(line);
}

function send(ws, type, payload = {}) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, ...payload }));
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (req.method === "GET" && pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, activeSessions: sessions.size }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (pathname !== "/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

wss.on("connection", async (ws, req) => {
  const ticket = new URL(req.url, "http://localhost").searchParams.get("ticket");

  let claims;
  try {
    claims = await verifyTicket(ticket);
  } catch (error) {
    // Never log the ticket itself
    log("warn", { msg: "rejected connection", reason: error.message });
    ws.close(CLOSE_CODES.BAD_TICKET, error.name === "TicketError" ? error.message : "Invalid ticket");
    return;
  }

  const { interviewId } = claims;
  if (sessions.has(interviewId)) {
    send(ws, "error", { code: "duplicate_session", message: "This interview is already open in another window", retryable: false });
    ws.close(CLOSE_CODES.DUPLICATE_SESSION, "Duplicate session");
    return;
  }
  if (sessions.size >= MAX_SESSIONS) {
    ws.close(CLOSE_CODES.TRY_AGAIN_LATER, "Engine at capacity");
    return;
  }

  sessions.set(interviewId, ws);
  log("info", { msg: "session attached", interviewId, activeSessions: sessions.size });

  // Phase 0: echo session_ready without loading the interview from the database
  send(ws, "session_ready", {
    interviewId,
    resume: false,
    totalQuestions: 0,
    maxMinutes: DEFAULT_HIRING_CONFIG.interviewMaxMinutes,
    interviewerName: INTERVIEWER_NAME,
    jobTitle: null,
  });

  ws.on("message", (data, isBinary) => {
    if (isBinary) return; // microphone audio — handled from Phase 5
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      send(ws, "error", { code: "invalid_state", message: "Messages must be JSON", retryable: false });
      return;
    }
    if (message?.type === "ping") send(ws, "pong", { t: message.t ?? Date.now() });
  });

  ws.on("close", () => {
    if (sessions.get(interviewId) === ws) sessions.delete(interviewId);
    log("info", { msg: "session detached", interviewId, activeSessions: sessions.size });
  });
});

server.listen(PORT, () => log("info", { msg: "listening", port: PORT, maxSessions: MAX_SESSIONS }));

function shutdown(signal) {
  log("info", { msg: `received ${signal}, closing ${sessions.size} session(s)` });
  for (const ws of sessions.values()) ws.close(CLOSE_CODES.SERVICE_RESTART, "Engine restarting");
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
