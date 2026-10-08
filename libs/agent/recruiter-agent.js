// Supervised recruiter agent (docs/ai-hiring/13-workers-automation.md, agent section).
// One "tick" (advanceRun) runs in the hiring worker whenever something changes: it finishes the
// one-off setup (post, approval, publishing), then looks at the job's candidates, plans actions,
// routes each through the policy (do it / ask first / human only) and records everything in
// agent_actions. It never waits inside a step: interviews and approvals arrive as later events.
// Relative imports only — runs in the worker under tsx.
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { agentActions, agentRuns, agentSteps, candidates, interviewQuestions, interviews, jobs } from "../schema";
import { CANDIDATE_STATUS, canTransition } from "../hiring/statuses";
import { getHiringConfig } from "../hiring/config";
import { POST_SHORTLIST_STATUSES, SHORTLIST_POOL_STATUSES } from "../hiring/shortlist";
import { queueScreening } from "../hiring/screening-queue";
import { PLATFORM, generatePlatformPost } from "../hiring/platform-content";
import { INITIATED_BY, autoPostAvailability, publishToPlatform } from "../hiring/publishing";
import { enqueue } from "../hiring/queue";
import { applyDecision } from "../hiring/decisions";
import { chatText } from "../ai/llm";
import { notify, NOTIFICATION_TYPES } from "../notifications";
import {
  ACTION_POLICY, AGENT_ACTION, AGENT_MODE, ROUTE, decide, normaliseMode, planFinalDecisions, planInvites, planShortlist,
} from "./policy";
import {
  ACTION_STATUS, AGENT_DECIDER, countExecutedSince, markExecuted, markFailed, proposeAction, supersedeActions,
} from "./actions";
import { FINISHED_RUN_STATUSES, RECRUITER_PIPELINE, RUN_STATUS } from "./runs";

export const DEFAULT_DAILY_INVITE_CAP = 20;
export const DECISIONS_LINK = "/dashboard/recruiter/decisions";
export const AGENT_LINK = "/dashboard/recruiter/agent";

export const STEP_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  WAITING: "waiting",
  AWAITING_APPROVAL: "awaiting_approval",
  APPROVED: "approved",
  COMPLETED: "completed",
  SKIPPED: "skipped",
  FAILED: "failed",
};
const DONE_STEP = [STEP_STATUS.COMPLETED, STEP_STATUS.SKIPPED, STEP_STATUS.APPROVED, STEP_STATUS.FAILED];

export const RECRUITER_STEPS = [
  { key: "load_job", label: "Load job" },
  { key: "generate_post", label: "Write job post" },
  { key: "approve_post", label: "Approve job post" },
  { key: "post_to_linkedin", label: "Publish to LinkedIn" },
  { key: "publish_to_rozee", label: "Publish to Rozee.pk" },
  { key: "publish_to_indeed", label: "Publish to Indeed" },
  { key: "scrape_rozee_applicants", label: "Import Rozee applicants" },
  { key: "screen_candidates", label: "Screen applications" },
  { key: "review_shortlist", label: "Shortlist" },
  { key: "prepare_questions", label: "Prepare interview questions" },
  { key: "send_interview_invites", label: "Send interview invites" },
  { key: "await_interviews", label: "Interviews" },
  { key: "final_decisions", label: "Final decisions" },
];
// The one-off setup is everything before screening starts
const SETUP_STEPS = RECRUITER_STEPS.slice(0, RECRUITER_STEPS.findIndex((s) => s.key === "screen_candidates")).map((s) => s.key);
const PUBLISH_STEPS = ["post_to_linkedin", "publish_to_rozee", "publish_to_indeed"];

const keyFor = (action, id) => `${action}:${id}`;
const startOfDay = (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate());
const screeningFailed = (c) =>
  Boolean(c.fitAnalysis?.error && (!c.fitAnalysis.queuedAt || new Date(c.fitAnalysis.failedAt) >= new Date(c.fitAnalysis.queuedAt)));

function defaults(deps = {}) {
  return {
    database: deps.database || db,
    enqueueJob: deps.enqueueJob || enqueue,
    notifyFn: deps.notifyFn || notify,
    llm: deps.llm || chatText,
    queueScreeningFn: deps.queueScreening || queueScreening,
    decisionFn: deps.applyDecision || applyDecision,
    getAdapter: deps.getAdapter || (async (name) => (await import("../platforms")).getAdapter(name)),
    now: deps.now || (() => new Date()),
  };
}

// ─── State and planning (pure) ───

function existingKeys(actions) {
  const map = new Map();
  for (const a of actions) if (a.dedupeKey && a.status !== ACTION_STATUS.SUPERSEDED) map.set(a.dedupeKey, a);
  return map;
}

/**
 * Everything the agent would do for the job right now, without doing it. Used by the tick and by
 * the preview. `state`: { candidates, actions, sentToday, hasQuestions, integrityById }.
 */
export function buildPlan(state, { mode, hiringConfig, dailyInviteCap = DEFAULT_DAILY_INVITE_CAP }) {
  const cands = state.candidates;
  const keys = existingKeys(state.actions || []);
  const has = (action, id) => keys.has(keyFor(action, id));

  const newOnes = cands.filter((c) => c.status === CANDIDATE_STATUS.NEW);
  const failed = newOnes.filter(screeningFailed);
  const pendingScreening = newOnes.filter((c) => !screeningFailed(c));
  const toQueue = pendingScreening.filter((c) => !c.fitAnalysis?.queuedAt).map((c) => c.id);

  // Shortlist only once the batch is screened, so the top-N cap compares everyone
  let shortlist = { shortlist: [], holdBack: [] };
  if (pendingScreening.length === 0) {
    const pool = cands.filter((c) => SHORTLIST_POOL_STATUSES.includes(c.status)
      && !has(AGENT_ACTION.SHORTLIST, c.id) && !has(AGENT_ACTION.HOLD_BACK, c.id));
    const openProposals = (state.actions || []).filter((a) => a.action === AGENT_ACTION.SHORTLIST
      && [ACTION_STATUS.PENDING, ACTION_STATUS.APPROVED].includes(a.status)).length;
    const taken = cands.filter((c) => POST_SHORTLIST_STATUSES.includes(c.status)).length + openProposals;
    shortlist = planShortlist(pool, hiringConfig, mode, taken);
  }

  const autoShortlisted = shortlist.shortlist.filter((i) => i.route === ROUTE.AUTO).map((i) => i.candidateId);
  const inviteEligible = [
    ...cands.filter((c) => c.status === CANDIDATE_STATUS.SHORTLISTED).map((c) => c.id),
    ...autoShortlisted,
  ].filter((id) => !has(AGENT_ACTION.SEND_INVITES, id));
  const invites = planInvites(inviteEligible, mode, { dailyCap: dailyInviteCap, sentToday: state.sentToday || 0 });

  // A re-analysis produces a new suggestion: the old request is replaced
  const evaluated = cands.filter((c) => {
    if (c.status !== CANDIDATE_STATUS.INTERVIEW_COMPLETED || !c.finalAnalysis?.suggestedDecision) return false;
    const existing = keys.get(keyFor(AGENT_ACTION.FINAL_DECISION, c.id));
    return !existing || (existing.status === ACTION_STATUS.PENDING && existing.payload?.computedAt !== c.finalAnalysis.computedAt);
  });
  const finals = planFinalDecisions(evaluated, hiringConfig, mode, state.integrityById || {});

  const count = (status) => cands.filter((c) => c.status === status).length;
  return {
    screening: { toQueue, pending: pendingScreening.length, failed: failed.length },
    shortlist,
    invites,
    finals,
    // The job's question bank is needed as soon as anyone is (or is about to be) invited
    needsQuestions: !state.hasQuestions && (shortlist.shortlist.length > 0
      || cands.some((c) => [CANDIDATE_STATUS.SHORTLISTED, CANDIDATE_STATUS.INTERVIEW_INVITED].includes(c.status))),
    interviews: {
      invited: count(CANDIDATE_STATUS.INTERVIEW_INVITED),
      inProgress: count(CANDIDATE_STATUS.INTERVIEW_IN_PROGRESS),
      expired: count(CANDIDATE_STATUS.INTERVIEW_EXPIRED),
      completed: count(CANDIDATE_STATUS.INTERVIEW_COMPLETED),
    },
  };
}

/** Load what buildPlan needs for a job. */
export async function loadJobState(job, { database = db, now = new Date() } = {}) {
  const rows = await database.select({
    id: candidates.id, name: candidates.name, status: candidates.status, appliedAt: candidates.appliedAt,
    fitScore: candidates.fitScore, fitAnalysis: candidates.fitAnalysis, screenedAt: candidates.screenedAt,
    finalScore: candidates.finalScore, finalAnalysis: candidates.finalAnalysis,
  }).from(candidates).where(eq(candidates.jobId, job.id));

  const actions = await database.select().from(agentActions)
    .where(and(eq(agentActions.jobId, job.id), ne(agentActions.status, ACTION_STATUS.SUPERSEDED)));

  const [{ n: questionCount }] = await database.select({ n: sql`count(*)::int` }).from(interviewQuestions)
    .where(and(eq(interviewQuestions.jobId, job.id), isNull(interviewQuestions.candidateId), eq(interviewQuestions.isActive, true)));

  const interviewIds = rows
    .filter((c) => c.status === CANDIDATE_STATUS.INTERVIEW_COMPLETED && c.finalAnalysis?.interviewId)
    .map((c) => c.finalAnalysis.interviewId);
  const integrityById = {};
  if (interviewIds.length) {
    const found = await database.select({ candidateId: interviews.candidateId, analysis: interviews.analysis })
      .from(interviews).where(inArray(interviews.id, interviewIds));
    for (const row of found) integrityById[row.candidateId] = row.analysis?.integrity || null;
  }

  const sentToday = await countExecutedSince(job.id, AGENT_ACTION.SEND_INVITES, startOfDay(now), { database });
  return { candidates: rows, actions, sentToday, hasQuestions: questionCount > 0, integrityById };
}

// ─── Evidence shown in the approval inbox (evidence before score) ───

function screeningEvidence(c, hiringConfig) {
  const fa = c.fitAnalysis || {};
  return {
    fitScore: c.fitScore,
    minFitScore: hiringConfig.minFitScore,
    maxShortlist: hiringConfig.maxShortlist,
    matched: fa.skillMatch?.matched || [],
    missing: fa.skillMatch?.missing || [],
    strengths: (fa.strengths || []).slice(0, 4),
    concerns: (fa.concerns || []).slice(0, 4),
    rationale: fa.rationale || null,
  };
}

function finalEvidence(c, hiringConfig) {
  const fa = c.finalAnalysis || {};
  return {
    finalScore: c.finalScore,
    threshold: hiringConfig.finalThreshold,
    breakdown: fa.breakdown || null,
    recommendation: fa.recommendation || null,
    summary: fa.summary || null,
    strengths: (fa.strengths || []).slice(0, 4),
    risks: (fa.risks || []).slice(0, 4),
    answered: fa.answered ?? null,
    totalQuestions: fa.totalQuestions ?? null,
  };
}

// ─── The tick ───

/**
 * Advance one recruiter run. Safe to call repeatedly (the worker holds a per-run lock).
 * Returns a short summary for the worker log (no candidate data).
 */
export async function advanceRun(runId, deps = {}) {
  const d = defaults(deps);
  const [run] = await d.database.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
  if (!run) return { skipped: "run not found" };
  if (run.pipelineType !== RECRUITER_PIPELINE) return { skipped: "not a recruiter run" };
  if (FINISHED_RUN_STATUSES.includes(run.status)) return { skipped: `run is ${run.status}` };
  if (run.status === RUN_STATUS.PAUSED) return { skipped: "paused" };

  const ctx = { d, run, mode: normaliseMode(run.mode), config: run.config || {}, out: { newApprovals: 0, autoActions: 0 } };
  await ensureSteps(ctx);
  ctx.steps = await loadSteps(ctx);

  if (run.status === RUN_STATUS.QUEUED) {
    await d.database.update(agentRuns).set({ status: RUN_STATUS.RUNNING, startedAt: d.now() }).where(eq(agentRuns.id, run.id));
  }

  const [job] = run.jobId ? await d.database.select().from(jobs).where(eq(jobs.id, run.jobId)).limit(1) : [];
  if (!job) return finishRun(ctx, RUN_STATUS.FAILED, "The job this agent manages no longer exists");
  ctx.job = job;
  ctx.hiringConfig = getHiringConfig(job);
  if (job.status === "closed") return finishRun(ctx, RUN_STATUS.COMPLETED, null);

  try {
    const setup = await runSetup(ctx);
    if (setup.blocked) {
      await saveRun(ctx, RUN_STATUS.PAUSED_AT_CHECKPOINT, "approve_post");
      await notifyApprovals(ctx);
      return { runId, blocked: "approve_post", ...ctx.out };
    }
    const plan = await operate(ctx);
    const current = currentStep(ctx);
    await saveRun(ctx, RUN_STATUS.WAITING, current, plan);
    await notifyApprovals(ctx);
    return { runId, currentStep: current, ...ctx.out };
  } catch (error) {
    await finishRun(ctx, RUN_STATUS.FAILED, error.message);
    throw error;
  }
}

async function ensureSteps({ d, run }) {
  const existing = await d.database.select({ stepKey: agentSteps.stepKey }).from(agentSteps).where(eq(agentSteps.agentRunId, run.id));
  const have = new Set(existing.map((s) => s.stepKey));
  const missing = RECRUITER_STEPS.map((s, i) => ({ ...s, i })).filter((s) => !have.has(s.key));
  if (missing.length) {
    await d.database.insert(agentSteps).values(missing.map((s) => ({
      agentRunId: run.id, stepKey: s.key, stepIndex: s.i, status: STEP_STATUS.PENDING,
    })));
  }
}

async function loadSteps({ d, run }) {
  const rows = await d.database.select().from(agentSteps).where(eq(agentSteps.agentRunId, run.id));
  return Object.fromEntries(rows.map((r) => [r.stepKey, r]));
}

async function setStep(ctx, key, status, output) {
  const now = ctx.d.now();
  const prev = ctx.steps[key];
  const patch = { status };
  if (output !== undefined) patch.output = output;
  if (!prev?.startedAt && status !== STEP_STATUS.PENDING) patch.startedAt = now;
  patch.completedAt = DONE_STEP.includes(status) ? now : null;
  await ctx.d.database.update(agentSteps).set(patch)
    .where(and(eq(agentSteps.agentRunId, ctx.run.id), eq(agentSteps.stepKey, key)));
  ctx.steps[key] = { ...prev, ...patch };
}

function currentStep(ctx) {
  const order = RECRUITER_STEPS.map((s) => s.key);
  const attention = order.find((k) => ctx.steps[k]?.status === STEP_STATUS.AWAITING_APPROVAL);
  if (attention) return attention;
  return order.find((k) => [STEP_STATUS.RUNNING, STEP_STATUS.WAITING].includes(ctx.steps[k]?.status))
    || order.find((k) => ctx.steps[k]?.status === STEP_STATUS.PENDING)
    || order[order.length - 1];
}

async function saveRun(ctx, status, step, plan) {
  const results = plan ? {
    screening: plan.screening,
    shortlist: { proposed: plan.shortlist.shortlist.length, holdBack: plan.shortlist.holdBack.length },
    invites: { auto: plan.invites.auto.length, ask: plan.invites.ask.length, deferred: plan.invites.deferred.length },
    interviews: plan.interviews,
    finals: plan.finals.length,
    lastTickAt: ctx.d.now().toISOString(),
  } : undefined;
  await ctx.d.database.update(agentRuns)
    .set({ status, currentStep: step, ...(results ? { results } : {}), totalSteps: RECRUITER_STEPS.length })
    .where(and(eq(agentRuns.id, ctx.run.id), ne(agentRuns.status, RUN_STATUS.PAUSED), ne(agentRuns.status, RUN_STATUS.CANCELLED)));
}

async function finishRun(ctx, status, errorMessage) {
  const { d, run } = ctx;
  await d.database.update(agentRuns)
    .set({ status, errorMessage, completedAt: d.now() })
    .where(eq(agentRuns.id, run.id));
  const open = await d.database.select({ id: agentActions.id }).from(agentActions)
    .where(and(eq(agentActions.agentRunId, run.id), inArray(agentActions.status, [ACTION_STATUS.PENDING, ACTION_STATUS.APPROVED])));
  await supersedeActions(open.map((a) => a.id), `run ${status}`, { database: d.database, now: d.now() });
  await d.notifyFn({
    userId: run.userId,
    type: status === RUN_STATUS.FAILED ? NOTIFICATION_TYPES.AGENT_RUN_FAILED : NOTIFICATION_TYPES.AGENT_RUN_FINISHED,
    title: status === RUN_STATUS.FAILED ? "Recruiter agent stopped" : "Recruiter agent finished",
    body: errorMessage,
    link: AGENT_LINK,
  });
  return { runId: run.id, finished: status };
}

async function notifyApprovals(ctx) {
  if (!ctx.out.newApprovals) return;
  const n = ctx.out.newApprovals;
  await ctx.d.notifyFn({
    userId: ctx.run.userId,
    type: NOTIFICATION_TYPES.AGENT_NEEDS_APPROVAL,
    title: "Recruiter agent needs your approval",
    body: `${n} new item${n === 1 ? "" : "s"} for ${ctx.job?.title || "your job"}.`,
    link: DECISIONS_LINK,
  });
}

async function propose(ctx, spec) {
  const result = await proposeAction(ctx.run, spec, { database: ctx.d.database, now: ctx.d.now() });
  if (result.created && result.action.status === ACTION_STATUS.PENDING) ctx.out.newApprovals += 1;
  if (result.created && spec.route === ROUTE.AUTO) ctx.out.autoActions += 1;
  return result;
}

// ─── Setup: post, approval, publishing (once per run) ───

function applyUrlFor(job, config) {
  const base = config.appBaseUrl || process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "http://localhost:8085";
  return `${base.replace(/\/$/, "")}/apply/${job.id}`;
}

// One post per platform, each written to that platform's format (libs/hiring/platform-content.js)
async function writePost(ctx) {
  const { job, config, d } = ctx;
  const tone = config.postTone || "professional";
  const applyUrl = applyUrlFor(job, config);
  const platforms = [PLATFORM.LINKEDIN, ...(config.rozeeAccountId ? [PLATFORM.ROZEE] : []), ...(config.indeedAccountId ? [PLATFORM.INDEED] : [])];
  const posts = {};
  for (const platform of platforms) {
    posts[platform] = (await generatePlatformPost({ job, platform, tone, applyUrl, chat: d.llm })).text;
  }
  return { posts, applyUrl };
}

async function runSetup(ctx) {
  const { d, job, config, mode } = ctx;
  const skipPosting = async (note) => {
    for (const key of ["generate_post", "approve_post", ...PUBLISH_STEPS]) {
      if (!DONE_STEP.includes(ctx.steps[key]?.status)) await setStep(ctx, key, STEP_STATUS.SKIPPED, { note });
    }
  };

  for (const key of SETUP_STEPS) {
    if (DONE_STEP.includes(ctx.steps[key]?.status)) continue;

    if (key === "load_job") {
      await setStep(ctx, key, STEP_STATUS.COMPLETED, { jobId: job.id, title: job.title, status: job.status });
    } else if (key === "generate_post") {
      if (job.status === "published" && job.linkedinPost) {
        await skipPosting("The job is already published");
        continue;
      }
      await setStep(ctx, key, STEP_STATUS.RUNNING);
      const { posts, applyUrl } = await writePost(ctx);
      const post = posts[PLATFORM.LINKEDIN];
      const rozeePost = posts[PLATFORM.ROZEE];
      const indeedPost = posts[PLATFORM.INDEED];
      await d.database.update(jobs).set({
        linkedinPost: post, ...(rozeePost ? { rozeePost } : {}), ...(indeedPost ? { indeedPost } : {}), updatedAt: d.now(),
      }).where(eq(jobs.id, job.id));
      job.linkedinPost = post;
      if (rozeePost) job.rozeePost = rozeePost;
      if (indeedPost) job.indeedPost = indeedPost;
      const { action } = await propose(ctx, {
        action: AGENT_ACTION.WRITE_POST, route: decide(AGENT_ACTION.WRITE_POST, mode),
        summary: `Wrote the job post for ${job.title}`, payload: { applyUrl }, dedupeKey: `write_post:${ctx.run.id}`,
      });
      await markExecuted(action.id, { words: post.split(/\s+/).length }, { database: d.database, now: d.now() });
      await setStep(ctx, key, STEP_STATUS.COMPLETED, { jobId: job.id, linkedinPost: post, ...(rozeePost ? { rozeePost } : {}), ...(indeedPost ? { indeedPost } : {}), applyUrl });
    } else if (key === "approve_post") {
      const targets = [config.accountId && "LinkedIn", config.rozeeAccountId && autoPostAvailability(PLATFORM.ROZEE).available && "Rozee.pk", config.indeedAccountId && autoPostAvailability(PLATFORM.INDEED).available && "Indeed"].filter(Boolean);
      const { action } = await propose(ctx, {
        action: AGENT_ACTION.PUBLISH_POST,
        route: decide(AGENT_ACTION.PUBLISH_POST, mode),
        blocking: true,
        summary: `Publish "${job.title}"${targets.length ? ` to ${targets.join(" and ")}` : ""}`,
        payload: { linkedin: Boolean(config.accountId), rozee: Boolean(config.rozeeAccountId), indeed: Boolean(config.indeedAccountId) },
        evidence: { post: job.linkedinPost, applyUrl: applyUrlFor(job, config) },
        dedupeKey: `publish_post:${ctx.run.id}`,
      });
      if (action.status === ACTION_STATUS.PENDING) {
        await setStep(ctx, key, STEP_STATUS.AWAITING_APPROVAL, { actionId: action.id });
        return { blocked: true };
      }
      if (action.status === ACTION_STATUS.REJECTED) {
        await setStep(ctx, key, STEP_STATUS.SKIPPED, { rejected: true, note: action.decisionNote || "Publishing was declined" });
        for (const step of PUBLISH_STEPS) await setStep(ctx, step, STEP_STATUS.SKIPPED, { note: "Publishing was declined" });
        continue;
      }
      ctx.publishAction = action;
      await setStep(ctx, key, STEP_STATUS.APPROVED, { actionId: action.id, by: action.decidedBy });
    } else if (key === "post_to_linkedin") {
      await setStep(ctx, key, STEP_STATUS.RUNNING);
      const output = await publishLinkedIn(ctx).catch((error) => ({ error: error.message }));
      await setStep(ctx, key, output.error ? STEP_STATUS.FAILED : STEP_STATUS.COMPLETED, output);
    } else if (key === "publish_to_rozee") {
      await setStep(ctx, key, STEP_STATUS.RUNNING);
      const output = await publishRozee(ctx).catch((error) => ({ error: error.message }));
      await setStep(ctx, key, output.skipped ? STEP_STATUS.SKIPPED : output.error ? STEP_STATUS.FAILED : STEP_STATUS.COMPLETED, output);
    } else if (key === "publish_to_indeed") {
      await setStep(ctx, key, STEP_STATUS.RUNNING);
      const output = await publishIndeed(ctx).catch((error) => ({ error: error.message }));
      await setStep(ctx, key, output.skipped ? STEP_STATUS.SKIPPED : output.error ? STEP_STATUS.FAILED : STEP_STATUS.COMPLETED, output);
      // The last publishing step closes the approval
      const publish = ctx.publishAction || (await findPublishAction(ctx));
      if (publish && publish.status === ACTION_STATUS.APPROVED) {
        const outputs = Object.fromEntries(PUBLISH_STEPS.map((step) => [step, ctx.steps[step]?.output]));
        await markExecuted(publish.id, { linkedin: outputs.post_to_linkedin, rozee: outputs.publish_to_rozee, indeed: outputs.publish_to_indeed }, { database: d.database, now: d.now() });
      }
    } else if (key === "scrape_rozee_applicants") {
      if (!config.rozeeAccountId) {
        await setStep(ctx, key, STEP_STATUS.SKIPPED, { note: "No Rozee account configured" });
        continue;
      }
      await setStep(ctx, key, STEP_STATUS.RUNNING);
      const output = await importRozeeApplicants(ctx).catch((error) => ({ error: error.message }));
      await setStep(ctx, key, output.error ? STEP_STATUS.FAILED : STEP_STATUS.COMPLETED, output);
    }
  }
  return { blocked: false };
}

async function findPublishAction(ctx) {
  const [row] = await ctx.d.database.select().from(agentActions)
    .where(eq(agentActions.dedupeKey, `publish_post:${ctx.run.id}`)).limit(1);
  return row || null;
}

// The agent posts like a careful person would: through the same publisher as the Publish button, within its
// daily limits, one attempt at a time, and it stops (and says so) at the first sign-in check instead of retrying.
function publishDeps(d) {
  return { database: d.database, now: d.now, getAdapter: d.getAdapter };
}

async function publishLinkedIn(ctx) {
  const { d, job, config } = ctx;
  // Candidates apply through Raasta-AI, so the job goes live there whether or not a platform post goes out
  await d.database.update(jobs).set({ status: "published", publishedAt: job.publishedAt || d.now(), updatedAt: d.now() }).where(eq(jobs.id, job.id));
  if (!config.accountId) {
    return { published: true, linkedinPosted: false, note: "Published on Raasta-AI only (no LinkedIn account selected)" };
  }
  const [fresh] = await d.database.select().from(jobs).where(eq(jobs.id, job.id)).limit(1);
  const result = await publishToPlatform({ job: fresh, platform: PLATFORM.LINKEDIN, initiatedBy: INITIATED_BY.AGENT, accountId: config.accountId, deps: publishDeps(d) });
  if (!result.ok) throw new Error(`The job is live on Raasta-AI, but the LinkedIn post didn't go out: ${result.error}`);
  return { published: true, linkedinPosted: true, postUrl: result.postUrl || null };
}

async function publishRozee(ctx) {
  const { d, job, config } = ctx;
  if (!config.rozeeAccountId) return { skipped: true, note: "No Rozee account configured" };
  // Rozee.pk is not posted in the background: the post is saved on the job, and the recruiter posts it with the posting engine or Copy and open
  const availability = autoPostAvailability(PLATFORM.ROZEE);
  if (!availability.available) return { skipped: true, note: availability.reason };
  const [fresh] = await d.database.select().from(jobs).where(eq(jobs.id, job.id)).limit(1);
  const result = await publishToPlatform({ job: fresh, platform: PLATFORM.ROZEE, initiatedBy: INITIATED_BY.AGENT, accountId: config.rozeeAccountId, deps: publishDeps(d) });
  if (!result.ok) throw new Error(`The Rozee.pk post didn't go out: ${result.error}`);
  return { rozeePublished: true, rozeePostUrl: result.postUrl || null };
}

async function publishIndeed(ctx) {
  const { d, job, config } = ctx;
  if (!config.indeedAccountId) return { skipped: true, note: "No Indeed account configured" };
  // Indeed is not posted in the background: the post is written and saved on the job, and the recruiter posts it with the posting engine or Copy and open
  const availability = autoPostAvailability(PLATFORM.INDEED);
  if (!availability.available) return { skipped: true, note: availability.reason };
  const [fresh] = await d.database.select().from(jobs).where(eq(jobs.id, job.id)).limit(1);
  const result = await publishToPlatform({ job: fresh, platform: PLATFORM.INDEED, initiatedBy: INITIATED_BY.AGENT, accountId: config.indeedAccountId, deps: publishDeps(d) });
  if (!result.ok) throw new Error(`The Indeed post didn't go out: ${result.error}`);
  return { indeedPublished: true, indeedPostUrl: result.postUrl || null };
}

async function importRozeeApplicants(ctx) {
  const { d, job, config, run } = ctx;
  const adapter = await d.getAdapter("rozee");
  const account = await adapter.getAccount(config.rozeeAccountId);
  if (!account) throw new Error("Rozee account not found");
  const scraped = await adapter.scrapeApplicants(account, job, { limit: config.rozeeApplicantLimit || 25 });
  if (!scraped?.success) throw new Error(`Rozee import failed: ${scraped?.error || "unknown error"}`);
  let inserted = 0;
  for (const c of scraped.candidates || []) {
    if (!c?.profileUrl) continue;
    try {
      await d.database.insert(candidates).values({
        userId: run.userId,
        jobId: job.id,
        name: c.name || "Rozee Candidate",
        email: c.email || `rozee_${Date.now()}_${inserted}@unknown.local`,
        linkedinUrl: c.profileUrl,
        status: CANDIDATE_STATUS.NEW,
        source: "rozee",
        sourceData: c,
        parsedData: { skills: c.skills || [], summary: c.summary || c.headline || null, location: c.location || null, experience: c.experience || [] },
      });
      inserted += 1;
    } catch {
      // Duplicate applicant: already imported
    }
  }
  const { action } = await propose(ctx, {
    action: AGENT_ACTION.IMPORT_APPLICANTS, route: decide(AGENT_ACTION.IMPORT_APPLICANTS, ctx.mode),
    summary: `Imported ${inserted} applicant${inserted === 1 ? "" : "s"} from Rozee.pk`, dedupeKey: `import_applicants:${run.id}`,
  });
  await markExecuted(action.id, { inserted }, { database: d.database, now: d.now() });
  return { scraped: (scraped.candidates || []).length, inserted };
}

// ─── Operate: screening, shortlist, invites, interviews, final decisions (every tick) ───

async function operate(ctx) {
  const { d, job, mode, hiringConfig, config } = ctx;
  await executeApproved(ctx);
  await retireStale(ctx);

  const state = await loadJobState(job, { database: d.database, now: d.now() });
  const plan = buildPlan(state, { mode, hiringConfig, dailyInviteCap: config.dailyInviteCap ?? DEFAULT_DAILY_INVITE_CAP });
  const byId = new Map(state.candidates.map((c) => [c.id, c]));
  const keys = existingKeys(state.actions);

  // Screening (automatic in both modes)
  if (plan.screening.toQueue.length) {
    await d.queueScreeningFn(plan.screening.toQueue, { database: d.database });
    const { action } = await propose(ctx, {
      action: AGENT_ACTION.SCREEN, route: decide(AGENT_ACTION.SCREEN, mode),
      summary: `Queued screening for ${plan.screening.toQueue.length} application${plan.screening.toQueue.length === 1 ? "" : "s"}`,
      payload: { count: plan.screening.toQueue.length },
    });
    await markExecuted(action.id, { queued: plan.screening.toQueue.length }, { database: d.database, now: d.now() });
  }
  const anyCandidates = state.candidates.length > 0;
  await setStep(ctx, "screen_candidates",
    plan.screening.pending ? STEP_STATUS.RUNNING : anyCandidates ? STEP_STATUS.COMPLETED : STEP_STATUS.WAITING,
    { pending: plan.screening.pending, failed: plan.screening.failed, total: state.candidates.length });

  // Shortlist: positives per the mode, hold-backs always asked
  for (const item of plan.shortlist.shortlist) {
    const c = byId.get(item.candidateId);
    const { action, created } = await propose(ctx, {
      action: AGENT_ACTION.SHORTLIST, route: item.route, candidateId: c.id,
      summary: `Shortlist ${c.name} (fit ${c.fitScore})`,
      evidence: screeningEvidence(c, hiringConfig), escalations: item.escalations,
      dedupeKey: keyFor(AGENT_ACTION.SHORTLIST, c.id),
    });
    if (created && item.route === ROUTE.AUTO) await executeAction(ctx, action);
  }
  for (const item of plan.shortlist.holdBack) {
    const c = byId.get(item.candidateId);
    await propose(ctx, {
      action: AGENT_ACTION.HOLD_BACK, route: item.route, candidateId: c.id,
      summary: `Don't shortlist ${c.name}${c.fitScore != null ? ` (fit ${c.fitScore})` : ""}`,
      evidence: screeningEvidence(c, hiringConfig), escalations: item.escalations,
      dedupeKey: keyFor(AGENT_ACTION.HOLD_BACK, c.id),
    });
  }

  // Interview questions: make sure the bank exists before invites go out
  if (plan.needsQuestions && !keys.has(`prepare_questions:${job.id}`)) {
    await d.enqueueJob("ensure-questions", { jobId: job.id });
    const { action } = await propose(ctx, {
      action: AGENT_ACTION.PREPARE_QUESTIONS, route: decide(AGENT_ACTION.PREPARE_QUESTIONS, mode),
      summary: "Asked for the interview question bank to be prepared", dedupeKey: `prepare_questions:${job.id}`,
    });
    await markExecuted(action.id, { queued: true }, { database: d.database, now: d.now() });
  }

  // Invites: automatic up to the daily cap in Autopilot, asked in Assisted
  for (const id of plan.invites.auto) {
    const name = byId.get(id)?.name || "the candidate";
    const { action, created } = await propose(ctx, {
      action: AGENT_ACTION.SEND_INVITES, route: ROUTE.AUTO, candidateId: id,
      summary: `Send the interview invite to ${name}`, dedupeKey: keyFor(AGENT_ACTION.SEND_INVITES, id),
    });
    if (created) await executeAction(ctx, action);
  }
  for (const id of plan.invites.ask) {
    const c = byId.get(id);
    await propose(ctx, {
      action: AGENT_ACTION.SEND_INVITES, route: ROUTE.ASK, candidateId: id,
      summary: `Send the interview invite to ${c?.name || "the candidate"}`,
      evidence: c ? screeningEvidence(c, hiringConfig) : null,
      dedupeKey: keyFor(AGENT_ACTION.SEND_INVITES, id),
    });
  }

  // Final decisions: always asked, with the evidence and any escalations
  for (const item of plan.finals) {
    const c = byId.get(item.candidateId);
    const stale = keys.get(keyFor(AGENT_ACTION.FINAL_DECISION, c.id));
    if (stale) await supersedeActions([stale.id], "re-analysed", { database: d.database, now: d.now() });
    await propose(ctx, {
      action: AGENT_ACTION.FINAL_DECISION, route: item.route, candidateId: c.id,
      summary: `Final decision for ${c.name}`,
      payload: { suggestion: item.suggestion, computedAt: c.finalAnalysis.computedAt },
      evidence: finalEvidence(c, hiringConfig), escalations: item.escalations,
      dedupeKey: keyFor(AGENT_ACTION.FINAL_DECISION, c.id),
    });
  }

  await updateOperateSteps(ctx, plan);
  return plan;
}

async function updateOperateSteps(ctx, plan) {
  const { d, job } = ctx;
  const open = await d.database.select({ action: agentActions.action }).from(agentActions)
    .where(and(eq(agentActions.jobId, job.id), eq(agentActions.status, ACTION_STATUS.PENDING)));
  const pending = (action) => open.filter((a) => a.action === action).length;
  const [{ shortlisted, invited, decided }] = await d.database.select({
    shortlisted: sql`count(*) filter (where ${inArray(candidates.status, POST_SHORTLIST_STATUSES)})::int`,
    invited: sql`count(*) filter (where ${inArray(candidates.status, POST_SHORTLIST_STATUSES.filter((s) => s !== CANDIDATE_STATUS.SHORTLISTED))})::int`,
    decided: sql`count(*) filter (where ${inArray(candidates.status, [CANDIDATE_STATUS.FINAL_SHORTLISTED, CANDIDATE_STATUS.FINAL_REJECTED, CANDIDATE_STATUS.HIRED])})::int`,
  }).from(candidates).where(eq(candidates.jobId, job.id));

  const shortlistPending = pending(AGENT_ACTION.SHORTLIST) + pending(AGENT_ACTION.HOLD_BACK);
  await setStep(ctx, "review_shortlist",
    shortlistPending ? STEP_STATUS.AWAITING_APPROVAL : shortlisted ? STEP_STATUS.COMPLETED : STEP_STATUS.WAITING,
    { pendingApprovals: shortlistPending, shortlisted });

  const [{ n: questions }] = await d.database.select({ n: sql`count(*)::int` }).from(interviewQuestions)
    .where(and(eq(interviewQuestions.jobId, job.id), isNull(interviewQuestions.candidateId), eq(interviewQuestions.isActive, true)));
  await setStep(ctx, "prepare_questions",
    questions ? STEP_STATUS.COMPLETED : shortlisted ? STEP_STATUS.RUNNING : STEP_STATUS.WAITING, { questions });

  const invitePending = pending(AGENT_ACTION.SEND_INVITES);
  await setStep(ctx, "send_interview_invites",
    invitePending ? STEP_STATUS.AWAITING_APPROVAL : plan.invites.deferred.length ? STEP_STATUS.WAITING : invited ? STEP_STATUS.COMPLETED : STEP_STATUS.WAITING,
    { pendingApprovals: invitePending, waitingForDailyLimit: plan.invites.deferred.length, invited });

  const active = plan.interviews.invited + plan.interviews.inProgress;
  await setStep(ctx, "await_interviews",
    active ? STEP_STATUS.RUNNING : plan.interviews.completed || decided ? STEP_STATUS.COMPLETED : STEP_STATUS.WAITING,
    plan.interviews);

  const finalPending = pending(AGENT_ACTION.FINAL_DECISION);
  await setStep(ctx, "final_decisions",
    finalPending ? STEP_STATUS.AWAITING_APPROVAL : decided && !active ? STEP_STATUS.COMPLETED : STEP_STATUS.WAITING,
    { pendingApprovals: finalPending, decided });
}

// ─── Carrying out actions ───

/** Approved actions that haven't run yet: the recruiter's approvals since the last tick. */
async function executeApproved(ctx) {
  const { d, job } = ctx;
  const approved = await d.database.select().from(agentActions)
    .where(and(eq(agentActions.jobId, job.id), eq(agentActions.status, ACTION_STATUS.APPROVED)))
    .orderBy(agentActions.createdAt);
  for (const action of approved) {
    if (action.action === AGENT_ACTION.PUBLISH_POST) continue; // carried out by the setup steps
    await executeAction(ctx, action);
  }
}

const STALE_WHEN = {
  [AGENT_ACTION.SHORTLIST]: (c) => !SHORTLIST_POOL_STATUSES.includes(c.status),
  [AGENT_ACTION.HOLD_BACK]: (c) => !SHORTLIST_POOL_STATUSES.includes(c.status),
  [AGENT_ACTION.SEND_INVITES]: (c) => c.status !== CANDIDATE_STATUS.SHORTLISTED,
  [AGENT_ACTION.FINAL_DECISION]: (c) => c.status !== CANDIDATE_STATUS.INTERVIEW_COMPLETED,
};

/** Pending requests whose candidate has moved on (e.g. the recruiter acted directly) are retired. */
async function retireStale(ctx) {
  const { d, job } = ctx;
  const open = await d.database.select({ id: agentActions.id, action: agentActions.action, status: candidates.status })
    .from(agentActions)
    .innerJoin(candidates, eq(candidates.id, agentActions.candidateId))
    .where(and(eq(agentActions.jobId, job.id), eq(agentActions.status, ACTION_STATUS.PENDING)));
  const stale = open.filter((a) => STALE_WHEN[a.action]?.({ status: a.status })).map((a) => a.id);
  await supersedeActions(stale, "the candidate moved on", { database: d.database, now: d.now() });
}

async function loadCandidate(ctx, id) {
  const [c] = await ctx.d.database.select().from(candidates).where(eq(candidates.id, id)).limit(1);
  return c || null;
}

async function setCandidateStatus(ctx, candidate, status) {
  const now = ctx.d.now();
  const [updated] = await ctx.d.database.update(candidates)
    .set({ status, updatedAt: now })
    .where(and(eq(candidates.id, candidate.id), eq(candidates.status, candidate.status)))
    .returning({ id: candidates.id });
  return Boolean(updated);
}

async function executeAction(ctx, action) {
  const { d } = ctx;
  const opts = { database: d.database, now: d.now() };
  try {
    const candidate = action.candidateId ? await loadCandidate(ctx, action.candidateId) : null;
    if (action.candidateId && !candidate) {
      await supersedeActions([action.id], "candidate removed", opts);
      return;
    }

    if (action.action === AGENT_ACTION.SHORTLIST || action.action === AGENT_ACTION.HOLD_BACK) {
      const target = action.payload?.choice
        || (action.action === AGENT_ACTION.SHORTLIST ? CANDIDATE_STATUS.SHORTLISTED : CANDIDATE_STATUS.NOT_SHORTLISTED);
      if (candidate.status !== target && !canTransition(candidate.status, target)) {
        await supersedeActions([action.id], "the candidate moved on", opts);
        return;
      }
      if (candidate.status !== target && !(await setCandidateStatus(ctx, candidate, target))) {
        await supersedeActions([action.id], "the candidate changed at the same time", opts);
        return;
      }
      await markExecuted(action.id, { status: target }, opts);
      if (target === CANDIDATE_STATUS.SHORTLISTED) {
        // The job's question bank is requested once per job by the operate step; personalised
        // questions (if the job uses them) are per candidate
        if (ctx.hiringConfig.personalisedQuestions > 0) {
          await d.enqueueJob("personalise-questions", { candidateId: candidate.id });
        }
        // In Assisted mode the recruiter's shortlist approval also approves the invite
        if (action.decidedBy !== AGENT_DECIDER && ctx.mode === AGENT_MODE.ASSISTED) {
          const { action: invite, created } = await proposeAction(ctx.run, {
            action: AGENT_ACTION.SEND_INVITES, route: ROUTE.AUTO, candidateId: candidate.id,
            summary: `Send the interview invite to ${candidate.name} (approved with the shortlist)`,
            dedupeKey: keyFor(AGENT_ACTION.SEND_INVITES, candidate.id),
          }, opts);
          if (created) {
            await d.database.update(agentActions).set({ decidedBy: action.decidedBy }).where(eq(agentActions.id, invite.id));
            await executeAction(ctx, { ...invite, decidedBy: action.decidedBy });
          }
        }
      }
      return;
    }

    if (action.action === AGENT_ACTION.SEND_INVITES) {
      if (candidate.status !== CANDIDATE_STATUS.SHORTLISTED) {
        await supersedeActions([action.id], "the candidate is no longer waiting for an invite", opts);
        return;
      }
      await d.enqueueJob("send-invite", { candidateId: candidate.id });
      await markExecuted(action.id, { queued: true }, opts);
      return;
    }

    if (action.action === AGENT_ACTION.FINAL_DECISION) {
      if (candidate.status !== CANDIDATE_STATUS.INTERVIEW_COMPLETED) {
        await supersedeActions([action.id], "the candidate moved on", opts);
        return;
      }
      const decision = action.payload?.choice;
      if (!decision) throw new Error("No decision was chosen");
      await d.decisionFn({ candidateId: candidate.id, decision, decidedBy: action.decidedBy, note: action.decisionNote });
      await markExecuted(action.id, { status: decision }, opts);
      return;
    }

    // Bookkeeping actions are recorded as executed when created; finish any left over by a crash
    await markExecuted(action.id, action.result || null, opts);
  } catch (error) {
    await markFailed(action.id, error, opts);
  }
}

// ─── Preview (dry run) ───

/**
 * What the agent would do for a job right now in the given mode, without changing anything.
 * Counts only; no candidate data leaves this function except names for the summary.
 */
export async function previewAgent(job, { mode, dailyInviteCap = DEFAULT_DAILY_INVITE_CAP }, { database = db, now = new Date() } = {}) {
  const normalised = normaliseMode(mode);
  const state = await loadJobState(job, { database, now });
  const hiringConfig = getHiringConfig(job);
  const plan = buildPlan(state, { mode: normalised, hiringConfig, dailyInviteCap });
  const routeCounts = (items) => ({
    auto: items.filter((i) => i.route === ROUTE.AUTO).length,
    ask: items.filter((i) => i.route === ROUTE.ASK).length,
    escalated: items.filter((i) => i.escalations?.length).length,
  });
  const alreadyPublished = job.status === "published";
  return {
    mode: normalised,
    publish: alreadyPublished ? "already_published" : decide(AGENT_ACTION.PUBLISH_POST, normalised),
    screening: plan.screening,
    shortlist: routeCounts(plan.shortlist.shortlist),
    holdBack: routeCounts(plan.shortlist.holdBack),
    invites: { auto: plan.invites.auto.length, ask: plan.invites.ask.length, deferred: plan.invites.deferred.length },
    finalDecisions: routeCounts(plan.finals),
    interviews: plan.interviews,
    policy: Object.fromEntries(Object.entries(ACTION_POLICY).map(([k, p]) => [k, { label: p.label, route: p[normalised] }])),
  };
}
