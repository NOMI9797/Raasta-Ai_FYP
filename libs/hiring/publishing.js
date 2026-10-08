// Publishing a job post to the platforms a recruiter has connected. Two ways, both started by a person
// (or by their agent, which is held to stricter rules):
//   auto    - post through the connected account, within posting limits, stopping at the first sign-in check
//   handoff - the recruiter gets the text and a link to the platform's own composer and posts it themselves
// Every attempt is a row in job_publications, which is also what the limits and the "already publishing" guard read.
// Relative imports only (also used by the worker).
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "../db";
import { indeedAccounts, jobPublications, jobs, linkedinAccounts, rozeeAccounts } from "../schema";
import { PLATFORM, POST_PLATFORMS, composerHandoffUrl, getPlatformSpec, jobApplyUrl, validatePost } from "./platform-content";
import { KIT_PLATFORMS, buildPostingKit } from "./posting-kit";
import { ENGINE_PLATFORMS } from "../poster/run-model";

export const PUBLICATION_STATUS = Object.freeze({
  PUBLISHING: "publishing",
  PUBLISHED: "published",
  FAILED: "failed",
  NEEDS_LOGIN: "needs_login", // the platform asked for a sign-in or security check
  HANDED_OFF: "handed_off", // the recruiter was given the text and will post it themselves
  UNCONFIRMED: "unconfirmed", // Post was clicked but the platform never confirmed; it may be live
});
// engine: the posting engine (libs/poster) filled in the platform's form in a visible window and the recruiter pressed its final button
export const PUBLISH_MODE = Object.freeze({ AUTO: "auto", HANDOFF: "handoff", ENGINE: "engine" });
export const INITIATED_BY = Object.freeze({ USER: "user", AGENT: "agent" });

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
export const STALE_PUBLISH_MS = 10 * MINUTE; // an attempt "in flight" this long ago was lost (crash, timeout)
export const CHECKPOINT_COOLOFF_MS = 12 * 60 * MINUTE; // the agent leaves an account alone this long after a sign-in check
export const RETRY_BRAKE_MS = 2 * MINUTE; // after a failed attempt, wait before trying again

// A person posts a few jobs a day, not dozens: automatic posting is capped per account.
const DEFAULT_LIMITS = {
  [PLATFORM.LINKEDIN]: { dailyCap: 3, minGapMinutes: 10 },
  [PLATFORM.ROZEE]: { dailyCap: 5, minGapMinutes: 5 },
  [PLATFORM.INDEED]: { dailyCap: 3, minGapMinutes: 10 }, // Indeed watches automation closely: as careful as LinkedIn
};

/** Automatic-posting limits for a platform. Override with PUBLISH_DAILY_CAP_<PLATFORM> / PUBLISH_MIN_GAP_MINUTES_<PLATFORM>. */
export function getPublishLimits(platform, env = process.env) {
  const base = DEFAULT_LIMITS[platform];
  if (!base) throw new Error(`Unknown platform "${platform}"`);
  const key = platform.toUpperCase();
  const cap = Number(env[`PUBLISH_DAILY_CAP_${key}`]);
  const gap = Number(env[`PUBLISH_MIN_GAP_MINUTES_${key}`]);
  return {
    dailyCap: Number.isInteger(cap) && cap > 0 ? cap : base.dailyCap,
    minGapMs: (Number.isFinite(gap) && gap >= 0 ? gap : base.minGapMinutes) * MINUTE,
  };
}

/**
 * Whether automatic posting is offered for a platform: { available, reason }.
 * "Automatic" here means posting in the background through a connected account's saved session, with nobody watching.
 * Indeed is off for that, and is posted another way: what the runs showed (docs/ai-hiring/19, section 5c) is that a hidden
 * automated browser is blocked by Cloudflare's bot check (HTTP 403), while a visible window with a person present passed it.
 * So Indeed has the posting engine (libs/poster): a visible window that fills the form in like a person and hands over to the
 * recruiter at every check, sign-in and decision. Copy and open (with the Raasta-AI Poster extension) also works.
 * INDEED_AUTO_POST=true would switch the background path on; nothing is built behind it.
 * Rozee.pk is off for the same reason, and for a second one: its "Post a job" is now an AI wizard on rozeegpt.ai that ends in a
 * dialog applying a free Featured Job credit or selling an upgrade, which must be a person's choice (docs/ai-hiring/19, section 5g).
 * LinkedIn is the one platform still posted through its connected account.
 */
export function autoPostAvailability(platform, env = process.env) {
  if (platform === PLATFORM.INDEED && env.INDEED_AUTO_POST !== "true") {
    return {
      available: false,
      reason: "Indeed is not posted in the background. Use the posting engine, which fills in Indeed's form in a window you watch, or Copy and open.",
    };
  }
  if (platform === PLATFORM.ROZEE) {
    return {
      available: false,
      reason: "Rozee.pk is not posted in the background: its job form is now a wizard that ends by spending one of your credits. Use the posting engine, which fills it in in a window you watch, or Copy and open.",
    };
  }
  return { available: true, reason: null };
}

const at = (value) => new Date(value).getTime();

function describeWait(retryAt, now) {
  const minutes = Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / MINUTE));
  return minutes >= 120 ? `about ${Math.round(minutes / 60)} hours` : `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Whether one more automatic post may go out on an account right now.
 * `rows` are the account's job_publications from the last 24 hours (any platform row for that account).
 * Returns { allowed, code?, reason?, retryAt?, usedToday, remaining, dailyCap }.
 */
export function evaluateGuard({ platform, rows, now = new Date(), initiatedBy = INITIATED_BY.USER, limits }) {
  const { dailyCap, minGapMs } = limits || getPublishLimits(platform);
  const t = now.getTime();
  const auto = rows.filter((r) => r.mode === PUBLISH_MODE.AUTO && t - at(r.createdAt) < DAY);
  const posted = auto
    .filter((r) => [PUBLICATION_STATUS.PUBLISHED, PUBLICATION_STATUS.PUBLISHING, PUBLICATION_STATUS.UNCONFIRMED].includes(r.status))
    .sort((a, b) => at(a.createdAt) - at(b.createdAt));
  const base = { allowed: true, usedToday: posted.length, remaining: Math.max(0, dailyCap - posted.length), dailyCap };
  const label = getPlatformSpec(platform).label;
  const block = (code, retryAt, reason) => ({ ...base, allowed: false, code, retryAt, reason: `${reason} Try again in ${describeWait(retryAt, now)}, or post it yourself.` });

  // Unattended runs back off after the platform asked for a sign-in check; a person who is looking at the screen may retry
  if (initiatedBy === INITIATED_BY.AGENT) {
    const stop = auto
      .filter((r) => r.status === PUBLICATION_STATUS.NEEDS_LOGIN && t - at(r.createdAt) < CHECKPOINT_COOLOFF_MS)
      .sort((a, b) => at(b.createdAt) - at(a.createdAt))[0];
    if (stop) {
      return block("needs_login", new Date(at(stop.createdAt) + CHECKPOINT_COOLOFF_MS), `${label} asked for a sign-in check on this account recently, so the agent is leaving it alone.`);
    }
  }
  if (posted.length >= dailyCap) {
    return block("daily_limit", new Date(at(posted[0].createdAt) + DAY), `This ${label} account already has ${dailyCap} automatic posts in the last 24 hours.`);
  }
  const lastPost = posted[posted.length - 1];
  if (lastPost && t - at(lastPost.createdAt) < minGapMs) {
    return block("too_soon", new Date(at(lastPost.createdAt) + minGapMs), `The last ${label} post from this account was a moment ago.`);
  }
  const lastTry = auto
    .filter((r) => [PUBLICATION_STATUS.FAILED, PUBLICATION_STATUS.NEEDS_LOGIN].includes(r.status))
    .sort((a, b) => at(b.createdAt) - at(a.createdAt))[0];
  if (lastTry && t - at(lastTry.createdAt) < RETRY_BRAKE_MS) {
    return block("too_soon", new Date(at(lastTry.createdAt) + RETRY_BRAKE_MS), `The last ${label} attempt just failed.`);
  }
  return base;
}

/**
 * First line of an error, in words a recruiter can act on. Automation errors (Playwright) carry a long
 * technical call log that is useful in the server log and meaningless in a dialog.
 */
export function plainError(raw) {
  const first = String(raw || "Publishing failed").split("\n")[0].trim();
  if (/Timeout \d+ms exceeded/i.test(first)) {
    return "The page did not respond the way the automation expects (the platform may have changed it). Nothing was confirmed as posted. Use Copy and open to post it yourself.";
  }
  return first.length > 300 ? `${first.slice(0, 299)}...` : first;
}

/** Splits an adapter result into the status to store, a stable code and a readable message. */
export function classifyFailure(result) {
  const error = plainError(result?.error);
  const code = result?.code;
  // The Post button was clicked but the platform never confirmed: it may be live, so it counts like a post
  if (code === "unconfirmed") return { status: PUBLICATION_STATUS.UNCONFIRMED, code, error };
  if (code === "checkpoint" || code === "session_invalid" || /checkpoint|challenge|security check|session (is )?(invalid|expired)|sign.?in|log.?in/i.test(error)) {
    return { status: PUBLICATION_STATUS.NEEDS_LOGIN, code: code || "needs_login", error };
  }
  return { status: PUBLICATION_STATUS.FAILED, code: code || "failed", error };
}

const POST_HOSTS = {
  [PLATFORM.LINKEDIN]: ["linkedin.com", "lnkd.in"],
  [PLATFORM.ROZEE]: ["rozee.pk", "rozeegpt.ai"], // Rozee.pk's employer area and its job pages now live on rozeegpt.ai
  [PLATFORM.INDEED]: ["indeed.com"], // covers pk.indeed.com, employers.indeed.com and the other country sites
};

/** A link someone pastes after posting by hand has to be https on the platform's own domain. */
export function isAllowedPostUrl(platform, url) {
  try {
    const parsed = new URL(String(url || "").trim());
    return parsed.protocol === "https:" && (POST_HOSTS[platform] || []).some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

// ─── Accounts ───

const ACCOUNT_TABLES = { [PLATFORM.LINKEDIN]: linkedinAccounts, [PLATFORM.ROZEE]: rozeeAccounts, [PLATFORM.INDEED]: indeedAccounts };

// The jobs columns a platform other than LinkedIn writes to (LinkedIn keeps its older, smaller set)
const JOB_COLUMNS = {
  [PLATFORM.ROZEE]: { account: "rozeeAccountId", url: "rozeePostUrl", post: "rozeePost", publishedAt: "rozeePublishedAt" },
  [PLATFORM.INDEED]: { account: "indeedAccountId", url: "indeedPostUrl", post: "indeedPost", publishedAt: "indeedPublishedAt" },
};

function preferredAccountId(job, platform) {
  if (platform === PLATFORM.LINKEDIN) return job.linkedinAccountId;
  return job[JOB_COLUMNS[platform].account];
}

function defaultDeps(overrides = {}) {
  return {
    database: db,
    now: () => new Date(),
    env: process.env,
    // Loaded on demand: the adapters pull in Playwright, which tests and read-only views never need
    getAdapter: async (platform) => (await import("../platforms")).getAdapter(platform),
    ...overrides,
  };
}

/**
 * The account used for a platform. Operators share the connected accounts (the Platforms page lists every
 * account to admins, sales operators and recruiters), so the choice is:
 *   1. the account asked for, if it exists (the recruiter picked it, or the job was posted with it before)
 *   2. the owner's own active account
 *   3. when the owner has none, the team's only active account
 * Returns { status: connected | inactive | not_connected, account?, accounts[] }. No session data leaves this module.
 */
export async function resolveAccount(d, platform, { ownerId, accountId }) {
  const table = ACCOUNT_TABLES[platform];
  const rows = await d.database
    .select({ id: table.id, userId: table.userId, userName: table.userName, email: table.email, isActive: table.isActive })
    .from(table)
    .orderBy(desc(table.lastUsed));
  const accounts = rows.map((r) => ({ id: r.id, name: r.userName || r.email, isActive: r.isActive, own: r.userId === ownerId }));
  if (rows.length === 0) return { status: "not_connected", account: null, accounts };

  const own = rows.filter((r) => r.userId === ownerId);
  const teamActive = rows.filter((r) => r.isActive);
  const chosen = (accountId && rows.find((r) => r.id === accountId))
    || own.find((r) => r.isActive)
    || (own.length === 0 && teamActive.length === 1 ? teamActive[0] : null);
  if (!chosen) return { status: "inactive", account: null, accounts };
  return { status: "connected", account: { id: chosen.id, name: chosen.userName || chosen.email, isActive: chosen.isActive }, accounts };
}

async function recentAccountRows(d, accountId, now) {
  return d.database
    .select()
    .from(jobPublications)
    .where(and(eq(jobPublications.accountId, accountId), gte(jobPublications.createdAt, new Date(now.getTime() - DAY))));
}

// ─── Overview (what the publish panel shows) ───

function legacyPublished(job, platform) {
  if (platform === PLATFORM.LINKEDIN) {
    return job.linkedinPostUrl ? { at: job.publishedAt || null, url: job.linkedinPostUrl, mode: PUBLISH_MODE.AUTO } : null;
  }
  const columns = JOB_COLUMNS[platform];
  return job[columns.publishedAt] ? { at: job[columns.publishedAt], url: job[columns.url] || null, mode: PUBLISH_MODE.AUTO } : null;
}

/**
 * Per-platform state of a job's distribution: the connection, the saved post, what happened last,
 * and whether an automatic post is allowed right now. Safe to send to the browser.
 */
export async function getPublishingOverview(job, deps = {}, { accountIds = {} } = {}) {
  const d = defaultDeps(deps);
  const now = d.now();
  return Promise.all(POST_PLATFORMS.map(async (platform) => {
    const spec = getPlatformSpec(platform);
    const text = String(job[spec.field] || "").trim();
    const problems = text ? validatePost(platform, text) : [];
    const connection = await resolveAccount(d, platform, { ownerId: job.userId, accountId: accountIds[platform] || preferredAccountId(job, platform) });

    const history = await d.database
      .select()
      .from(jobPublications)
      .where(and(eq(jobPublications.jobId, job.id), eq(jobPublications.platform, platform)))
      .orderBy(desc(jobPublications.createdAt))
      .limit(10);
    const latest = history[0] || null;
    const posted = history.find((r) => r.status === PUBLICATION_STATUS.PUBLISHED);
    const published = posted
      ? { at: posted.completedAt || posted.createdAt, url: posted.postUrl, mode: posted.mode }
      : legacyPublished(job, platform);

    let guard = { allowed: false, code: "not_connected" };
    if (connection.account) {
      guard = evaluateGuard({ platform, rows: await recentAccountRows(d, connection.account.id, now), now });
    }
    const autoPost = autoPostAvailability(platform, d.env);
    const canAutoPublish = autoPost.available && connection.status === "connected" && Boolean(text) && problems.length === 0 && guard.allowed && latest?.status !== PUBLICATION_STATUS.PUBLISHING;

    return {
      id: platform,
      label: spec.label,
      field: spec.field, // the jobs column the post is saved in (PATCH /api/hiring/jobs/[jobId])
      summary: spec.summary,
      maxChars: spec.maxChars,
      connection: { status: connection.status, accountId: connection.account?.id || null, accountName: connection.account?.name || null, accounts: connection.accounts },
      post: { text, length: text.length, problems },
      published,
      latest: latest ? { status: latest.status, mode: latest.mode, error: latest.error, at: latest.completedAt || latest.createdAt } : null,
      handoffUrl: composerHandoffUrl(platform, text),
      autoPost, // { available, reason }: false means Copy and open is the way to post here
      assisted: KIT_PLATFORMS.includes(platform), // true: the Raasta-AI Poster extension can show the form fields beside the platform's page
      engine: { available: ENGINE_PLATFORMS.includes(platform) }, // true: the posting engine can fill the form in a visible window (libs/poster)
      guard: {
        allowed: guard.allowed,
        code: guard.code || null,
        reason: guard.reason || null,
        retryAt: guard.retryAt || null,
        usedToday: guard.usedToday ?? 0,
        remaining: guard.remaining ?? 0,
        dailyCap: guard.dailyCap ?? getPublishLimits(platform).dailyCap,
      },
      canAutoPublish,
    };
  }));
}

// ─── Publishing ───

const isUniqueViolation = (error) => error?.code === "23505" || error?.cause?.code === "23505";
const shorten = (text, max = 500) => (String(text || "").length > max ? `${String(text).slice(0, max - 1)}\u2026` : String(text || ""));

function refuse(platform, code, error, extra = {}) {
  return { platform, ok: false, status: "refused", code, error, ...extra };
}

async function recordPublished(d, job, platform, { postUrl, accountId, content }) {
  const now = d.now();
  const patch = { updatedAt: now };
  if (job.status !== "closed") {
    patch.status = "published";
    if (!job.publishedAt) patch.publishedAt = now;
  }
  if (platform === PLATFORM.LINKEDIN) {
    if (postUrl) patch.linkedinPostUrl = postUrl;
    if (accountId) patch.linkedinAccountId = accountId;
  } else {
    const columns = JOB_COLUMNS[platform];
    if (postUrl) patch[columns.url] = postUrl;
    if (accountId) patch[columns.account] = accountId;
    patch[columns.post] = content;
    patch[columns.publishedAt] = now;
  }
  await d.database.update(jobs).set(patch).where(eq(jobs.id, job.id));
}

/**
 * The posting engine got a job onto a platform (the recruiter pressed its final button in the engine's window): record it
 * in the history and on the job, the same way a hand-off the recruiter confirms is recorded.
 */
export async function recordEnginePost({ job, platform, postUrl, content, deps = {} }) {
  const d = defaultDeps(deps);
  const now = d.now();
  const link = postUrl && isAllowedPostUrl(platform, postUrl) ? postUrl : null;
  await d.database.insert(jobPublications).values({
    jobId: job.id, userId: job.userId, platform, mode: PUBLISH_MODE.ENGINE, status: PUBLICATION_STATUS.PUBLISHED,
    initiatedBy: INITIATED_BY.USER, content: content || null, postUrl: link, createdAt: now, updatedAt: now, completedAt: now,
  });
  await recordPublished(d, job, platform, { postUrl: link, accountId: null, content: content || String(job[getPlatformSpec(platform).field] || "") });
  return { platform, ok: true, status: PUBLICATION_STATUS.PUBLISHED, mode: PUBLISH_MODE.ENGINE, postUrl: link };
}

async function releaseStale(d, jobId, platform, now) {
  await d.database
    .update(jobPublications)
    .set({ status: PUBLICATION_STATUS.FAILED, error: "The attempt never finished", updatedAt: now, completedAt: now })
    .where(and(
      eq(jobPublications.jobId, jobId),
      eq(jobPublications.platform, platform),
      eq(jobPublications.status, PUBLICATION_STATUS.PUBLISHING),
      lt(jobPublications.updatedAt, new Date(now.getTime() - STALE_PUBLISH_MS)),
    ));
}

/**
 * Publish one job's saved post to one platform. Never throws for an expected refusal; the result says what happened:
 *   { platform, ok: true, status: published | handed_off, postUrl?, text?, handoffUrl? }
 *   { platform, ok: false, status: refused | failed | needs_login, code, error, retryAt? }
 */
export async function publishToPlatform({ job, platform, mode = PUBLISH_MODE.AUTO, initiatedBy = INITIATED_BY.USER, accountId = null, deps = {} }) {
  const d = defaultDeps(deps);
  const spec = getPlatformSpec(platform);
  const text = String(job[spec.field] || "").trim();
  const [problem] = validatePost(platform, text);
  if (problem) return refuse(platform, "invalid_post", problem);
  if (job.status === "closed") return refuse(platform, "closed", "This job is closed. Re-open it before publishing.");

  const stamp = d.now();
  const base = { jobId: job.id, userId: job.userId, platform, initiatedBy, content: text, createdAt: stamp, updatedAt: stamp };

  if (mode === PUBLISH_MODE.HANDOFF) {
    await d.database.insert(jobPublications).values({ ...base, mode: PUBLISH_MODE.HANDOFF, status: PUBLICATION_STATUS.HANDED_OFF, completedAt: stamp });
    // For the platforms posted to with the browser extension, the hand-off also carries the kit it shows beside the form
    const kit = KIT_PLATFORMS.includes(platform) ? buildPostingKit({ job, platform, postText: text, applyUrl: jobApplyUrl(job.id), now: stamp }) : undefined;
    return { platform, ok: true, status: PUBLICATION_STATUS.HANDED_OFF, mode, text, handoffUrl: composerHandoffUrl(platform, text), ...(kit ? { kit } : {}) };
  }

  const autoPost = autoPostAvailability(platform, d.env);
  if (!autoPost.available) return refuse(platform, "auto_unavailable", autoPost.reason);

  const connection = await resolveAccount(d, platform, { ownerId: job.userId, accountId: accountId || preferredAccountId(job, platform) });
  if (connection.status !== "connected") {
    const why = connection.status === "inactive"
      ? `Your ${spec.label} account is connected but switched off. Switch it on under Platforms.`
      : `No ${spec.label} account is connected. Connect one under Platforms, or post it yourself.`;
    return refuse(platform, "not_connected", why);
  }
  const account = connection.account;

  const recent = await recentAccountRows(d, account.id, stamp);
  // A second click while the first post is still going out gets a straight answer; the unique index covers true races
  const inFlight = recent.some((r) => r.jobId === job.id && r.platform === platform && r.status === PUBLICATION_STATUS.PUBLISHING && stamp.getTime() - at(r.updatedAt) < STALE_PUBLISH_MS);
  if (inFlight) return refuse(platform, "in_progress", `A ${spec.label} post for this job is already being published.`);

  const guard = evaluateGuard({ platform, rows: recent, now: stamp, initiatedBy });
  if (!guard.allowed) return refuse(platform, guard.code, guard.reason, { retryAt: guard.retryAt });

  await releaseStale(d, job.id, platform, stamp);
  let claim;
  try {
    [claim] = await d.database
      .insert(jobPublications)
      .values({ ...base, accountId: account.id, mode: PUBLISH_MODE.AUTO, status: PUBLICATION_STATUS.PUBLISHING })
      .returning({ id: jobPublications.id });
  } catch (error) {
    if (isUniqueViolation(error)) return refuse(platform, "in_progress", `A ${spec.label} post for this job is already being published.`);
    throw error;
  }

  let result;
  try {
    const adapter = await d.getAdapter(platform);
    const sessionAccount = await adapter.getAccount(account.id);
    if (!sessionAccount) throw new Error(`${spec.label} account not found`);
    result = await adapter.publishJob(sessionAccount, job);
  } catch (error) {
    result = { success: false, error: error?.message || "Publishing failed" };
  }

  const done = d.now();
  if (result?.success) {
    await d.database
      .update(jobPublications)
      .set({ status: PUBLICATION_STATUS.PUBLISHED, postUrl: result.postUrl || null, error: null, updatedAt: done, completedAt: done })
      .where(eq(jobPublications.id, claim.id));
    await recordPublished(d, job, platform, { postUrl: result.postUrl, accountId: account.id, content: text });
    return { platform, ok: true, status: PUBLICATION_STATUS.PUBLISHED, mode, postUrl: result.postUrl || null };
  }

  const failure = classifyFailure(result);
  await d.database
    .update(jobPublications)
    .set({ status: failure.status, error: shorten(failure.error), updatedAt: done, completedAt: done })
    .where(eq(jobPublications.id, claim.id));
  return { platform, ok: false, status: failure.status, code: failure.code, error: failure.error };
}

/**
 * Publish to several platforms one after another. Each platform stands on its own: one refusing or failing
 * does not stop the others. `platforms` = "all" means every platform the owner has a connected account for
 * (in hand-off mode, every platform).
 */
export async function publishToPlatforms({ job, platforms, mode = PUBLISH_MODE.AUTO, initiatedBy = INITIATED_BY.USER, accountIds = {}, deps = {} }) {
  const d = defaultDeps(deps);
  let targets = Array.isArray(platforms) ? platforms.filter((p) => POST_PLATFORMS.includes(p)) : [];
  if (!Array.isArray(platforms)) {
    for (const platform of POST_PLATFORMS) {
      const connection = await resolveAccount(d, platform, { ownerId: job.userId, accountId: accountIds[platform] || preferredAccountId(job, platform) });
      // Automatic posting leaves out the platforms that do not offer it; hand-off is offered everywhere
      if (mode === PUBLISH_MODE.HANDOFF || (connection.status === "connected" && autoPostAvailability(platform, d.env).available)) targets.push(platform);
    }
  }
  const results = [];
  for (const platform of targets) {
    // Re-read so the second platform sees what the first one saved on the job
    const [fresh] = await d.database.select().from(jobs).where(eq(jobs.id, job.id)).limit(1);
    results.push(await publishToPlatform({ job: fresh || job, platform, mode, initiatedBy, accountId: accountIds[platform] || null, deps }));
  }
  return results;
}

/**
 * The recruiter posted by hand and says so: mark the hand-off as published, optionally with the link.
 */
export async function confirmHandoff({ job, platform, postUrl, deps = {} }) {
  const d = defaultDeps(deps);
  const spec = getPlatformSpec(platform);
  const link = String(postUrl || "").trim();
  if (link && !isAllowedPostUrl(platform, link)) {
    return refuse(platform, "invalid_url", `That doesn't look like a ${spec.label} link. Paste the address of your post, or leave it empty.`);
  }
  const now = d.now();
  const [open] = await d.database
    .select()
    .from(jobPublications)
    .where(and(eq(jobPublications.jobId, job.id), eq(jobPublications.platform, platform), eq(jobPublications.status, PUBLICATION_STATUS.HANDED_OFF)))
    .orderBy(desc(jobPublications.createdAt))
    .limit(1);
  const content = open?.content || String(job[spec.field] || "").trim();
  if (open) {
    await d.database
      .update(jobPublications)
      .set({ status: PUBLICATION_STATUS.PUBLISHED, postUrl: link || null, updatedAt: now, completedAt: now })
      .where(eq(jobPublications.id, open.id));
  } else {
    await d.database.insert(jobPublications).values({
      jobId: job.id, userId: job.userId, platform, mode: PUBLISH_MODE.HANDOFF, status: PUBLICATION_STATUS.PUBLISHED,
      initiatedBy: INITIATED_BY.USER, content, postUrl: link || null, createdAt: now, updatedAt: now, completedAt: now,
    });
  }
  await recordPublished(d, job, platform, { postUrl: link || null, accountId: null, content });
  return { platform, ok: true, status: PUBLICATION_STATUS.PUBLISHED, mode: PUBLISH_MODE.HANDOFF, postUrl: link || null };
}
