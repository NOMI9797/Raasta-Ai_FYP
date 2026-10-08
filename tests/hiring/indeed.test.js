import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIndeedUrl, looksLikeChallenge } from "../../libs/indeed-session-validator";
import {
  CONNECT_STATUS, ConnectError, cancelIndeedConnect, canShowWindow, getConnectStatus, startIndeedConnect, waitLimitMs,
} from "../../libs/indeed-connect";

test("urls: the employer area is signed in; Indeed's sign-in page and verification pages are not", () => {
  assert.equal(classifyIndeedUrl("https://employers.indeed.com/"), "signed_in");
  assert.equal(classifyIndeedUrl("https://employers.indeed.com/jobs"), "signed_in");
  assert.equal(classifyIndeedUrl("https://secure.indeed.com/auth?continue=https%3A%2F%2Femployers.indeed.com%2F"), "login");
  assert.equal(classifyIndeedUrl("https://employers.indeed.com/auth/login"), "login");
  assert.equal(classifyIndeedUrl("https://employers.indeed.com/cdn-cgi/challenge-platform/h/b"), "challenge");
  assert.equal(classifyIndeedUrl("https://pk.indeed.com/viewjob?jk=abc"), "other");
  assert.equal(classifyIndeedUrl("not a url"), "other");
});

test("challenge titles are recognised", () => {
  assert.equal(looksLikeChallenge("Just a moment..."), true);
  assert.equal(looksLikeChallenge("Additional Verification Required"), true);
  assert.equal(looksLikeChallenge("Employer Dashboard | Indeed"), false);
  assert.equal(looksLikeChallenge(undefined), false);
});

test("a sign-in window needs a screen: always on Windows and macOS, a display server on Linux", () => {
  assert.equal(canShowWindow({}, "win32"), true);
  assert.equal(canShowWindow({}, "darwin"), true);
  assert.equal(canShowWindow({}, "linux"), false);
  assert.equal(canShowWindow({ DISPLAY: ":0" }, "linux"), true);
  assert.equal(canShowWindow({ WAYLAND_DISPLAY: "wayland-0" }, "linux"), true);
  assert.equal(canShowWindow({ INDEED_CONNECT_WINDOW: "off" }, "win32"), false);
});

test("the wait for sign-in is five minutes unless the environment sets 1 to 30", () => {
  assert.equal(waitLimitMs({}), 5 * 60 * 1000);
  assert.equal(waitLimitMs({ INDEED_CONNECT_WAIT_MINUTES: "10" }), 10 * 60 * 1000);
  assert.equal(waitLimitMs({ INDEED_CONNECT_WAIT_MINUTES: "0" }), 5 * 60 * 1000);
  assert.equal(waitLimitMs({ INDEED_CONNECT_WAIT_MINUTES: "99" }), 5 * 60 * 1000);
  assert.equal(waitLimitMs({ INDEED_CONNECT_WAIT_MINUTES: "abc" }), 5 * 60 * 1000);
});

const never = () => new Promise(() => {}); // a window that stays open
const env = { INDEED_CONNECT_WINDOW: undefined };

function expectConnectError(fn, code) {
  assert.throws(fn, (error) => error instanceof ConnectError && error.code === code);
}

test("connect: the email must look like an email, and a server without a screen says so", () => {
  expectConnectError(() => startIndeedConnect({ userId: "u-validate", email: "not-an-email", run: never }), "invalid_email");
  expectConnectError(() => startIndeedConnect({ userId: "u-validate", email: "", run: never }), "invalid_email");
  expectConnectError(() => startIndeedConnect({ userId: "u-validate", email: "a@b.co", env: { INDEED_CONNECT_WINDOW: "off" }, run: never }), "no_display");
  assert.equal(getConnectStatus("u-validate").status, "idle");
});

test("connect: one window at a time per person; cancelling closes it and frees the person to start again", async () => {
  let closed = false;
  const run = async (attempt) => {
    attempt.cancel = async () => { closed = true; };
    await never();
  };
  const started = startIndeedConnect({ userId: "u-one", email: "hr@example.com", env, run });
  assert.equal(started.status, CONNECT_STATUS.WAITING);
  assert.equal(started.email, "hr@example.com");
  assert.ok(new Date(started.waitsUntil) > new Date());
  // never leaks the session id or the close handle to the browser
  assert.ok(!("sessionId" in started) && !("cancel" in started));

  expectConnectError(() => startIndeedConnect({ userId: "u-one", email: "hr@example.com", env, run: never }), "in_progress");
  // another person is not blocked
  assert.equal(startIndeedConnect({ userId: "u-two", email: "other@example.com", env, run: never }).status, CONNECT_STATUS.WAITING);

  await new Promise((resolve) => setImmediate(resolve)); // let run() register its close handle
  const cancelled = await cancelIndeedConnect("u-one");
  assert.equal(cancelled.status, CONNECT_STATUS.CANCELLED);
  assert.equal(closed, true);
  assert.equal(startIndeedConnect({ userId: "u-one", email: "hr@example.com", env, run: never }).status, CONNECT_STATUS.WAITING);
  await cancelIndeedConnect("u-one");
  await cancelIndeedConnect("u-two");
});

test("connect: a run that throws ends the attempt as failed with a readable message", async () => {
  startIndeedConnect({ userId: "u-fail", email: "hr@example.com", env, run: async () => { throw new Error("boom"); } });
  await new Promise((resolve) => setImmediate(resolve));
  const status = getConnectStatus("u-fail");
  assert.equal(status.status, CONNECT_STATUS.FAILED);
  assert.equal(status.message, "boom");
  assert.ok(status.finishedAt);
});
