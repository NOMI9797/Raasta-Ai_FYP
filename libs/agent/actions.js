// Agent actions: the supervised agent's approval inbox and audit trail (table agent_actions).
// Every action is recorded: what, why (evidence), and whether it ran automatically or who approved it.
// Relative imports only — runs in the worker and in API routes.
import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { agentActions, candidates, jobs } from "../schema";
import { AGENT_ACTION, ROUTE, resolveChoice } from "./policy";

export const ACTION_STATUS = {
  PENDING: "pending",       // waiting for the recruiter
  APPROVED: "approved",     // approved (or automatic), not carried out yet
  REJECTED: "rejected",     // the recruiter said no; nothing is done
  EXECUTED: "executed",
  FAILED: "failed",
  SUPERSEDED: "superseded", // no longer relevant (the candidate moved on, or the run stopped)
};

// decided_by for actions the agent takes on its own
export const AGENT_DECIDER = "agent";

export class ActionError extends Error {
  constructor(message, { status = 400, code } = {}) {
    super(message);
    this.name = "ActionError";
    this.status = status;
    this.code = code;
  }
}

/** The action already recorded for a subject (any status except superseded), or null. */
export async function findByDedupeKey(dedupeKey, { database = db } = {}) {
  if (!dedupeKey) return null;
  const [row] = await database
    .select()
    .from(agentActions)
    .where(and(eq(agentActions.dedupeKey, dedupeKey), ne(agentActions.status, ACTION_STATUS.SUPERSEDED)))
    .orderBy(desc(agentActions.createdAt))
    .limit(1);
  return row || null;
}

/**
 * Record a proposed action. AUTO actions are stored as approved by the agent (the caller carries
 * them out); ASK actions wait in the inbox. One action per dedupeKey: an existing one is returned
 * instead of creating a duplicate. Returns { action, created }.
 */
export async function proposeAction(run, {
  action, route, summary, candidateId = null, payload = null, evidence = null,
  escalations = [], blocking = false, dedupeKey = null, leadId = null, status = null, result = null,
}, { database = db, now = new Date() } = {}) {
  if (route === ROUTE.HUMAN) throw new Error(`${action} is never carried out by the agent`);
  const existing = await findByDedupeKey(dedupeKey, { database });
  if (existing) return { action: existing, created: false };
  const isAuto = route === ROUTE.AUTO;
  const [row] = await database.insert(agentActions).values({
    agentRunId: run.id,
    userId: run.userId,
    jobId: run.jobId,
    candidateId,
    campaignId: run.campaignId ?? null,
    leadId,
    action,
    route,
    // `status` lets the agent record work it already did (e.g. research) as executed in one write
    status: status || (isAuto ? ACTION_STATUS.APPROVED : ACTION_STATUS.PENDING),
    result,
    executedAt: status === ACTION_STATUS.EXECUTED ? now : null,
    blocking,
    summary,
    payload,
    evidence,
    escalations,
    dedupeKey,
    decidedBy: isAuto ? AGENT_DECIDER : null,
    decidedAt: isAuto ? now : null,
    createdAt: now,
    updatedAt: now,
  }).returning();
  return { action: row, created: true };
}

/**
 * The recruiter approves or rejects a pending action. For candidate actions the recruiter may pick
 * a different outcome (`choice`), e.g. shortlist someone the agent proposed to hold back.
 * Final decisions with no clear suggestion (needs review) require a choice. With `bulk`, escalated
 * requests are refused: each of those needs its own look.
 */
export async function decideAction({ actionId, userId, isAdmin = false, decision, choice = null, note = null, bulk = false },
  { database = db, now = new Date() } = {}) {
  if (!["approve", "reject"].includes(decision)) {
    throw new ActionError('decision must be "approve" or "reject"', { code: "invalid_decision" });
  }
  const [action] = await database.select().from(agentActions).where(eq(agentActions.id, actionId)).limit(1);
  if (!action || (!isAdmin && action.userId !== userId)) {
    throw new ActionError("Action not found", { status: 404, code: "not_found" });
  }
  if (action.status !== ACTION_STATUS.PENDING) {
    throw new ActionError(`This action is already ${action.status}`, { status: 409, code: "not_pending" });
  }

  if (bulk && decision === "approve" && (action.escalations || []).length) {
    throw new ActionError("Escalated requests need to be approved one by one", { status: 409, code: "escalated" });
  }

  let payload = action.payload;
  if (decision === "approve") {
    let resolved;
    try {
      resolved = resolveChoice(action.action, { choice, suggestion: action.payload?.suggestion });
    } catch (error) {
      throw new ActionError(error.message, { code: "invalid_choice" });
    }
    if (action.action === AGENT_ACTION.FINAL_DECISION && !resolved) {
      throw new ActionError("This candidate needs your review: choose final shortlist or reject", { code: "choice_required" });
    }
    if (resolved) payload = { ...(payload || {}), choice: resolved };
  }

  const [updated] = await database.update(agentActions)
    .set({
      status: decision === "approve" ? ACTION_STATUS.APPROVED : ACTION_STATUS.REJECTED,
      payload,
      decidedBy: userId,
      decidedAt: now,
      decisionNote: note ? String(note).slice(0, 1000) : null,
      updatedAt: now,
    })
    // Only from pending, so two recruiters can't both decide it
    .where(and(eq(agentActions.id, actionId), eq(agentActions.status, ACTION_STATUS.PENDING)))
    .returning();
  if (!updated) throw new ActionError("The action changed in the meantime; reload and try again", { status: 409, code: "conflict" });
  return updated;
}

export async function markExecuted(actionId, result = null, { database = db, now = new Date() } = {}) {
  await database.update(agentActions)
    .set({ status: ACTION_STATUS.EXECUTED, result, executedAt: now, updatedAt: now })
    .where(eq(agentActions.id, actionId));
}

export async function markFailed(actionId, error, { database = db, now = new Date() } = {}) {
  await database.update(agentActions)
    .set({ status: ACTION_STATUS.FAILED, result: { error: String(error?.message || error).slice(0, 500) }, updatedAt: now })
    .where(eq(agentActions.id, actionId));
}

/** Retire pending actions that no longer apply. Returns how many were retired. */
export async function supersedeActions(actionIds, reason, { database = db, now = new Date() } = {}) {
  if (!actionIds.length) return 0;
  const rows = await database.update(agentActions)
    .set({ status: ACTION_STATUS.SUPERSEDED, result: { reason }, updatedAt: now })
    .where(and(inArray(agentActions.id, actionIds), inArray(agentActions.status, [ACTION_STATUS.PENDING, ACTION_STATUS.APPROVED])))
    .returning({ id: agentActions.id });
  return rows.length;
}

/** All actions of a run that are still open (pending or approved but not carried out). */
export async function listOpenRunActions(runId, { database = db } = {}) {
  return database.select().from(agentActions)
    .where(and(eq(agentActions.agentRunId, runId), inArray(agentActions.status, [ACTION_STATUS.PENDING, ACTION_STATUS.APPROVED])))
    .orderBy(agentActions.createdAt);
}

/** A run's full action history, newest first (audit trail). */
export async function listRunActions(runId, { database = db, limit = 200 } = {}) {
  return database.select().from(agentActions)
    .where(eq(agentActions.agentRunId, runId))
    .orderBy(desc(agentActions.createdAt))
    .limit(limit);
}

/** Invites the agent has carried out for a job since `since` (for the daily cap). */
export async function countExecutedSince(jobId, action, since, { database = db } = {}) {
  const [{ n }] = await database.select({ n: sql`count(*)::int` }).from(agentActions)
    .where(and(
      eq(agentActions.jobId, jobId),
      eq(agentActions.action, action),
      eq(agentActions.status, ACTION_STATUS.EXECUTED),
      gte(agentActions.executedAt, since),
    ));
  return n;
}

/** Candidates with an approved request the agent hasn't carried out yet (shown as "in progress"). */
export async function listApprovedCandidateIds({ userId, isAdmin = false }, { database = db } = {}) {
  const conditions = [eq(agentActions.status, ACTION_STATUS.APPROVED), sql`${agentActions.candidateId} is not null`];
  if (!isAdmin) conditions.push(eq(agentActions.userId, userId));
  const rows = await database.select({ candidateId: agentActions.candidateId }).from(agentActions).where(and(...conditions));
  return [...new Set(rows.map((r) => r.candidateId))];
}

/**
 * The approval inbox: pending actions with their candidate and job, oldest first.
 * Non-admins only see their own.
 */
export async function listInbox({ userId, isAdmin = false, jobId = null }, { database = db } = {}) {
  const conditions = [eq(agentActions.status, ACTION_STATUS.PENDING)];
  if (!isAdmin) conditions.push(eq(agentActions.userId, userId));
  if (jobId) conditions.push(eq(agentActions.jobId, jobId));
  return database
    .select({
      id: agentActions.id,
      runId: agentActions.agentRunId,
      action: agentActions.action,
      route: agentActions.route,
      status: agentActions.status,
      blocking: agentActions.blocking,
      summary: agentActions.summary,
      payload: agentActions.payload,
      evidence: agentActions.evidence,
      escalations: agentActions.escalations,
      createdAt: agentActions.createdAt,
      jobId: agentActions.jobId,
      jobTitle: jobs.title,
      candidateId: agentActions.candidateId,
      candidateName: candidates.name,
      candidateEmail: candidates.email,
      candidateStatus: candidates.status,
      fitScore: candidates.fitScore,
      finalScore: candidates.finalScore,
    })
    .from(agentActions)
    .leftJoin(jobs, eq(jobs.id, agentActions.jobId))
    .leftJoin(candidates, eq(candidates.id, agentActions.candidateId))
    .where(and(...conditions))
    .orderBy(agentActions.createdAt);
}
