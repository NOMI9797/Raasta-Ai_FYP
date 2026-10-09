// Starting a posting run for a job, and what happens to the job when a run ends. The web app calls startPostingRun (after
// the same checks a normal post goes through); the engine process calls onRunFinished. Relative imports only.
import { eq } from "drizzle-orm";
import { db } from "../db";
import { jobs } from "../schema";
import { getPlatformSpec, jobApplyUrl, validatePost } from "../hiring/platform-content";
import { KIT_PLATFORMS, buildPostingKit } from "../hiring/posting-kit";
import { INITIATED_BY, PUBLICATION_STATUS, PUBLISH_MODE, evaluateGuard, recordEnginePost, resolveAccount } from "../hiring/publishing";
import { ENGINE_PLATFORMS, RUN_MODE, RUN_STATUS, RunError } from "./run-model";
import { createRun, recentRuns } from "./runs";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const MAX_OPENINGS = 50;

// Platforms whose posting window belongs to a connected account: the one switched on under Platforms (Rozee.pk's window is the person's own sign-in)
const ACCOUNT_PLATFORMS = ["indeed"];

/**
 * Runs as the posting limits see them. Only runs that post count (a rehearsal posts nothing), and a run that is still
 * live counts as a post in flight, the same as an automatic post in progress.
 */
export function guardRows(runs) {
  const rows = [];
  for (const run of runs) {
    if (run.mode !== RUN_MODE.POST) continue;
    const status = run.status === RUN_STATUS.PUBLISHED
      ? PUBLICATION_STATUS.PUBLISHED
      : run.status === RUN_STATUS.FAILED
        ? PUBLICATION_STATUS.FAILED
        : [RUN_STATUS.QUEUED, RUN_STATUS.RUNNING, RUN_STATUS.NEEDS_YOU, RUN_STATUS.AWAITING_CONFIRM].includes(run.status)
          ? PUBLICATION_STATUS.PUBLISHING
          : null; // cancelled or rehearsed: nothing was posted
    if (status) rows.push({ status, mode: PUBLISH_MODE.AUTO, createdAt: run.createdAt });
  }
  return rows;
}

/**
 * How long the engine leaves a person's platform account alone after a run ended in one of these ways. Trying again at once
 * is what turns a refusal into a restriction (docs/ai-hiring/19, section 5f). Practice runs never touch the platform.
 */
export function cooloffs(env = process.env) {
  const hours = Number(env.POSTER_PAUSED_COOLOFF_HOURS);
  return {
    account_paused: (Number.isFinite(hours) && hours > 0 ? hours : 24) * HOUR, // the platform paused the account
    blocked: 30 * 60 * 1000, // the platform's bot protection refused the window
    check_loop: 30 * 60 * 1000, // its verification check kept coming back after it was completed
  };
}

const waitText = (ms) => {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  return minutes >= 120 ? `about ${Math.round(minutes / 60)} hours` : `${minutes} minute${minutes === 1 ? "" : "s"}`;
};

/** { code, retryAt, reason } when a recent run ended in a refusal that should be left alone for a while, else null. `runs` come from recentRuns(). */
export function cooloffGuard(runs, now = new Date(), env = process.env, label = "Indeed", { accountId = null } = {}) {
  const table = cooloffs(env);
  const hits = runs
    // A paused account is that account's problem: a run for another account, or an older run that was not tied to one, says nothing about this one.
    // A block page or a check that kept coming back is about the window and its address, so those hold for every account.
    .filter((run) => run.outcome?.code !== "account_paused" || !accountId || run.accountId === accountId)
    .filter((run) => run.completedAt && table[run.outcome?.code] && new Date(run.completedAt).getTime() + table[run.outcome.code] > now.getTime())
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  const last = hits[0];
  if (!last) return null;
  const code = last.outcome.code;
  const retryAt = new Date(new Date(last.completedAt).getTime() + table[code]);
  const wait = waitText(retryAt.getTime() - now.getTime());
  const reason = code === "account_paused"
    ? `${label} paused this employer account${accountId ? " (the one switched on in Raasta-AI)" : ""}, so the posting engine is leaving it alone. Sort it out in your own browser first; you can try again in ${wait} (POSTER_PAUSED_COOLOFF_HOURS changes this). Copy and open still works.`
    : code === "check_loop"
      ? `${label}'s verification check kept coming back during the last run, and trying again straight away makes that worse. Try again in ${wait}, or use Copy and open.`
      : `${label}'s bot protection refused the last window, and trying again straight away makes that worse. Try again in ${wait}, or use Copy and open.`;
  return { code, retryAt, reason };
}

/** The per-run choices a person can make; anything else in `options` is ignored. */
export function cleanRunOptions(options = {}, mode = RUN_MODE.REHEARSAL) {
  const clean = {};
  // The practice site can show a verification check, so the person sees how the window hands over to them
  if (mode === RUN_MODE.PRACTICE && options.practiceCheck !== false) clean.practiceCheck = true;
  if (options.openings !== undefined && options.openings !== null && options.openings !== "") {
    const openings = Number(options.openings);
    if (!Number.isInteger(openings) || openings < 1 || openings > MAX_OPENINGS) {
      throw new RunError(`The number of people to hire must be a whole number from 1 to ${MAX_OPENINGS}.`, "invalid_options");
    }
    clean.openings = openings;
  }
  return clean;
}

/**
 * Queue a posting run for a job's saved post. Throws RunError (with .code and .status) for a refusal:
 * unsupported platform, no usable post, closed job, posting limits (post mode only), a run already live.
 * Returns the stored run.
 */
export async function startPostingRun({ job, platform, mode = RUN_MODE.REHEARSAL, options = {}, deps = {} }) {
  const database = deps.database || db;
  const now = deps.now ? deps.now() : new Date();
  if (!ENGINE_PLATFORMS.includes(platform) || !KIT_PLATFORMS.includes(platform)) {
    throw new RunError(`The posting engine does not post to ${platform} yet.`, "unsupported_platform");
  }
  if (![RUN_MODE.REHEARSAL, RUN_MODE.POST, RUN_MODE.PRACTICE].includes(mode)) throw new RunError("mode must be \"rehearsal\", \"post\" or \"practice\"", "invalid_mode");
  if (job.status === "closed") throw new RunError("This job is closed. Re-open it before posting it.", "closed");

  const spec = getPlatformSpec(platform);
  const text = String(job[spec.field] || "").trim();
  const [problem] = validatePost(platform, text);
  if (problem) throw new RunError(problem, "invalid_post");
  const clean = cleanRunOptions(options, mode);

  // The window signs in as the account that is switched on (Platforms, the Active switch); a switched-off account is never used. A practice run has no account.
  let account = null;
  if (mode !== RUN_MODE.PRACTICE && ACCOUNT_PLATFORMS.includes(platform)) {
    const connection = await (deps.resolveAccount || resolveAccount)({ database }, platform, { ownerId: job.userId, accountId: job.indeedAccountId });
    if (connection.status !== "connected") {
      throw new RunError(
        connection.status === "inactive"
          ? `Your ${spec.label} account is switched off. Switch it on under Platforms: the posting engine only uses an account that is switched on, and signs in to it.`
          : `No ${spec.label} account is connected. Connect one under Platforms and switch it on: the posting engine signs in to the account that is switched on.`,
        "no_active_account",
        409,
      );
    }
    account = { id: connection.account.id, name: connection.account.name };
  }

  // A practice run never reaches the platform, so neither the cool-off nor the posting limits apply to it
  if (mode !== RUN_MODE.PRACTICE) {
    const env = deps.env || process.env;
    const window = Math.max(DAY, ...Object.values(cooloffs(env)));
    const runs = await recentRuns({ userId: job.userId, platform, since: new Date(now.getTime() - window) }, deps.database ? { database } : {});
    const rest = cooloffGuard(runs, now, env, spec.label, { accountId: account?.id || null });
    if (rest) {
      const error = new RunError(rest.reason, rest.code, 429);
      error.retryAt = rest.retryAt;
      throw error;
    }
    if (mode === RUN_MODE.POST) {
      const guard = evaluateGuard({ platform, rows: guardRows(runs.filter((run) => now.getTime() - new Date(run.createdAt).getTime() < DAY)), now, initiatedBy: INITIATED_BY.USER });
      if (!guard.allowed) {
        const error = new RunError(guard.reason, guard.code, 429);
        error.retryAt = guard.retryAt;
        throw error;
      }
    }
  }

  const kit = { ...buildPostingKit({ job, platform, postText: text, applyUrl: jobApplyUrl(job.id), now }), options: clean, ...(account ? { account } : {}) };
  return createRun({ jobId: job.id, userId: job.userId, platform, mode, kit, now }, deps.database ? { database } : {});
}

/**
 * The engine finished a run. A run that ended with the job on the platform is written to the job's history and columns,
 * the same as a post the recruiter confirmed by hand. Returns true when the job was updated.
 */
export async function onRunFinished({ run, result, deps = {} }) {
  if (result.status !== RUN_STATUS.PUBLISHED || run.mode !== RUN_MODE.POST) return false;
  const database = deps.database || db;
  const [job] = await database.select().from(jobs).where(eq(jobs.id, run.jobId)).limit(1);
  if (!job) return false;
  const spec = getPlatformSpec(run.platform);
  await recordEnginePost({ job, platform: run.platform, postUrl: result.outcome?.postUrl, content: String(job[spec.field] || ""), accountId: run.kit?.account?.id || null, deps: deps.database ? { database } : {} });
  return true;
}
