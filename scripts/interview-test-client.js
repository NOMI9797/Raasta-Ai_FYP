#!/usr/bin/env node
/**
 * Scripted candidate for the Raasta AI Interviewer (docs/ai-hiring/17-testing.md §3).
 *
 * Connects to the interview engine, sends `ready`, streams fixture WAV answers as PCM16 frames
 * in real time, acknowledges every `ai_speaking`, and prints the conversation.
 *
 *   npx tsx scripts/interview-test-client.js <interviewToken>         # gets a ticket from POST /api/interview/<token>/session (Phase 6)
 *   npx tsx scripts/interview-test-client.js --interview <id>         # dev: signs a ticket locally with INTERVIEW_TICKET_SECRET
 *
 * Options:
 *   --engine ws://localhost:8090   --app http://localhost:8085
 *   --answers q1-strong.wav,q1-weak.wav    answers to play in turn (cycled); names resolve in tests/fixtures/interview/answers/
 *   --no-answer-done             rely on the silence timeout instead of pressing "I've finished"
 *   --disconnect-after <n>       drop the socket in the middle of answer n, reconnect after --reconnect-ms (default 2000)
 *   --talk-during-processing     keep talking right after answer_done (pre-speak guard check)
 *   --speed <x>                  stream faster than real time (default 1)
 *   --quiet                      only print the summary
 * Exit code 0 when interview_complete arrives and no question was spoken twice in a row.
 */
import "../libs/load-env";
import fs from "fs";
import path from "path";
import WebSocket from "ws";
import { signTicket } from "../libs/interview/tokens";

const FIXTURES = path.join(__dirname, "..", "tests", "fixtures", "interview", "answers");
const FRAME_MS = 20;

function parseArgs(argv) {
  const args = { answers: ["q1-strong.wav", "q1-weak.wav", "q2-long-with-pause.wav"], speed: 1, reconnectMs: 2000, answerDone: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--interview") args.interview = next();
    else if (a === "--engine") args.engine = next();
    else if (a === "--app") args.app = next();
    else if (a === "--answers") args.answers = next().split(",");
    else if (a === "--no-answer-done") args.answerDone = false;
    else if (a === "--disconnect-after") args.disconnectAfter = Number(next());
    else if (a === "--reconnect-ms") args.reconnectMs = Number(next());
    else if (a === "--talk-during-processing") args.talkDuringProcessing = true;
    else if (a === "--speed") args.speed = Number(next()) || 1;
    else if (a === "--quiet") args.quiet = true;
    else if (!a.startsWith("--")) args.token = a;
  }
  args.engine = args.engine || process.env.INTERVIEW_ENGINE_WS_URL || `ws://localhost:${process.env.INTERVIEW_ENGINE_PORT || 8090}`;
  args.app = args.app || process.env.NEXTAUTH_URL || "http://localhost:8085";
  return args;
}

function readPcm(file) {
  const buf = fs.readFileSync(path.isAbsolute(file) ? file : path.join(FIXTURES, file));
  let off = 12;
  let format = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") format = { channels: buf.readUInt16LE(off + 10), sampleRate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === "data") {
      if (!format || format.channels !== 1 || format.sampleRate !== 16000 || format.bits !== 16) throw new Error(`${file}: expected 16 kHz mono PCM16`);
      return buf.subarray(off + 8, off + 8 + size);
    }
    off += 8 + size + (size % 2);
  }
  throw new Error(`${file}: no data chunk`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getTicket(args) {
  if (args.interview) {
    // Dev mode: the engine trusts any ticket signed with the shared secret
    const { loadSessionContext } = await import("../libs/interview/repository");
    const ctx = await loadSessionContext(args.interview);
    if (!ctx) throw new Error("Interview not found");
    return { ticket: await signTicket({ interviewId: ctx.interview.id, candidateId: ctx.interview.candidateId }), wsUrl: args.engine };
  }
  if (!args.token) throw new Error("Pass an interview token or --interview <id>");
  const res = await fetch(`${args.app}/api/interview/${encodeURIComponent(args.token)}/session`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ticket) throw new Error(`Session request failed (${res.status}): ${body.error || "no ticket"}`);
  return { ticket: body.ticket, wsUrl: body.wsUrl || args.engine };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const say = (...line) => { if (!args.quiet) console.log(...line); };
  const answers = args.answers.map((name) => ({ name, pcm: readPcm(name) }));
  const ready = readPcm("greeting-ready.wav");

  const summary = { questions: [], latenciesMs: [], answersSent: 0, reconnects: 0, doubleQuestions: 0, errors: [], complete: null };
  let answerIndex = 0;
  let awaitingQuestionSince = null; // set when an answer ended; a question then is expected
  let streaming = null;             // { cancel } while audio is being sent
  let expectQuestion = false;       // false while the candidate is answering → a question now means it was spoken twice
  let done = false;
  let droppedOnce = false;
  let reconnectPending = false;
  let resumed = false;              // the question re-asked after a reconnect is expected

  async function stream(ws, pcm, { cutAtMs = null } = {}) {
    const frameBytes = (16000 * 2 * FRAME_MS) / 1000;
    const state = { cancelled: false };
    if (streaming) streaming.cancelled = true;
    streaming = state;
    const startedAt = Date.now();
    for (let off = 0, n = 0; off < pcm.length; off += frameBytes, n += 1) {
      if (state.cancelled || ws.readyState !== WebSocket.OPEN) return false;
      if (cutAtMs != null && n * FRAME_MS >= cutAtMs) return false;
      ws.send(pcm.subarray(off, off + frameBytes), { binary: true });
      const due = startedAt + ((n + 1) * FRAME_MS) / args.speed;
      const wait = due - Date.now();
      if (wait > 0) await sleep(wait);
    }
    if (streaming === state) streaming = null;
    return true;
  }

  async function answer(ws) {
    const clip = answers[answerIndex % answers.length];
    answerIndex += 1;
    summary.answersSent += 1;
    expectQuestion = false;
    const n = summary.answersSent;
    say(`  → answering with ${clip.name}`);
    if (args.disconnectAfter === n && !droppedOnce) {
      await stream(ws, clip.pcm, { cutAtMs: 2500 });
      say("  ✂ dropping the connection mid-answer");
      droppedOnce = true;
      reconnectPending = true;
      answerIndex -= 1; // answer the re-asked question with the same clip
      ws.terminate();
      return;
    }
    const finished = await stream(ws, clip.pcm);
    if (!finished) return;
    expectQuestion = true;
    awaitingQuestionSince = Date.now();
    if (args.answerDone) ws.send(JSON.stringify({ type: "answer_done" }));
    if (args.talkDuringProcessing) {
      say("  → talking during processing");
      awaitingQuestionSince = null;
      await stream(ws, answers[1 % answers.length].pcm);
      awaitingQuestionSince = Date.now();
      if (args.answerDone) ws.send(JSON.stringify({ type: "answer_done" }));
    }
  }

  function connect(ticket, wsUrl) {
    return new Promise((resolve) => {
      const ws = new WebSocket(`${wsUrl.replace(/\/$/, "")}/ws?ticket=${encodeURIComponent(ticket)}`);
      let greeted = false;
      ws.on("open", () => say("● connected"));
      ws.on("message", async (data, isBinary) => {
        if (isBinary) return;
        const m = JSON.parse(data.toString());
        switch (m.type) {
          case "session_ready":
            say(`● session_ready resume=${m.resume} questions=${m.totalQuestions} maxMinutes=${m.maxMinutes} job="${m.jobTitle}"`);
            ws.send(JSON.stringify({ type: "ready", ua: "interview-test-client", devices: { mic: true, cam: false } }));
            break;
          case "question":
            if (resumed) resumed = false;
            else if (!expectQuestion && summary.questions.length) summary.doubleQuestions += 1;
            if (awaitingQuestionSince) summary.latenciesMs.push(Date.now() - awaitingQuestionSince);
            awaitingQuestionSince = null;
            expectQuestion = false;
            summary.questions.push({ index: m.index, kind: m.kind, text: m.text });
            say(`Q${m.index}/${m.total} [${m.kind}] ${m.text}`);
            break;
          case "ai_speaking": {
            say(`  AI (${m.kind}, audio=${m.audio ? "wav" : "browser"}): ${m.text}`);
            await sleep(200 / args.speed); // "playback"
            ws.send(JSON.stringify({ type: "ai_done_speaking", turnId: m.turnId }));
            if (m.kind === "greeting" && !greeted) {
              greeted = true;
              await sleep(300);
              await stream(ws, ready);
            } else if (m.kind === "question" || m.kind === "follow_up") {
              await sleep(300);
              await answer(ws);
            }
            break;
          }
          case "caption_final":
            say(`  caption: ${m.text}`);
            break;
          case "time_warning":
            say(`  ⏱ ${m.minutesLeft} minute(s) left`);
            break;
          case "interview_complete":
            summary.complete = m.reason;
            say(`● interview_complete (${m.reason})`);
            done = true;
            break;
          case "error":
            summary.errors.push(m.code);
            say(`  ! error ${m.code}: ${m.message}`);
            break;
          default:
        }
      });
      ws.on("close", (code, reason) => {
        if (streaming) streaming.cancelled = true;
        say(`● closed ${code} ${reason}`);
        resolve({ code });
      });
      ws.on("error", (error) => say(`  ! socket error: ${error.message}`));
    });
  }
  const started = Date.now();
  let { ticket, wsUrl } = await getTicket(args);
  for (;;) {
    await connect(ticket, wsUrl);
    if (done || !reconnectPending) break;
    reconnectPending = false;
    await sleep(args.reconnectMs);
    say("● reconnecting");
    resumed = true;
    summary.reconnects += 1;
    ({ ticket, wsUrl } = await getTicket(args));
  }

  summary.durationSec = Math.round((Date.now() - started) / 1000);
  summary.maxLatencyMs = summary.latenciesMs.length ? Math.max(...summary.latenciesMs) : null;
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.complete && summary.doubleQuestions === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
