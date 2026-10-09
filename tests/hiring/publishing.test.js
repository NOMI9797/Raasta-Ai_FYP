import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHECKPOINT_COOLOFF_MS, INITIATED_BY, PUBLICATION_STATUS as S, PUBLISH_MODE, RETRY_BRAKE_MS,
  autoPostAvailability, classifyFailure, evaluateGuard, getPublishLimits, isAllowedPostUrl, plainError, publishToPlatform, resolveAccount,
} from "../../libs/hiring/publishing";

const NOW = new Date("2026-10-05T12:00:00.000Z");
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60 * 1000);
const row = (status, minutes, mode = PUBLISH_MODE.AUTO) => ({ status, mode, createdAt: minutesAgo(minutes) });
const guard = (rows, extra = {}) => evaluateGuard({ platform: "linkedin", rows, now: NOW, ...extra });

test("limits: LinkedIn and Indeed are stricter than Rozee, and the environment can change them", () => {
  assert.deepEqual(getPublishLimits("linkedin", {}), { dailyCap: 3, minGapMs: 10 * 60 * 1000 });
  assert.deepEqual(getPublishLimits("rozee", {}), { dailyCap: 5, minGapMs: 5 * 60 * 1000 });
  assert.deepEqual(getPublishLimits("linkedin", { PUBLISH_DAILY_CAP_LINKEDIN: "2", PUBLISH_MIN_GAP_MINUTES_LINKEDIN: "0" }), { dailyCap: 2, minGapMs: 0 });
  assert.equal(getPublishLimits("linkedin", { PUBLISH_DAILY_CAP_LINKEDIN: "abc" }).dailyCap, 3);
  assert.deepEqual(getPublishLimits("indeed", {}), { dailyCap: 3, minGapMs: 10 * 60 * 1000 });
  assert.equal(getPublishLimits("indeed", { PUBLISH_DAILY_CAP_INDEED: "1" }).dailyCap, 1);
  assert.throws(() => getPublishLimits("glassdoor", {}), /Unknown platform/);
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
  assert.equal(isAllowedPostUrl("rozee", "https://www.rozeegpt.ai/zain-tech-test-engineer-159237"), true, "Rozee.pk's job pages live on rozeegpt.ai");
  assert.equal(isAllowedPostUrl("rozee", "https://rozeegpt.ai.evil.example/x-1"), false);
  assert.equal(isAllowedPostUrl("linkedin", "http://www.linkedin.com/feed/"), false);
  assert.equal(isAllowedPostUrl("linkedin", "https://www.rozee.pk/job/123"), false);
  assert.equal(isAllowedPostUrl("linkedin", "javascript:alert(1)"), false);
  assert.equal(isAllowedPostUrl("linkedin", ""), false);
  assert.equal(isAllowedPostUrl("indeed", "https://pk.indeed.com/viewjob?jk=abc123"), true);
  assert.equal(isAllowedPostUrl("indeed", "https://employers.indeed.com/jobs"), true);
  assert.equal(isAllowedPostUrl("indeed", "https://indeed.com.evil.example/viewjob"), false);
  assert.equal(isAllowedPostUrl("indeed", "https://www.rozee.pk/job/123"), false);
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

test("automatic posting: only LinkedIn is posted in the background; Indeed and Rozee.pk use the posting engine or Copy and open", () => {
  assert.deepEqual(autoPostAvailability("linkedin", {}), { available: true, reason: null });
  // Rozee.pk's job form is now a wizard that ends by spending a credit: a person's choice, so no background posting
  const rozee = autoPostAvailability("rozee", {});
  assert.equal(rozee.available, false);
  assert.match(rozee.reason, /posting engine/);
  assert.match(rozee.reason, /credits?/);
  const off = autoPostAvailability("indeed", {});
  assert.equal(off.available, false);
  assert.match(off.reason, /Copy and open/);
  assert.match(off.reason, /posting engine/);
  assert.doesNotMatch(off.reason, /blocks|bot protection|cannot/, "the reason says what to use instead, not that it cannot be done");
  assert.equal(autoPostAvailability("indeed", { INDEED_AUTO_POST: "yes" }).available, false, "only the word true turns it on");
  assert.equal(autoPostAvailability("indeed", { INDEED_AUTO_POST: "true" }).available, true);
});

test("an automatic post to Indeed is refused up front, before any account or browser is touched", async () => {
  const job = { id: "j1", userId: "u1", status: "draft", indeedPost: "Backend Engineer in Lahore\n\nAbout the role\n- Build things" };
  // no database in deps: reaching for one would throw, so a clean refusal proves nothing else ran
  const result = await publishToPlatform({ job, platform: "indeed", deps: { env: {}, database: null } });
  assert.equal(result.ok, false);
  assert.equal(result.status, "refused");
  assert.equal(result.code, "auto_unavailable");
  assert.match(result.error, /Copy and open/);
});

// ── Which account is used ──

const accountsDb = (rows) => ({ database: { select: () => ({ from: () => ({ orderBy: async () => rows }) }) } });
const account = (id, userId, isActive, email = `${id}@example.com`) => ({ id, userId, userName: null, email, isActive });

test("accounts: only an account that is switched on is chosen, even one the job was posted with before", async () => {
  const d = accountsDb([account("off", "u1", false), account("on", "u1", true)]);
  const chosen = await resolveAccount(d, "indeed", { ownerId: "u1", accountId: "off" });
  assert.equal(chosen.status, "connected");
  assert.equal(chosen.account.id, "on", "the switched-off account that was asked for is skipped");
  assert.equal((await resolveAccount(d, "indeed", { ownerId: "u1", accountId: "on" })).account.id, "on");
  assert.equal((await resolveAccount(d, "indeed", { ownerId: "u1" })).account.id, "on");
});

test("accounts: with every account switched off nothing is chosen, and with none connected it says so", async () => {
  const off = await resolveAccount(accountsDb([account("a", "u1", false), account("b", "u1", false)]), "indeed", { ownerId: "u1", accountId: "a" });
  assert.equal(off.status, "inactive");
  assert.equal(off.account, null);
  assert.equal(off.accounts.length, 2, "they are still listed, with their state, for the panel");
  assert.equal((await resolveAccount(accountsDb([]), "indeed", { ownerId: "u1" })).status, "not_connected");
});

test("accounts: a teammate's account is used only when it is switched on and the owner has none of their own", async () => {
  const team = account("team", "u2", true);
  assert.equal((await resolveAccount(accountsDb([team]), "indeed", { ownerId: "u1" })).account.id, "team");
  assert.equal((await resolveAccount(accountsDb([account("team", "u2", false)]), "indeed", { ownerId: "u1" })).status, "inactive");
  // the owner has an account, switched off: the teammate's is not borrowed
  assert.equal((await resolveAccount(accountsDb([account("mine", "u1", false), team]), "indeed", { ownerId: "u1" })).status, "inactive");
  // an active account the recruiter asked for by name is honoured
  assert.equal((await resolveAccount(accountsDb([account("mine", "u1", true), team]), "indeed", { ownerId: "u1", accountId: "team" })).account.id, "team");
});
