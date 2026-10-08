/**
 * Hiring Worker — long-running Redis Streams consumer (docs/ai-hiring/13-workers-automation.md).
 *
 * Usage: npm run worker:hiring   (tsx workers/hiring-worker.js)
 *
 * Never log resume text, transcripts, tokens or emails — only job type, id, attempt and timing.
 */
import "../libs/load-env";
import os from "os";
import Redis from "ioredis";
import { getRedisClient, closeRedisConnection } from "../libs/redis";
import { STREAM, DEAD, GROUP, enqueue, moveDueDelayed, parseStreamEntry } from "../libs/hiring/queue";
import { screenCandidate } from "../libs/hiring/fit-scorer";
import { applyShortlist } from "../libs/hiring/shortlist";
import { queueAfterShortlist, notifyScreeningComplete } from "../libs/hiring/shortlist-hooks";
import { acquireQuestionLock, ensureJobQuestions, personaliseCandidate } from "../libs/interview/question-bank";
import { abandonStaleSessions, expireStaleInvites, findDueReminders, sendInvite, sendReminder } from "../libs/hiring/invitations";
import { analyseInterview, assembleRecording, markAnalysisFailed } from "../libs/interview/analysis";
import { finalizeCandidate } from "../libs/hiring/finalize";
import { sendOutcomeEmail } from "../libs/hiring/decisions";
import { advanceRun } from "../libs/agent/recruiter-agent";
import { RUN_STATUS, isJobManagedByAgent, listActiveRecruiterRuns } from "../libs/agent/runs";
import { AGENT_ADVANCE_JOB, requestAgentTick, requestAgentTickForJob } from "../libs/agent/triggers";

// Set by the web server when it runs this worker for you: stop when that server is gone
const PARENT_PID = Number(process.env.HIRING_WORKER_PARENT_PID) || 0;
const PARENT_CHECK_MS = 5 * 1000;
const WORKER_ID = process.env.WORKER_ID || `${os.hostname()}-${process.pid}`;
const CONCURRENCY = Math.max(1, Number(process.env.HIRING_WORKER_CONCURRENCY) || 3);
const MAX_ATTEMPTS = 3; // retries after the first failure before dead-lettering
const READ_BLOCK_MS = 5000;
const DELAYED_INTERVAL_MS = 5000;
const RECLAIM_INTERVAL_MS = 60 * 1000;
const RECLAIM_IDLE_MS = 5 * 60 * 1000;
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 60 * 1000;
const SHORTLIST_DEBOUNCE_MS = 30 * 1000;
const AGENT_SCREEN_DEBOUNCE_MS = 8 * 1000; // applicants screened close together share one agent tick, but nobody waits half a minute
const QUESTION_WAIT_MS = 30 * 1000;   // send-invite waits for ensure-questions
const QUESTION_WAIT_ATTEMPTS = 10;
const ANALYSIS_RETRY_MS = 30 * 1000;  // analyse-interview waits for the recording uploads
const AGENT_TICK_MS = 5 * 60 * 1000;   // one agent tick at a time per run
const AGENT_BUSY_RETRY_MS = 5 * 1000;

function log(level, fields) {
  const line = JSON.stringify({ service: "hiring-worker", level, worker: WORKER_ID, at: new Date().toISOString(), ...fields });
  (level === "error" ? console.error : console.log)(line);
}

// ─── Job handlers ───
// Each handler must be idempotent: it may run more than once for the same job.
export const handlers = {
  ping: {
    timeoutMs: 10 * 1000,
    async run(payload) {
      if (payload?.fail) throw new Error("ping asked to fail");
      return { pong: true };
    },
  },

  // Stage 1: fit score one candidate, then schedule one shortlist run per job.
  // Many screenings finishing close together share a single shortlist-job (debounce lock).
  // A job managed by the supervised agent is shortlisted by the agent instead.
  "screen-candidate": {
    timeoutMs: 60 * 1000,
    async run({ candidateId }) {
      const result = await screenCandidate(candidateId);
      if (result.skipped) return result;
      if (await requestAgentTickForJob(result.jobId, { redis, delayMs: AGENT_SCREEN_DEBOUNCE_MS })) return { ...result, agent: true };
      const acquired = await redis.set(`lock:shortlist-pending:${result.jobId}`, WORKER_ID, "PX", SHORTLIST_DEBOUNCE_MS, "NX");
      if (acquired) {
        await enqueue("shortlist-job", { jobId: result.jobId }, { delayMs: SHORTLIST_DEBOUNCE_MS }, redis);
      }
      return result;
    },
  },

  "shortlist-job": {
    timeoutMs: 60 * 1000,
    async run({ jobId }) {
      if (await isJobManagedByAgent(jobId)) {
        await requestAgentTickForJob(jobId, { redis });
        return { jobId, skipped: "managed by the recruiter agent" };
      }
      const result = await applyShortlist(jobId, { triggeredBy: "system", onShortlisted: queueAfterShortlist });
      await notifyScreeningComplete(result);
      return result;
    },
  },

  // Create the job's question bank if it has none (lock:questions:{jobId} guards concurrent runs)
  "ensure-questions": {
    timeoutMs: 90 * 1000,
    async run({ jobId }) {
      const release = await acquireQuestionLock(jobId, { redis, owner: WORKER_ID });
      if (!release) return { jobId, skipped: "generation already in progress" };
      try {
        return await ensureJobQuestions(jobId);
      } finally {
        await release();
      }
    },
  },

  "personalise-questions": {
    timeoutMs: 60 * 1000,
    async run({ candidateId }) {
      return personaliseCandidate(candidateId);
    },
  },

  // Interview invite. Idempotent: does nothing if an invite is already active (unless resend).
  // If the job's questions aren't ready yet, wait for ensure-questions instead of failing.
  "send-invite": {
    timeoutMs: 30 * 1000,
    async run({ candidateId, resend = false, waits = 0 }) {
      try {
        return await sendInvite(candidateId, { resend });
      } catch (error) {
        if (error?.code === "questions_missing" && waits < QUESTION_WAIT_ATTEMPTS) {
          await enqueue("send-invite", { candidateId, resend, waits: waits + 1 }, { delayMs: QUESTION_WAIT_MS }, redis);
          return { candidateId, waitingForQuestions: true };
        }
        throw error;
      }
    },
  },

  "send-reminder": {
    timeoutMs: 30 * 1000,
    async run({ interviewId }) {
      return sendReminder(interviewId);
    },
  },

  // Stage 2: join the uploaded recording parts (queued when the room uploads its final part)
  "assemble-recording": {
    timeoutMs: 5 * 60 * 1000,
    async run({ interviewId, kind = null }) {
      // strict: a failed join is thrown, so it is retried (or dead-lettered at once when retrying can't help)
      return assembleRecording(interviewId, { kind, strict: true });
    },
  },

  // Stage 2: analyse the recording; waits (re-queues every 30 s) while uploads are finishing
  "analyse-interview": {
    timeoutMs: 15 * 60 * 1000,
    async run({ interviewId, force = false }, { attempt }) {
      // One analysis per interview at a time (e.g. a re-analyse while the first one is running)
      const lockKey = `lock:analyse:${interviewId}`;
      if (!(await redis.set(lockKey, WORKER_ID, "PX", 15 * 60 * 1000, "NX"))) {
        await enqueue("analyse-interview", { interviewId, force }, { delayMs: ANALYSIS_RETRY_MS }, redis);
        return { interviewId, busy: true };
      }
      let result;
      try {
        result = await analyseInterview(interviewId, { force });
      } catch (error) {
        // Last attempt: mark it failed so the recruiter sees it (and can re-analyse)
        if (attempt >= MAX_ATTEMPTS) await markAnalysisFailed(interviewId, error.message);
        throw error;
      } finally {
        if ((await redis.get(lockKey)) === WORKER_ID) await redis.del(lockKey);
      }
      if (result.waiting) {
        await enqueue("analyse-interview", { interviewId, force }, { delayMs: ANALYSIS_RETRY_MS }, redis);
        return { interviewId, waitingForRecording: true };
      }
      if (result.analysis && result.candidateId) {
        await enqueue("finalize-candidate", { candidateId: result.candidateId, interviewId }, {}, redis);
      }
      return { interviewId, skipped: result.skipped, errors: result.analysis?.errors };
    },
  },

  // Stage 2: final score, LLM summary, suggested decision (applied only with autoFinalize)
  "finalize-candidate": {
    timeoutMs: 90 * 1000,
    async run({ candidateId, interviewId }) {
      const result = await finalizeCandidate({ candidateId, interviewId });
      if (result.jobId) await requestAgentTickForJob(result.jobId, { redis });
      return result;
    },
  },

  // Supervised recruiter agent: one tick (libs/agent/recruiter-agent.js). One tick per run at a
  // time; a tick that arrives while another is running is retried shortly after.
  [AGENT_ADVANCE_JOB]: {
    timeoutMs: AGENT_TICK_MS,
    async run({ runId }) {
      const lockKey = `lock:agent:${runId}`;
      if (!(await redis.set(lockKey, WORKER_ID, "PX", AGENT_TICK_MS, "NX"))) {
        await requestAgentTick(runId, { redis, delayMs: AGENT_BUSY_RETRY_MS });
        return { runId, busy: true };
      }
      try {
        return await advanceRun(runId);
      } finally {
        if ((await redis.get(lockKey)) === WORKER_ID) await redis.del(lockKey);
      }
    },
  },

  "send-outcome-email": {
    timeoutMs: 30 * 1000,
    async run({ candidateId }) {
      return sendOutcomeEmail(candidateId);
    },
  },
};

// Periodic maintenance, every SWEEP_INTERVAL_MS. Each sweep is independent: one failing never stops the others.
const sweeps = [
  ["expire invites", async () => {
    const expired = await expireStaleInvites();
    if (expired) log("info", { msg: "invites expired", count: expired });
  }],
  ["queue reminders", async () => {
    const due = await findDueReminders();
    for (const interviewId of due) await enqueue("send-reminder", { interviewId }, {}, redis);
    if (due.length) log("info", { msg: "reminders queued", count: due.length });
  }],
  ["advance recruiter agents", async () => {
    // Catches up on missed events and starts each day's invite allowance
    const runs = (await listActiveRecruiterRuns()).filter((r) => r.status !== RUN_STATUS.PAUSED);
    for (const run of runs) await requestAgentTick(run.id, { redis });
    if (runs.length) log("info", { msg: "agent ticks queued", count: runs.length });
  }],
  ["close stale sessions", async () => {
    const result = await abandonStaleSessions({ enqueueJob: (type, payload) => enqueue(type, payload, {}, redis) });
    if (result.completed || result.abandoned) log("info", { msg: "stale interviews closed", ...result });
  }],
];

// ─── Infrastructure ───
const redis = getRedisClient(); // shared: XADD, XACK, locks
const blocking = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
  : new Redis({
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: null,
    });
blocking.on("error", (error) => log("error", { msg: "blocking redis error", error: error.message }));

let stopping = false;
const inFlight = new Set();
const timers = [];

function withTimeout(promise, ms, type) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${type} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function retryDelayMs(attempt, error) {
  const backoff = 2 ** attempt * 10 * 1000;
  // Respect Groq's retry-after on rate limits
  if (error?.code === "rate_limit" && error.retryAfterMs) return Math.max(backoff, error.retryAfterMs);
  return backoff;
}

async function deadLetter(job, errorMessage) {
  await redis.xadd(
    DEAD, "MAXLEN", "~", 1000, "*",
    "type", job.type || "",
    "payload", JSON.stringify(job.payload ?? {}),
    "attempt", String(job.attempt),
    "originalId", job.id,
    "error", errorMessage.slice(0, 500),
    "failedAt", new Date().toISOString(),
  );
}

// Acknowledge only after the job is done or safely re-queued/dead-lettered.
// If that bookkeeping throws, the message stays pending and reclaimStale() retries it.
async function processJob(job) {
  const started = Date.now();
  const handler = handlers[job.type];

  if (!handler) {
    await deadLetter(job, `Unknown job type: ${job.type}`);
    await redis.xack(STREAM, GROUP, job.id);
    log("error", { type: job.type, id: job.id, attempt: job.attempt, ms: 0, ok: false, error: "unknown job type" });
    return;
  }

  try {
    await withTimeout(handler.run(job.payload, { jobId: job.id, attempt: job.attempt }), handler.timeoutMs || DEFAULT_TIMEOUT_MS, job.type);
    log("info", { type: job.type, id: job.id, attempt: job.attempt, ms: Date.now() - started, ok: true });
  } catch (error) {
    const message = error?.message || String(error);
    // Errors that say they can't succeed on retry (e.g. inviting a rejected candidate) fail straight away
    if (job.attempt < MAX_ATTEMPTS && error?.retryable !== false) {
      const delayMs = retryDelayMs(job.attempt, error);
      await enqueue(job.type, job.payload, { delayMs, attempt: job.attempt + 1 }, redis);
      log("warn", { type: job.type, id: job.id, attempt: job.attempt, ms: Date.now() - started, ok: false, error: message, retryInMs: delayMs });
    } else {
      await deadLetter(job, message);
      log("error", { type: job.type, id: job.id, attempt: job.attempt, ms: Date.now() - started, ok: false, error: message, deadLettered: true });
    }
  }
  await redis.xack(STREAM, GROUP, job.id);
}

function track(job) {
  const promise = processJob(job)
    .catch((error) => log("error", { msg: "job bookkeeping failed", type: job.type, id: job.id, error: error.message }))
    .finally(() => inFlight.delete(promise));
  inFlight.add(promise);
}

async function ensureGroup() {
  try {
    // "0" so jobs queued before the first worker ever started are not skipped
    await redis.xgroup("CREATE", STREAM, GROUP, "0", "MKSTREAM");
  } catch (error) {
    if (!String(error?.message).includes("BUSYGROUP")) throw error;
  }
}

async function readLoop() {
  while (!stopping) {
    const free = CONCURRENCY - inFlight.size;
    if (free <= 0) {
      await Promise.race(inFlight);
      continue;
    }
    let result;
    try {
      result = await blocking.xreadgroup(
        "GROUP", GROUP, WORKER_ID,
        "COUNT", Math.min(5, free),
        "BLOCK", READ_BLOCK_MS,
        "STREAMS", STREAM, ">",
      );
    } catch (error) {
      if (stopping) break;
      log("error", { msg: "read failed", error: error.message });
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }
    // Anything read during shutdown stays pending and is reclaimed by the next worker
    if (!result || stopping) continue;
    for (const [, entries] of result) {
      for (const [id, fields] of entries) track(parseStreamEntry(id, fields));
    }
  }
}

async function reclaimStale() {
  // Recover messages left pending by a crashed worker
  const [, entries] = await redis.xautoclaim(STREAM, GROUP, WORKER_ID, RECLAIM_IDLE_MS, "0-0", "COUNT", 20);
  for (const [id, fields] of entries || []) {
    if (fields) track(parseStreamEntry(id, fields));
  }
}

function every(ms, name, fn) {
  const timer = setInterval(() => {
    if (stopping) return;
    fn().catch((error) => log("error", { msg: `${name} failed`, error: error.message }));
  }, ms);
  timers.push(timer);
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log("info", { msg: `received ${signal}, finishing ${inFlight.size} in-flight job(s)` });
  timers.forEach(clearInterval);
  await Promise.allSettled([...inFlight]);
  blocking.disconnect();
  await closeRedisConnection().catch(() => {});
  log("info", { msg: "stopped" });
  process.exit(0);
}

async function main() {
  await ensureGroup();
  log("info", { msg: "started", concurrency: CONCURRENCY, jobTypes: Object.keys(handlers) });

  every(DELAYED_INTERVAL_MS, "move delayed jobs", () => moveDueDelayed(redis));
  every(RECLAIM_INTERVAL_MS, "reclaim stale jobs", reclaimStale);
  if (PARENT_PID) {
    every(PARENT_CHECK_MS, "web server check", async () => {
      try {
        process.kill(PARENT_PID, 0);
      } catch (error) {
        if (error.code !== "ESRCH") return;
        log("info", { msg: "the web server that started this worker is gone" });
        shutdown("parent exit");
      }
    });
  }
  const runSweeps = async () => {
    for (const [name, sweep] of sweeps) {
      await sweep().catch((error) => log("error", { msg: `sweep "${name}" failed`, error: error.message }));
    }
  };
  every(SWEEP_INTERVAL_MS, "sweep", runSweeps);
  runSweeps(); // once at start-up, so a restarted worker catches up immediately

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await readLoop();
}

main().catch((error) => {
  log("error", { msg: "worker crashed", error: error.message });
  process.exit(1);
});
