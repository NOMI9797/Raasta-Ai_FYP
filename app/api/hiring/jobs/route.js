import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { jobs, candidates } from "@/libs/schema";
import { eq, desc, inArray, sql } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { CANDIDATE_STATUS } from "@/libs/hiring/statuses";
import { POST_SHORTLIST_STATUSES } from "@/libs/hiring/shortlist";

const INTERVIEWED_STATUSES = [
  CANDIDATE_STATUS.INTERVIEW_COMPLETED,
  CANDIDATE_STATUS.FINAL_SHORTLISTED,
  CANDIDATE_STATUS.FINAL_REJECTED,
  CANDIDATE_STATUS.HIRED,
];
const FINAL_STATUSES = [CANDIDATE_STATUS.FINAL_SHORTLISTED, CANDIDATE_STATUS.HIRED];

// Adds counts { applied, shortlisted, interviewed, final } to each job
async function withCounts(jobRows) {
  if (jobRows.length === 0) return jobRows;
  const grouped = await db
    .select({ jobId: candidates.jobId, status: candidates.status, n: sql`count(*)::int` })
    .from(candidates)
    .where(inArray(candidates.jobId, jobRows.map((j) => j.id)))
    .groupBy(candidates.jobId, candidates.status);

  const counts = new Map(jobRows.map((j) => [j.id, { applied: 0, shortlisted: 0, interviewed: 0, final: 0 }]));
  for (const { jobId, status, n } of grouped) {
    const c = counts.get(jobId);
    c.applied += n;
    if (POST_SHORTLIST_STATUSES.includes(status)) c.shortlisted += n;
    if (INTERVIEWED_STATUSES.includes(status)) c.interviewed += n;
    if (FINAL_STATUSES.includes(status)) c.final += n;
  }
  return jobRows.map((j) => ({ ...j, counts: counts.get(j.id) }));
}

// GET /api/hiring/jobs - list jobs visible to the current user
export const GET = withAuth(async (request, { user }) => {
  try {
    const isAdmin = user.role === "admin";

    const allJobs = isAdmin
      ? await db.select().from(jobs).orderBy(desc(jobs.createdAt))
      : await db
          .select()
          .from(jobs)
          .where(eq(jobs.userId, user.id))
          .orderBy(desc(jobs.createdAt));

    return NextResponse.json({ success: true, jobs: await withCounts(allJobs) });
  } catch (error) {
    console.error("List jobs error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });

// POST /api/hiring/jobs - create a new job
export const POST = withAuth(async (request, { user }) => {
  try {
    const body = await request.json();

    const {
      title,
      requiredSkills,
      experienceRange,
      techStack,
      salaryMin,
      salaryMax,
      salaryCurrency,
      location,
      locationType,
      employmentType,
    } = body;

    if (!title || !title.trim()) {
      return NextResponse.json({ error: "Job title is required" }, { status: 400 });
    }

    const [newJob] = await db
      .insert(jobs)
      .values({
        userId: user.id,
        title: title.trim(),
        requiredSkills: requiredSkills || [],
        experienceRange: experienceRange || null,
        techStack: techStack || [],
        salaryMin: salaryMin || null,
        salaryMax: salaryMax || null,
        salaryCurrency: salaryCurrency || "USD",
        location: location || null,
        locationType: locationType || null,
        employmentType: employmentType || null,
      })
      .returning();

    return NextResponse.json({ success: true, job: newJob }, { status: 201 });
  } catch (error) {
    console.error("Create job error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
