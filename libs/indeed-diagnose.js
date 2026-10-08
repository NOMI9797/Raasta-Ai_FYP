/* global globalThis */
/**
 * Indeed diagnostics: a read-only visit that shows what the automation sees.
 *
 * It opens the employer area with a connected account's saved session, looks for the "Post a job" entry, follows it
 * and records every page on the way (screenshot, structure, console and network errors; libs/indeed-debug.js).
 * It never fills in or submits anything. It exists because Indeed's pages cannot be mapped from outside a sign-in:
 * run it, then read the recorded structure to write or repair the publisher.
 *
 * It behaves like a person opening the dashboard once: one run per account at a time, and a pause between runs.
 * A verification page or a sign-in page stops it at once; nothing is worked around.
 */
import { DebugRecorder, botCheckSeen } from "./indeed-debug";
import { canShowWindow } from "./indeed-connect";
import { classifyIndeedUrl, cleanupBrowserSession, pageShowsCheck, testIndeedSession, waitForCheckToClear } from "./indeed-session-validator";

export const DIAGNOSE_BRAKE_MS = 60 * 1000;
const POST_ENTRY = /post (a )?job/i;
// How long to wait for the entry link, for a page to render after a click, and for it to settle, and (with the window
// shown) how long to keep the last page up so it can be read. Tests shorten them.
const TIMING = { entry: 8000, render: 3000, settle: 1500, idle: 10000, hold: 8000, poll: 2000, popup: 1000 };

const state = (globalThis.__raastaIndeedDiagnose ||= { busy: new Set(), last: new Map() });

export class DiagnoseError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "DiagnoseError";
    this.code = code;
  }
}

export const OUTCOME_MESSAGES = Object.freeze({
  reached_post_page: "Reached the Post a job page. The saved structure lists its buttons and fields.",
  no_form_found: "Followed Post a job, but no form fields appeared. The screenshots show what the page looked like.",
  no_post_entry: "Signed in, but no Post a job link or button was found on the employer home. The screenshot shows the page.",
  session_expired: "Indeed sent the saved session back to its sign-in page. Reconnect the account.",
  challenge: "Indeed showed a verification check. Open Indeed yourself to confirm it, then reconnect the account. Nothing else was tried.",
  error: "The diagnostic could not finish.",
});

/** How long, with the window shown, to wait for a person to clear a verification check (INDEED_CHECK_WAIT_SECONDS, 10 to 600). */
export function checkWaitMs(env = process.env) {
  const seconds = Number(env.INDEED_CHECK_WAIT_SECONDS);
  return (Number.isFinite(seconds) && seconds >= 10 && seconds <= 600 ? seconds : 180) * 1000;
}

/** What a verification check means for the recruiter, said as plainly as the evidence allows. */
export function challengeMessage({ botCheck, visible, waitedMs }) {
  if (!botCheck) return OUTCOME_MESSAGES.challenge;
  const stopped = "Nothing was tried past it: the diagnostic only waits for a person to clear a check.";
  if (!visible) {
    return `Indeed's Cloudflare bot check blocked the hidden browser: the first page answered HTTP 403 and asked for a check, so there was no employer page to read. ${stopped} Run the diagnostic again with the browser window shown and let the check finish (a visible window with a person present has passed it).`;
  }
  return `Indeed's Cloudflare bot check was still showing after ${Math.round(waitedMs / 1000)} seconds (or the window was closed). If you cleared it and the page did not carry on, tell the developer: the Ray ID printed on the check page helps. ${stopped} Use Copy and open for now.`;
}

/** Follow the Post a job entry from the employer home. Returns the outcome and the page it ended on. */
async function walkToPostPage({ page, context, recorder, timing = TIMING, waitForCheckMs = 0 }) {
  const entry = page.getByRole("link", { name: POST_ENTRY }).or(page.getByRole("button", { name: POST_ENTRY })).first();
  const found = await entry.waitFor({ state: "visible", timeout: timing.entry }).then(() => true).catch(() => false);
  if (!found) {
    recorder.note("post-entry", "No visible link or button named like \"Post a job\" on the employer home");
    return { outcome: "no_post_entry", page };
  }
  const label = (await entry.innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 60);
  recorder.note("post-entry", `Found "${label}". Following it: navigation only, nothing is filled in or submitted`);

  // The entry may open in a new tab: note one if it appears while the click settles, without waiting for one that never comes
  let popup = null;
  const onPage = (opened) => { popup = opened; };
  context.on("page", onPage);
  await entry.click({ timeout: 10000 });
  await page.waitForTimeout(timing.popup);
  context.off("page", onPage);
  const target = popup || page;
  if (popup) recorder.attach(popup);

  await target.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
  await target.waitForTimeout(timing.render);
  await recorder.snap(target, "after-post-a-job", { note: popup ? "opened in a new tab" : null, inline: true });
  await target.waitForLoadState("networkidle", { timeout: timing.idle }).catch(() => {});
  await target.waitForTimeout(timing.settle);
  let settled = await recorder.snap(target, "post-page-settled", { inline: true });

  let kind = classifyIndeedUrl(target.url());
  if ((await pageShowsCheck(target)) && waitForCheckMs > 0) {
    recorder.note("waiting-for-you", `Indeed shows a verification check. Waiting up to ${Math.round(waitForCheckMs / 1000)} seconds for you to clear it in the window; nothing is clicked for you`);
    const waited = await waitForCheckToClear(target, { timeoutMs: waitForCheckMs, pollMs: timing.poll });
    if (waited.cleared) await target.waitForTimeout(timing.render);
    settled = await recorder.snap(target, waited.cleared ? "check-cleared" : "check-not-cleared", { inline: true });
    kind = classifyIndeedUrl(target.url());
  }
  if (await pageShowsCheck(target)) return { outcome: "challenge", page: target };
  if (kind === "login") return { outcome: "session_expired", page: target };
  return { outcome: (settled.summary?.fields || 0) > 0 ? "reached_post_page" : "no_form_found", page: target };
}

/**
 * Run the diagnostic for one account. Resolves with
 *   { runId, location, outcome, message, steps, console, pageErrors, failedRequests }
 * (steps carry `dataUri` screenshots for showing in the UI). Throws DiagnoseError("busy" | "too_soon" | "no_display").
 * `deps` lets tests replace the browser and shorten the waits: { testSession, now, timing }.
 */
export async function diagnoseIndeed(account, { visible = false, env = process.env, deps = {} } = {}) {
  const key = account.id || account.sessionId;
  const now = deps.now ? deps.now() : Date.now();
  if (visible && !canShowWindow(env)) {
    throw new DiagnoseError("This server has no screen to show a browser window on. Run the diagnostic without the window.", "no_display");
  }
  if (state.busy.has(key)) throw new DiagnoseError("A diagnostic is already running for this account.", "busy");
  const wait = DIAGNOSE_BRAKE_MS - (now - (state.last.get(key) || 0));
  if (wait > 0) {
    throw new DiagnoseError(`Wait ${Math.ceil(wait / 1000)} seconds before running another diagnostic on this account. Indeed should see it as a person looking around, not a loop.`, "too_soon");
  }

  state.busy.add(key);
  const recorder = new DebugRecorder({ label: "diagnose", env });
  const openSession = deps.testSession || testIndeedSession;
  let check;
  try {
    const waitMs = visible ? checkWaitMs(env) : 0;
    check = await openSession(account, true, { recorder, visible, waitForCheckMs: waitMs });
    let outcome;
    if (!check.isValid) {
      outcome = check.challenge ? "challenge" : /redirected to Indeed sign-in/.test(check.reason || "") ? "session_expired" : "error";
      if (outcome === "error") recorder.note("session", check.reason);
    } else {
      ({ outcome } = await walkToPostPage({ page: check.page, context: check.context, recorder, timing: { ...TIMING, ...deps.timing }, waitForCheckMs: waitMs }));
      if (visible) await check.page.waitForTimeout({ ...TIMING, ...deps.timing }.hold).catch(() => {});
    }
    const message = outcome === "challenge" ? challengeMessage({ botCheck: botCheckSeen(recorder.failedRequests), visible, waitedMs: waitMs }) : OUTCOME_MESSAGES[outcome];
    const trace = await recorder.finish({ outcome, message });
    return {
      runId: recorder.runId,
      location: recorder.location,
      outcome,
      message,
      steps: recorder.steps,
      console: trace.console,
      pageErrors: trace.pageErrors,
      failedRequests: trace.failedRequests,
    };
  } catch (error) {
    recorder.note("error", String(error.message).split("\n")[0]);
    const message = `${OUTCOME_MESSAGES.error} ${String(error.message).split("\n")[0]}`;
    await recorder.finish({ outcome: "error", message });
    return { runId: recorder.runId, location: recorder.location, outcome: "error", message, steps: recorder.steps, console: recorder.console, pageErrors: recorder.pageErrors, failedRequests: recorder.failedRequests };
  } finally {
    await cleanupBrowserSession(check?.context);
    state.busy.delete(key);
    state.last.set(key, deps.now ? deps.now() : Date.now());
  }
}
