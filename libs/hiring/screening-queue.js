// Queue stage-1 screening and mark candidates as queued so the UI can show it.
// Relative imports only.
import { inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { candidates } from "../schema";
import { enqueue } from "./queue";

/**
 * Enqueue screen-candidate for each id. fit_analysis gets { queuedAt } and loses any
 * previous error. Throws if the queue is unreachable (nothing is marked in that case).
 */
export async function queueScreening(candidateIds, { database = db, enqueueJob = enqueue } = {}) {
  if (!candidateIds.length) return { queued: 0 };
  for (const candidateId of candidateIds) {
    await enqueueJob("screen-candidate", { candidateId });
  }
  await database
    .update(candidates)
    .set({
      fitAnalysis: sql`((coalesce(${candidates.fitAnalysis}::jsonb, '{}'::jsonb) - 'error') || jsonb_build_object('queuedAt', now()))::json`,
    })
    .where(inArray(candidates.id, candidateIds));
  return { queued: candidateIds.length };
}
