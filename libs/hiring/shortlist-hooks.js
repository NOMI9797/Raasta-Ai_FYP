// Follow-up work queued for newly shortlisted candidates (docs/ai-hiring/06-stage1-screening.md §3).
// Relative imports only. Phase 6 adds send-invite here.
import { eq } from "drizzle-orm";
import { db } from "../db";
import { jobs } from "../schema";
import { enqueue } from "./queue";
import { notify, NOTIFICATION_TYPES } from "../notifications";

/**
 * Use as applyShortlist's onShortlisted. Queues ensure-questions for the job (idempotent) and,
 * if enabled, personalise-questions per candidate. Never throws: the shortlist is already saved.
 */
export async function queueAfterShortlist(candidateIds, { job, config }, { enqueueJob = enqueue } = {}) {
  try {
    await enqueueJob("ensure-questions", { jobId: job.id });
    if (config.personalisedQuestions > 0) {
      for (const candidateId of candidateIds) {
        await enqueueJob("personalise-questions", { candidateId });
      }
    }
  } catch (error) {
    console.error("Failed to queue post-shortlist jobs:", error?.message);
  }
}

/**
 * One notification per system shortlist run (the worker debounces runs per job), so a
 * batch of screenings produces a single "screening finished" alert. Never throws.
 */
export async function notifyScreeningComplete(result, { database = db, notifyFn = notify } = {}) {
  const shortlisted = result?.shortlisted?.length || 0;
  const notShortlisted = result?.notShortlisted?.length || 0;
  if (!result?.jobId || shortlisted + notShortlisted === 0) return null;
  try {
    const [job] = await database
      .select({ id: jobs.id, title: jobs.title, userId: jobs.userId })
      .from(jobs)
      .where(eq(jobs.id, result.jobId))
      .limit(1);
    if (!job) return null;
    return await notifyFn({
      userId: job.userId,
      type: NOTIFICATION_TYPES.SCREENING_COMPLETE,
      title: `Screening finished for ${job.title}`,
      body: `${shortlisted} shortlisted, ${notShortlisted} not shortlisted.`,
      link: `/dashboard/recruiter/jobs/${job.id}/candidates`,
    });
  } catch (error) {
    console.error("Failed to notify screening result:", error?.message);
    return null;
  }
}
