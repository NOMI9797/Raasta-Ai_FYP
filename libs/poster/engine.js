// The posting engine process (docs/ai-hiring/19, section 5f). It waits for queued posting runs, opens a visible browser
// window with a profile of its own (so a sign-in and a passed check are remembered between runs), fills the platform's form
// in like a person (libs/poster/runner.js), and hands over to the recruiter at every check, sign-in and decision.
// It has to run on the recruiter's own machine: the window opens on that machine's screen, with that machine's address.
// It never logs the job's text, and never stores or types a password: the person signs in in the window.
// Relative imports only.
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { runtimeDir } from "../system/runtime-paths";
import { INDEED_FLOW } from "./flow-indeed";
import { ROZEE_FLOW } from "./flow-rozee";
import { createHuman, speedFrom } from "./human";
import { installPractice } from "./practice";
import { RUN_MODE, RUN_STATUS, initialSteps } from "./run-model";
import { claimNext, createDbReporter, finishRun, isCancelRequested, reapStale, saveProgress } from "./runs";
import { runPosting } from "./runner";
import { onRunFinished } from "./service";
import { createShotStore, pruneShots } from "./shots";

export const FLOWS = Object.freeze({ indeed: INDEED_FLOW, rozee: ROZEE_FLOW });
export const DEFAULT_ENGINE_PORT = 8095;

const POLL_MS = 2000;
const REAP_MS = 30 * 1000;
const HEARTBEAT_MS = 10 * 1000;
const CANCEL_CHECK_MS = 2000;
const LINGER_MS = 4000; // a finished window stays open this long so the person sees where it ended

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const firstLine = (text) => String(text || "").split("\n")[0].trim().slice(0, 300);
const safeName = (text) => String(text || "user").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "user";

export const enginePort = (env = process.env) => {
  const port = Number(env.POSTER_ENGINE_PORT);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_ENGINE_PORT;
};

/** The folder holding a person's browser profile for a platform: the sign-in and the passed checks live here. */
export const profileDirFor = ({ userId, platform, cwd = process.cwd() }) => path.join(runtimeDir(cwd), "poster-profiles", safeName(userId), safeName(platform));

/**
 * Open the visible window. Prefers the browser the person already has (Chrome, or POSTER_BROWSER=msedge), falls back to
 * the one Playwright installs. Stealth measures stay off unless POSTER_STEALTH=true: the first things to try are a visible
 * window with a person and human-like input; stealth is for when a platform challenges those (docs/ai-hiring/19, section 5f).
 */
export async function launchBrowser({ playwright, profileDir, env = process.env }) {
  const stealth = env.POSTER_STEALTH === "true";
  const options = {
    headless: false,
    viewport: null,
    args: stealth ? ["--start-maximized", "--disable-blink-features=AutomationControlled"] : ["--start-maximized"],
    ...(stealth ? { ignoreDefaultArgs: ["--enable-automation"] } : {}),
  };
  const wanted = String(env.POSTER_BROWSER || "chrome").trim().toLowerCase();
  let lastError;
  for (const channel of wanted === "chromium" ? [null] : [wanted, null]) {
    try {
      const context = await playwright.chromium.launchPersistentContext(profileDir, { ...options, ...(channel ? { channel } : {}) });
      return { context, browser: channel || "chromium" };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function defaultLog(level, fields) {
  const line = JSON.stringify({ service: "poster-engine", level, at: new Date().toISOString(), ...fields });
  (level === "error" ? console.error : console.log)(line);
}

/**
 * Start the engine. Returns { engineId, stop() }. Throws when the port is taken (another engine is already running).
 * `deps` is for tests: { playwright, claim, handle }.
 */
export async function startEngine({ env = process.env, log = defaultLog, deps = {} } = {}) {
  const engineId = `${os.hostname()}-${process.pid}`;
  const state = { stopped: false, current: null };

  async function handleRun(run) {
    const flow = FLOWS[run.platform];
    if (!flow) {
      await finishRun(run.id, { status: RUN_STATUS.FAILED, outcome: { code: "unsupported", message: `The posting engine does not post to ${run.platform} yet. Nothing was posted.` } });
      return;
    }
    const practice = run.mode === RUN_MODE.PRACTICE; // the practice site stands in for the platform: no account, no network
    const shots = createShotStore({ runId: run.id, env });
    const reporter = createDbReporter({ run, shots, log: (text) => log("warn", { runId: run.id, text }) });
    reporter.state.steps = initialSteps(flow);
    reporter.status(RUN_STATUS.RUNNING);

    let context = null;
    let result;
    const timers = [];
    try {
      const playwright = deps.playwright || (await import("playwright"));
      const launched = await launchBrowser({ playwright, profileDir: profileDirFor({ userId: run.userId, platform: practice ? `practice-${run.platform}` : run.platform }), env });
      context = launched.context;
      if (practice) await installPractice(context, run.platform, { check: Boolean(run.kit?.options?.practiceCheck) });
      state.current = { id: run.id, context };
      log("info", { event: "run_started", runId: run.id, platform: run.platform, mode: run.mode, browser: launched.browser });
      // A cancel closes the window, which ends whatever the run is doing at that moment
      timers.push(setInterval(async () => {
        try {
          if (await isCancelRequested(run.id)) await context.close();
        } catch {
          /* asked again on the next tick */
        }
      }, CANCEL_CHECK_MS));
      timers.push(setInterval(() => saveProgress(run.id, {}).catch(() => {}), HEARTBEAT_MS));

      const page = context.pages()[0] || (await context.newPage());
      result = await runPosting({ page, flow, kit: run.kit, mode: run.mode, reporter, human: createHuman({ speed: speedFrom(env.POSTER_TYPING_SPEED) }) });
      if (practice && result.status === RUN_STATUS.PUBLISHED) {
        result = { status: RUN_STATUS.PUBLISHED, outcome: { code: "practice", message: `Practice finished: the form was filled in, you pressed ${flow.confirmLabel || "Confirm"}, and the practice site took it from there. Nothing was posted anywhere.`, verification: result.outcome?.verification } };
      }
    } catch (error) {
      log("error", { event: "run_error", runId: run.id, error: firstLine(error.message) });
      result = { status: RUN_STATUS.FAILED, outcome: { code: "engine_error", message: `${firstLine(error.message) || "The engine could not start the window"}. Nothing was posted.` } };
    } finally {
      timers.forEach(clearInterval);
    }

    await reporter.flush();
    try {
      await onRunFinished({ run, result });
    } catch (error) {
      log("error", { event: "record_failed", runId: run.id, error: firstLine(error.message) });
      result = { ...result, outcome: { ...result.outcome, message: `${result.outcome?.message || ""} The job's history could not be updated: ${firstLine(error.message)}`.trim() } };
    }
    await finishRun(run.id, result);
    log("info", { event: "run_finished", runId: run.id, status: result.status, code: result.outcome?.code || null });
    if (context) {
      if ([RUN_STATUS.PUBLISHED, RUN_STATUS.REHEARSED].includes(result.status)) await sleep(LINGER_MS);
      await context.close().catch(() => {});
    }
    state.current = null;
    await pruneShots({ env });
  }

  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (req.method === "GET" && pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      // `modes` and `platforms` let the web app refuse to queue a run that an older engine, still running, does not know (it would mistake
      // a practice run for a real post)
      res.end(JSON.stringify({ ok: true, engineId, busy: Boolean(state.current), runId: state.current?.id || null, modes: Object.values(RUN_MODE), platforms: Object.keys(FLOWS) }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", (error) => reject(error.code === "EADDRINUSE" ? new Error(`Port ${enginePort(env)} is taken: another posting engine is probably already running.`) : error));
    server.listen(enginePort(env), "127.0.0.1", resolve);
  });

  await (deps.reap || reapStale)().catch((error) => log("warn", { event: "reap_failed", error: firstLine(error.message) }));
  log("info", { event: "started", engineId, port: enginePort(env) });

  const loop = (async () => {
    let lastReap = Date.now();
    while (!state.stopped) {
      try {
        const run = await (deps.claim || claimNext)({ engineId });
        if (run) {
          await (deps.handle || handleRun)(run);
          continue;
        }
        if (Date.now() - lastReap > REAP_MS) {
          lastReap = Date.now();
          await (deps.reap || reapStale)();
        }
      } catch (error) {
        log("error", { event: "loop_error", error: firstLine(error.message) });
      }
      await sleep(POLL_MS);
    }
  })();

  return {
    engineId,
    async stop() {
      state.stopped = true;
      await state.current?.context?.close().catch(() => {});
      await new Promise((resolve) => server.close(resolve));
      await loop;
    },
  };
}
