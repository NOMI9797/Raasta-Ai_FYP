import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHECKPOINT_COOLOFF_MS, INITIATED_BY, PUBLICATION_STATUS as S, PUBLISH_MODE, RETRY_BRAKE_MS,
  classifyFailure, evaluateGuard, getPublishLimits, isAllowedPostUrl, plainError,
} from "../../libs/hiring/publishing";

const NOW = new Date("2026-10-05T12:00:00.000Z");
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60 * 1000);
const row = (status, minutes, mode = PUBLISH_MODE.AUTO) => ({ status, mode, createdAt: minutesAgo(minutes) });
const guard = (rows, extra = {}) => evaluateGuard({ platform: "linkedin", rows, now: NOW, ...extra });

test("limits: LinkedIn is stricter than Rozee, and the environment can change them", () => {
  assert.deepEqual(getPublishLimits("linkedin", {}), { dailyCap: 3, minGapMs: 10 * 60 * 1000 });
  assert.deepEqual(getPublishLimits("rozee", {}), { dailyCap: 5, minGapMs: 5 * 60 * 1000 });
  assert.deepEqual(getPublishLimits("linkedin", { PUBLISH_DAILY_CAP_LINKEDIN: "2", PUBLISH_MIN_GAP_MINUTES_LINKEDIN: "0" }), { dailyCap: 2, minGapMs: 0 });
  assert.equal(getPublishLimits("linkedin", { PUBLISH_DAILY_CAP_LINKEDIN: "abc" }).dailyCap, 3);
  assert.throws(() => getPublishLimits("indeed", {}), /Unknown platform/);
});

test("guard: a quiet account may post, and shows how many posts are left", () => {
  const g = guard([]);
  assert.equal(g.allowed, true);
  assert.equal(g.usedToday, 0);
  assert.equal(g.remaining, 3);
});

test("guard: the daily cap counts published and in-flight posts, not failures or hand-offs", () => {
  const rows = [row(S.PUBLISHED, 600), row(S.PUBLISHED, 400), row(S.FAILED, 300), row(S.HANDED_OFF, 200, PUBLISH_MODE.HANDOFF)];
  assert.equal(guard(rows).allowed, true);
  assert.equal(guard(rows).usedToday, 2);
  const full = guard([...rows, row(S.PUBLISHING, 100)]);
  assert.equal(full.allowed, false);
  assert.equal(full.code, "daily_limit");
  // the oldest counted post leaves the 24 hour window first
  assert.equal(full.retryAt.getTime(), minutesAgo(600).getTime() + 24 * 60 * 60 * 1000);
  assert.match(full.reason, /3 automatic posts in the last 24 hours/);
});

test("guard: posts older than 24 hours no longer count", () => {
  const rows = [row(S.PUBLISHED, 24 * 60 + 5), row(S.PUBLISHED, 24 * 60 + 50), row(S.PUBLISHED, 25 * 60)];
  assert.equal(guard(rows).allowed, true);
  assert.equal(guard(rows).usedToday, 0);
});

test("guard: two posts in a row need a gap between them", () => {
  const g = guard([row(S.PUBLISHED, 4)]);
  assert.equal(g.allowed, false);
  assert.equal(g.code, "too_soon");
  assert.equal(g.retryAt.getTime(), minutesAgo(4).getTime() + 10 * 60 * 1000);
  assert.match(g.reason, /6 minutes/);
  assert.equal(guard([row(S.PUBLISHED, 11)]).allowed, true);
});

test("guard: after a failed attempt there is a short brake before the next one", () => {
  const g = guard([row(S.FAILED, 1)]);
  assert.equal(g.allowed, false);
  assert.equal(g.retryAt.getTime(), minutesAgo(1).getTime() + RETRY_BRAKE_MS);
  assert.equal(guard([row(S.FAILED, 3)]).allowed, true);
});

test("guard: the agent leaves an account alone for hours after a sign-in check; a person may retry", () => {
  const rows = [row(S.NEEDS_LOGIN, 180)];
  const agent = guard(rows, { initiatedBy: INITIATED_BY.AGENT });
  assert.equal(agent.allowed, false);
  assert.equal(agent.code, "needs_login");
  assert.equal(agent.retryAt.getTime(), minutesAgo(180).getTime() + CHECKPOINT_COOLOFF_MS);
  assert.match(agent.reason, /leaving it alone/);
  assert.equal(guard(rows, { initiatedBy: INITIATED_BY.USER }).allowed, true);
  assert.equal(guard([row(S.NEEDS_LOGIN, 13 * 60)], { initiatedBy: INITIATED_BY.AGENT }).allowed, true);
});

test("failures: a sign-in or security check is its own status; other errors are plain failures", () => {
  assert.deepEqual(classifyFailure({ code: "checkpoint", error: "LinkedIn is asking for a security check" }), {
    status: S.NEEDS_LOGIN, code: "checkpoint", error: "LinkedIn is asking for a security check",
  });
  assert.equal(classifyFailure({ error: "Session invalid: Session expired or invalid - redirected to login page" }).status, S.NEEDS_LOGIN);
  assert.equal(classifyFailure({ error: "Could not find \"Start a post\" trigger on feed page" }).status, S.FAILED);
  assert.equal(classifyFailure(undefined).status, S.FAILED);
  assert.equal(classifyFailure({ error: "boom", code: "timeout" }).code, "timeout");
});

test("links pasted after posting by hand must be https on the platform's own domain", () => {
  assert.equal(isAllowedPostUrl("linkedin", "https://www.linkedin.com/feed/update/urn:li:activity:123/"), true);
  assert.equal(isAllowedPostUrl("linkedin", "https://lnkd.in/abc"), true);
  assert.equal(isAllowedPostUrl("rozee", "https://www.rozee.pk/job/123"), true);
  assert.equal(isAllowedPostUrl("rozee", "https://rozee.pk.evil.example/job/123"), false);
  assert.equal(isAllowedPostUrl("linkedin", "http://www.linkedin.com/feed/"), false);
  assert.equal(isAllowedPostUrl("linkedin", "https://www.rozee.pk/job/123"), false);
  assert.equal(isAllowedPostUrl("linkedin", "javascript:alert(1)"), false);
  assert.equal(isAllowedPostUrl("linkedin", ""), false);
});

test("errors: a Playwright timeout is reduced to one readable sentence, the call log is dropped", () => {
  const raw = [
    "locator.click: Timeout 30000ms exceeded.",
    "Call log:",
    "  - waiting for locator(button[aria-label*=Post])",
    "    - locator resolved to <button aria-label=Open control menu for post by Someone>",
  ].join("\n");
  const failure = classifyFailure({ error: raw, code: "ui_changed" });
  assert.equal(failure.status, S.FAILED);
  assert.equal(failure.code, "ui_changed");
  assert.ok(!failure.error.includes("Call log"));
  assert.ok(!failure.error.includes("locator"));
  assert.match(failure.error, /Copy and open/);
  assert.equal(plainError("x".repeat(400)).length, 302);
  assert.equal(plainError(""), "Publishing failed");
});

test("a call log that mentions login does not turn a page change into a sign-in problem", () => {
  const raw = "locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator(a[href*=login])";
  assert.equal(classifyFailure({ error: raw }).status, S.FAILED);
});

test("unconfirmed: clicked Post but no confirmation counts as a post, so it cannot be repeated straight away", () => {
  const failure = classifyFailure({ code: "unconfirmed", error: "Clicked Post, but LinkedIn did not confirm it." });
  assert.equal(failure.status, S.UNCONFIRMED);
  const g = guard([row(S.UNCONFIRMED, 3)]);
  assert.equal(g.allowed, false);
  assert.equal(g.code, "too_soon");
  assert.equal(g.usedToday, 1);
  const capped = guard([row(S.UNCONFIRMED, 600), row(S.PUBLISHED, 400), row(S.UNCONFIRMED, 200)]);
  assert.equal(capped.code, "daily_limit");
});
