// Numbers for the Home screen: one reading of what needs the user's attention and how the hiring
// and sales work is going. Admins see everything; everyone else only what they own (jobs and
// campaigns by userId). Relative imports only: also used from tests under tsx.
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { agentActions, campaigns, candidates, jobs, leads, messages } from "../schema";
import { CANDIDATE_STATUS } from "../hiring/statuses";
import { POST_SHORTLIST_STATUSES } from "../hiring/shortlist";

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_JOBS = 5;
const RECENT_CAMPAIGNS = 4;

// Screened but nobody has decided yet; the recruiter shortlists these (or the agent proposes it)
const WAITING_FOR_SHORTLIST = [CANDIDATE_STATUS.SCREENED, CANDIDATE_STATUS.REVIEWED];
const INTERVIEWING = [CANDIDATE_STATUS.INTERVIEW_INVITED, CANDIDATE_STATUS.INTERVIEW_IN_PROGRESS];
const INTERVIEWED = [
  CANDIDATE_STATUS.INTERVIEW_COMPLETED,
  CANDIDATE_STATUS.FINAL_SHORTLISTED,
  CANDIDATE_STATUS.FINAL_REJECTED,
  CANDIDATE_STATUS.HIRED,
];
const FINAL = [CANDIDATE_STATUS.FINAL_SHORTLISTED, CANDIDATE_STATUS.HIRED];
const INVITES_SENT = ["sent", "accepted", "rejected"];

const sum = (byStatus, statuses) => statuses.reduce((n, s) => n + (byStatus[s] || 0), 0);

/** Turns { status: count } for a set of candidates into the numbers the Home screen shows. */
export function summariseCandidates(byStatus = {}) {
  const total = Object.values(byStatus).reduce((n, c) => n + c, 0);
  return {
    total,
    unscreened: byStatus[CANDIDATE_STATUS.NEW] || 0,
    waitingForShortlist: sum(byStatus, WAITING_FOR_SHORTLIST),
    interviewing: sum(byStatus, INTERVIEWING),
    awaitingDecision: byStatus[CANDIDATE_STATUS.INTERVIEW_COMPLETED] || 0,
    expiredInvites: byStatus[CANDIDATE_STATUS.INTERVIEW_EXPIRED] || 0,
    hired: byStatus[CANDIDATE_STATUS.HIRED] || 0,
    // Cumulative, like the jobs list: everyone who got at least this far
    funnel: {
      applied: total,
      shortlisted: sum(byStatus, POST_SHORTLIST_STATUSES),
      interviewed: sum(byStatus, INTERVIEWED),
      final: sum(byStatus, FINAL),
    },
  };
}

/** A campaign with no leads is a draft, one with every lead processed is completed, otherwise active. */
export function campaignStatus({ leads: total = 0, processed = 0 }) {
  if (total === 0) return "draft";
  return processed >= total ? "completed" : "active";
}

const toMap = (rows, key = "status") => Object.fromEntries(rows.map((r) => [r[key], r.n]));

async function recruiterOverview(user, database, now) {
  const own = user.role === "admin" ? undefined : eq(jobs.userId, user.id);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const candidatesOfMine = () => database.select({ n: sql`count(*)::int` }).from(candidates).innerJoin(jobs, eq(jobs.id, candidates.jobId));

  const [jobRows, candidateRows, [{ n: newThisWeek }], [{ n: pendingApprovals }], recent] = await Promise.all([
    database.select({ status: jobs.status, n: sql`count(*)::int` }).from(jobs).where(own).groupBy(jobs.status),
    database
      .select({ status: candidates.status, n: sql`count(*)::int` })
      .from(candidates)
      .innerJoin(jobs, eq(jobs.id, candidates.jobId))
      .where(own)
      .groupBy(candidates.status),
    candidatesOfMine().where(and(own, gte(candidates.appliedAt, weekAgo))),
    database
      .select({ n: sql`count(*)::int` })
      .from(agentActions)
      .where(and(user.role === "admin" ? undefined : eq(agentActions.userId, user.id), eq(agentActions.status, "pending"))),
    database
      .select({ id: jobs.id, title: jobs.title, status: jobs.status, createdAt: jobs.createdAt })
      .from(jobs)
      .where(own)
      .orderBy(desc(jobs.createdAt))
      .limit(RECENT_JOBS),
  ]);

  // Per-job numbers for the recent jobs only
  const perJob = new Map(recent.map((j) => [j.id, {}]));
  if (recent.length) {
    const grouped = await database
      .select({ jobId: candidates.jobId, status: candidates.status, n: sql`count(*)::int` })
      .from(candidates)
      .where(inArray(candidates.jobId, recent.map((j) => j.id)))
      .groupBy(candidates.jobId, candidates.status);
    for (const { jobId, status, n } of grouped) perJob.get(jobId)[status] = n;
  }

  const jobsByStatus = toMap(jobRows);
  const people = summariseCandidates(toMap(candidateRows));
  return {
    jobs: {
      total: Object.values(jobsByStatus).reduce((n, c) => n + c, 0),
      open: jobsByStatus.published || 0,
      draft: jobsByStatus.draft || 0,
      closed: jobsByStatus.closed || 0,
    },
    candidates: { ...people, newThisWeek },
    pendingApprovals,
    recentJobs: recent.map((j) => ({ ...j, ...summariseCandidates(perJob.get(j.id)).funnel })),
  };
}

async function salesOverview(user, database) {
  const isAdmin = user.role === "admin";
  const [campaignRows, leadRows, [{ n: messagesSent }]] = await Promise.all([
    database
      .select({ id: campaigns.id, name: campaigns.name, createdAt: campaigns.createdAt })
      .from(campaigns)
      .where(isAdmin ? undefined : eq(campaigns.userId, user.id))
      .orderBy(desc(campaigns.createdAt)),
    database
      .select({
        campaignId: leads.campaignId,
        total: sql`count(*)::int`,
        processed: sql`(count(*) filter (where ${leads.status} = ${"completed"}))::int`,
        invitesSent: sql`(count(*) filter (where ${leads.inviteStatus} in (${sql.join(INVITES_SENT.map((s) => sql`${s}`), sql`, `)})))::int`,
        accepted: sql`(count(*) filter (where ${leads.inviteStatus} = ${"accepted"}))::int`,
      })
      .from(leads)
      .where(isAdmin ? undefined : eq(leads.userId, user.id))
      .groupBy(leads.campaignId),
    database
      .select({ n: sql`count(*)::int` })
      .from(messages)
      .where(and(isAdmin ? undefined : eq(messages.userId, user.id), eq(messages.status, "sent"))),
  ]);

  const byCampaign = new Map(leadRows.map((r) => [r.campaignId, r]));
  const withProgress = campaignRows.map((c) => {
    const l = byCampaign.get(c.id) || { total: 0, processed: 0, invitesSent: 0, accepted: 0 };
    return { ...c, leads: l.total, processed: l.processed, status: campaignStatus(l) };
  });
  const totals = leadRows.reduce(
    (t, r) => ({ leads: t.leads + r.total, invitesSent: t.invitesSent + r.invitesSent, accepted: t.accepted + r.accepted }),
    { leads: 0, invitesSent: 0, accepted: 0 }
  );

  return {
    campaigns: {
      total: withProgress.length,
      active: withProgress.filter((c) => c.status === "active").length,
      draft: withProgress.filter((c) => c.status === "draft").length,
      completed: withProgress.filter((c) => c.status === "completed").length,
    },
    leads: totals.leads,
    invitesSent: totals.invitesSent,
    accepted: totals.accepted,
    acceptanceRate: totals.invitesSent ? Math.round((totals.accepted / totals.invitesSent) * 100) : 0,
    messagesSent,
    recentCampaigns: withProgress.slice(0, RECENT_CAMPAIGNS),
  };
}

/** { recruiter, sales }: each is null when the user has no access to that workspace. */
export async function buildOverview(user, { database = db, now = new Date() } = {}) {
  const isAdmin = user.role === "admin";
  const modes = Array.isArray(user.modes) ? user.modes : [];
  const [recruiter, sales] = await Promise.all([
    isAdmin || modes.includes("recruiter") ? recruiterOverview(user, database, now) : null,
    isAdmin || modes.includes("sales") ? salesOverview(user, database) : null,
  ]);
  return { recruiter, sales, generatedAt: now.toISOString() };
}
