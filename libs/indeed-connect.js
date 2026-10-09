/* global globalThis */
/**
 * Connecting an Indeed account by signing in yourself.
 *
 * Indeed signs people in with an emailed code, Google or Apple (often with a verification check), so there is no
 * email-and-password form to automate. Instead Raasta-AI opens a real browser window on Indeed's sign-in page, the
 * person signs in there, and once the employer area is reached only the resulting session is stored. No Indeed
 * password or code ever passes through Raasta-AI, and nothing is typed or clicked on the person's behalf.
 *
 * The window opens on the machine that runs the server, so this works when Raasta-AI runs on the person's own
 * computer. On a server without a screen it says so and Indeed posts use Copy and open instead.
 *
 * One attempt at a time per person. The attempt lives in memory (a status the page polls); the saved account is
 * the durable result.
 */
import { v4 as uuidv4 } from "uuid";
import { automationLaunchOptions, openWithFallback, withSandbox } from "./browser-launch";
import { IndeedSessionManager } from "./indeed-session";
import { captureSessionFromContext } from "./playwright-utils";
import { INDEED_EMPLOYER_URL, classifyIndeedUrl } from "./indeed-session-validator";

export const CONNECT_STATUS = Object.freeze({
  WAITING: "waiting", // the window is open, the person has not finished signing in
  CONNECTED: "connected",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

export class ConnectError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ConnectError";
    this.code = code;
  }
}

const SIGN_IN_URL = `https://secure.indeed.com/auth?hl=en&continue=${encodeURIComponent(INDEED_EMPLOYER_URL)}`;
const POLL_MS = 2000;
const SETTLE_POLLS = 2; // the employer area must be seen this many polls in a row (not a redirect passing through)
const DEFAULT_WAIT_MINUTES = 5;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const attempts = (globalThis.__raastaIndeedConnects ||= new Map()); // userId -> attempt (survives dev hot reloads)

/** A window can only be shown where there is a screen: always on Windows and macOS, a display server on Linux. */
export function canShowWindow(env = process.env, platform = process.platform) {
  if (env.INDEED_CONNECT_WINDOW === "off") return false;
  return platform !== "linux" || Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

export function waitLimitMs(env = process.env) {
  const minutes = Number(env.INDEED_CONNECT_WAIT_MINUTES);
  return (Number.isFinite(minutes) && minutes >= 1 && minutes <= 30 ? minutes : DEFAULT_WAIT_MINUTES) * 60 * 1000;
}

function publicView(attempt) {
  if (!attempt) return { status: "idle" };
  return {
    id: attempt.id,
    status: attempt.status,
    message: attempt.message,
    email: attempt.email,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt || null,
    waitsUntil: attempt.waitsUntil,
    accountId: attempt.accountId || null,
  };
}

const finish = (attempt, status, message, extra = {}) => {
  if (attempt.status !== CONNECT_STATUS.WAITING) return;
  Object.assign(attempt, { status, message, finishedAt: new Date().toISOString(), ...extra });
};

/**
 * Open the sign-in window: the person's own Chrome (Playwright's Chromium when there is none), not announcing itself as
 * automated, because Cloudflare's check keeps coming back to a window that does (libs/browser-launch.js). Exported for the tests.
 */
export async function openSignInBrowser({ playwright, env = process.env }) {
  const hide = automationLaunchOptions(env);
  const { value } = await openWithFallback((channel) => withSandbox((sandbox) => playwright.chromium.launch({ headless: false, ...hide, ...sandbox, ...(channel ? { channel } : {}) })), env);
  return value;
}

async function runAttempt(attempt, { limitMs, sessions, env = process.env }) {
  let browser;
  try {
    browser = await openSignInBrowser({ playwright: await import("playwright"), env });
    attempt.cancel = () => browser.close().catch(() => {});
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();
    await page.goto(SIGN_IN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

    const deadline = Date.now() + limitMs;
    let signedInPolls = 0;
    while (Date.now() < deadline && attempt.status === CONNECT_STATUS.WAITING) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      if (!browser.isConnected()) {
        finish(attempt, CONNECT_STATUS.CANCELLED, "The window was closed before sign-in finished.");
        return;
      }
      // The person may open Indeed in another tab of the window: any tab in the employer area counts
      const employerPage = context.pages().find((p) => classifyIndeedUrl(p.url()) === "signed_in");
      signedInPolls = employerPage ? signedInPolls + 1 : 0;
      if (signedInPolls < SETTLE_POLLS) continue;

      let captured;
      try {
        captured = await captureSessionFromContext(context, employerPage);
      } catch {
        signedInPolls = 0; // the page was navigating while it was read: look again on the next poll
        continue;
      }
      const saved = await sessions.saveSession(attempt.sessionId, attempt.email, captured.cookies, captured.localStorage, captured.sessionStorage, null, attempt.email, attempt.userId);
      finish(attempt, CONNECT_STATUS.CONNECTED, "Indeed account connected.", { accountId: saved.id, sessionId: saved.sessionId });
      return;
    }
    if (attempt.status === CONNECT_STATUS.WAITING) {
      finish(attempt, CONNECT_STATUS.FAILED, "Sign-in was not finished in time. Start again when you are ready.");
    }
  } catch (error) {
    // A closed window surfaces here as a protocol error; a cancel already set its own message
    finish(attempt, CONNECT_STATUS.FAILED, `Could not connect Indeed: ${String(error.message).split("\n")[0]}`);
  } finally {
    attempt.cancel = null;
    await browser?.close().catch(() => {});
  }
}

/**
 * Open the sign-in window for a person. Returns at once; poll getConnectStatus() for the outcome.
 * Throws ConnectError("invalid_email" | "in_progress" | "no_display").
 */
export function startIndeedConnect({ userId, email, env = process.env, sessions = new IndeedSessionManager(), run = runAttempt }) {
  const label = String(email || "").trim();
  if (!EMAIL.test(label) || label.length > 200) {
    throw new ConnectError("Enter the email address of the Indeed account you will sign in with.", "invalid_email");
  }
  if (attempts.get(userId)?.status === CONNECT_STATUS.WAITING) {
    throw new ConnectError("An Indeed sign-in window is already open. Finish it, or cancel it first.", "in_progress");
  }
  if (!canShowWindow(env)) {
    throw new ConnectError("This server has no screen to open a sign-in window on. Run Raasta-AI on your own computer to connect Indeed, or post to Indeed with Copy and open.", "no_display");
  }

  const limitMs = waitLimitMs(env);
  const attempt = {
    id: uuidv4(),
    sessionId: uuidv4(),
    userId,
    email: label,
    status: CONNECT_STATUS.WAITING,
    message: "A browser window is open on Indeed. Sign in there; this page continues by itself.",
    startedAt: new Date().toISOString(),
    waitsUntil: new Date(Date.now() + limitMs).toISOString(),
    cancel: null,
  };
  attempts.set(userId, attempt);
  run(attempt, { limitMs, sessions, env }).catch((error) => finish(attempt, CONNECT_STATUS.FAILED, error.message));
  return publicView(attempt);
}

export function getConnectStatus(userId) {
  return publicView(attempts.get(userId));
}

/** Close the window and stop waiting. */
export async function cancelIndeedConnect(userId) {
  const attempt = attempts.get(userId);
  if (!attempt || attempt.status !== CONNECT_STATUS.WAITING) return publicView(attempt);
  finish(attempt, CONNECT_STATUS.CANCELLED, "Sign-in was cancelled.");
  await attempt.cancel?.();
  return publicView(attempt);
}
