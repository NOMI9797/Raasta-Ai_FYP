/**
 * Raasta AI Interviewer — interview engine (docs/ai-hiring/09-interview-engine.md).
 *
 * Usage: npm run engine:dev   (tsx watch services/interview-engine/index.js)
 *
 * GET /health and WS /ws?ticket=<jwt>. The ticket is verified on every connection; the
 * session manager then runs the interview (libs/interview/session-engine.js).
 * Runs as a single instance: sessions live in memory (horizontal scaling is out of scope).
 */
import "../../libs/load-env";
import http from "http";
import { WebSocketServer } from "ws";
import { verifyTicket } from "../../libs/interview/tokens";
import { sttProvider } from "../../libs/interview/stt";
import { CLOSE_CODES, MAX_AUDIO_FRAME_BYTES, SessionManager } from "./session-manager";
import { createEngineDeps } from "./deps";

export { CLOSE_CODES };

const PORT = Number(process.env.INTERVIEW_ENGINE_PORT) || 8090;
const MAX_SESSIONS = Number(process.env.INTERVIEW_MAX_SESSIONS) || 20;
const INTERVIEWER_NAME = process.env.INTERVIEWER_NAME || "Raasta AI Interviewer";
const SILENCE_MS = Number(process.env.INTERVIEW_SILENCE_MS) || 8000;
const SNAPSHOT_MS = 15 * 1000;
const DEBUG = process.env.LOG_LEVEL === "debug";

function log(level, fields) {
  if (level === "debug" && !DEBUG) return;
  const line = JSON.stringify({ service: "interview-engine", level, at: new Date().toISOString(), ...fields });
  (level === "error" ? console.error : console.log)(line);
}

const manager = new SessionManager({
  deps: createEngineDeps({ log }),
  maxSessions: MAX_SESSIONS,
  interviewerName: INTERVIEWER_NAME,
  silenceMs: SILENCE_MS,
});

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (req.method === "GET" && pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, activeSessions: manager.activeSessions, stt: sttProvider() }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

// Audio frames are ≤ 64 KB; JSON messages are small
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_AUDIO_FRAME_BYTES });

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
  ws.on("error", (error) => log("warn", { msg: "socket error", interviewId: claims.interviewId, error: error.message }));
  await manager.attach(ws, claims);
});

const snapshotTimer = setInterval(() => {
  manager.snapshotAll().catch((error) => log("warn", { msg: "snapshot failed", error: error.message }));
}, SNAPSHOT_MS);

server.listen(PORT, () => log("info", { msg: "listening", port: PORT, maxSessions: MAX_SESSIONS, stt: sttProvider() }));

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", { msg: `received ${signal}, closing ${manager.activeSessions} session(s)` });
  clearInterval(snapshotTimer);
  setTimeout(() => process.exit(0), 5000).unref();
  try {
    await manager.shutdown();
  } catch (error) {
    log("error", { msg: "shutdown snapshot failed", error: error.message });
  }
  wss.close();
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
