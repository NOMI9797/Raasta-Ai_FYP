import { db } from "@/libs/db";
import { candidateActivities } from "@/libs/schema";
import { stageLabel } from "@/libs/hiring/stages";

export const ACTIVITY_TYPES = {
  APPLIED: "applied",
  RESUME_PARSED: "resume_parsed",
  STATUS_CHANGED: "status_changed",
  AI_EVALUATED: "ai_evaluated",
  NOTE: "note",
  EMAIL_SENT: "email_sent",
};

/**
 * Record an entry on a candidate's timeline.
 * Never throws: the timeline is secondary to the action being logged.
 */
export async function logCandidateActivity({
  candidateId,
  jobId,
  type,
  actorId = null,
  fromStatus = null,
  toStatus = null,
  message = null,
  metadata = null,
}, database = db) {
  try {
    await database.insert(candidateActivities).values({
      candidateId,
      jobId,
      type,
      actorId,
      fromStatus,
      toStatus,
      message,
      metadata,
    });
  } catch (err) {
    console.error(`Failed to log candidate activity (${type}):`, err.message);
  }
}

export function logStatusChange({ candidate, toStatus, actorId = null, reason = null }, database = db) {
  return logCandidateActivity({
    candidateId: candidate.id,
    jobId: candidate.jobId,
    type: ACTIVITY_TYPES.STATUS_CHANGED,
    actorId,
    fromStatus: candidate.status,
    toStatus,
    message: reason || `Moved from ${stageLabel(candidate.status)} to ${stageLabel(toStatus)}`,
  }, database);
}
