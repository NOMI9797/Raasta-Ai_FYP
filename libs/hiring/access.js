import { db } from "@/libs/db";
import { candidates, jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";

// Admins can access every job; recruiters only their own.
export function ownedJobFilter(jobId, user) {
  return user.role === "admin"
    ? eq(jobs.id, jobId)
    : and(eq(jobs.id, jobId), eq(jobs.userId, user.id));
}

/**
 * Load a candidate together with its job, checking the user may access it.
 * Returns { candidate, job } or { error, status } for the route to return.
 */
export async function getOwnedCandidate(candidateId, user) {
  const [candidate] = await db
    .select()
    .from(candidates)
    .where(eq(candidates.id, candidateId))
    .limit(1);

  if (!candidate) {
    return { error: "Candidate not found", status: 404 };
  }

  const [job] = await db
    .select()
    .from(jobs)
    .where(ownedJobFilter(candidate.jobId, user))
    .limit(1);

  if (!job) {
    return { error: "Forbidden", status: 403 };
  }

  return { candidate, job };
}
