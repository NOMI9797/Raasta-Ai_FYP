// Follow-up work queued for newly shortlisted candidates (docs/ai-hiring/06-stage1-screening.md §3).
// Relative imports only. Phase 6 adds send-invite here.
import { enqueue } from "./queue";

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
