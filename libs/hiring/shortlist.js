// Stage-1 shortlisting (docs/ai-hiring/06-stage1-screening.md §3).
// Relative imports only — runs in the worker, API routes and the agent pipeline.
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import { candidates, jobs } from "../schema";
import { CANDIDATE_STATUS } from "./statuses";
import { getHiringConfig } from "./config";

// Candidates the shortlist may decide on
export const SHORTLIST_POOL_STATUSES = [CANDIDATE_STATUS.SCREENED, CANDIDATE_STATUS.REVIEWED];

// Candidates already past stage 1; they count towards maxShortlist
export const POST_SHORTLIST_STATUSES = [
  CANDIDATE_STATUS.SHORTLISTED,
  CANDIDATE_STATUS.INTERVIEW_INVITED,
  CANDIDATE_STATUS.INTERVIEW_EXPIRED,
  CANDIDATE_STATUS.INTERVIEW_IN_PROGRESS,
  CANDIDATE_STATUS.INTERVIEW_COMPLETED,
  CANDIDATE_STATUS.FINAL_SHORTLISTED,
  CANDIDATE_STATUS.FINAL_REJECTED,
  CANDIDATE_STATUS.HIRED,
];

/**
 * Pure decision rule: best fit first (ties: earliest application), shortlist while the
 * score meets minFitScore and the cap allows. Returns { shortlisted, notShortlisted } id lists.
 */
export function decideShortlist(pool, { minFitScore, maxShortlist }, alreadyShortlisted = 0) {
  const ordered = [...pool].sort(
    (a, b) => b.fitScore - a.fitScore || new Date(a.appliedAt) - new Date(b.appliedAt)
  );
  const shortlisted = [];
  const notShortlisted = [];
  let count = alreadyShortlisted;
  for (const candidate of ordered) {
    if (candidate.fitScore >= minFitScore && (maxShortlist == null || count < maxShortlist)) {
      shortlisted.push(candidate.id);
      count += 1;
    } else {
      notShortlisted.push(candidate.id);
    }
  }
  return { shortlisted, notShortlisted };
}

/**
 * Apply the shortlist for a job. Serialised per job with an advisory lock.
 * `overrides` can replace minFitScore / maxShortlist (agent pipeline fallback).
 * `onShortlisted(ids, { job, config })` runs after commit for newly shortlisted candidates;
 * Phase 3 / Phase 6 connect ensure-questions and send-invite there.
 */
export async function applyShortlist(
  jobId,
  { triggeredBy = "system", overrides = {}, onShortlisted, database = db } = {}
) {
  const outcome = await database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`shortlist:${jobId}`}))`);

    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) return null;
    const config = { ...getHiringConfig(job), ...overrides };

    const pool = await tx
      .select({ id: candidates.id, fitScore: candidates.fitScore, appliedAt: candidates.appliedAt })
      .from(candidates)
      .where(and(
        eq(candidates.jobId, jobId),
        inArray(candidates.status, SHORTLIST_POOL_STATUSES),
        isNotNull(candidates.fitScore),
      ));

    const [{ count }] = await tx
      .select({ count: sql`count(*)::int` })
      .from(candidates)
      .where(and(eq(candidates.jobId, jobId), inArray(candidates.status, POST_SHORTLIST_STATUSES)));

    const decision = decideShortlist(pool, config, count);
    const now = new Date();
    if (decision.shortlisted.length) {
      await tx.update(candidates)
        .set({ status: CANDIDATE_STATUS.SHORTLISTED, updatedAt: now })
        .where(inArray(candidates.id, decision.shortlisted));
    }
    if (decision.notShortlisted.length) {
      await tx.update(candidates)
        .set({ status: CANDIDATE_STATUS.NOT_SHORTLISTED, updatedAt: now })
        .where(inArray(candidates.id, decision.notShortlisted));
    }
    return { job, config, decision, alreadyShortlisted: count };
  });

  if (!outcome) return { jobId, skipped: "job not found", shortlisted: [], notShortlisted: [] };

  const { job, config, decision, alreadyShortlisted } = outcome;
  if (onShortlisted && decision.shortlisted.length) {
    await onShortlisted(decision.shortlisted, { job, config });
  }

  return {
    jobId,
    triggeredBy,
    minFitScore: config.minFitScore,
    maxShortlist: config.maxShortlist,
    alreadyShortlisted,
    ...decision,
  };
}
