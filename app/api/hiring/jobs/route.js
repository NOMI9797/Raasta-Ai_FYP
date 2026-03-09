import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { jobs } from "@/libs/schema";
import { eq, desc } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";

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

    return NextResponse.json({ success: true, jobs: allJobs });
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
