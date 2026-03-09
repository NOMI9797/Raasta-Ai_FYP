import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";

function ownerFilter(jobId, user) {
  return user.role === "admin"
    ? eq(jobs.id, jobId)
    : and(eq(jobs.id, jobId), eq(jobs.userId, user.id));
}

// GET /api/hiring/jobs/[jobId]
export const GET = withAuth(async (request, { params, user }) => {
  try {
    const { jobId } = params;
    const [job] = await db
      .select()
      .from(jobs)
      .where(ownerFilter(jobId, user))
      .limit(1);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, job });
  } catch (error) {
    console.error("Get job error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });

// PATCH /api/hiring/jobs/[jobId]
export const PATCH = withAuth(async (request, { params, user }) => {
  try {
    const { jobId } = params;
    const body = await request.json();

    const allowedFields = [
      "title",
      "requiredSkills",
      "experienceRange",
      "techStack",
      "salaryMin",
      "salaryMax",
      "salaryCurrency",
      "location",
      "locationType",
      "employmentType",
      "linkedinPost",
      "formalDescription",
      "linkedinPostUrl",
      "status",
    ];

    const setData = { updatedAt: new Date() };
    for (const key of allowedFields) {
      if (body[key] !== undefined) setData[key] = body[key];
    }

    if (body.status === "published" && !body.publishedAt) {
      setData.publishedAt = new Date();
    }

    const [updated] = await db
      .update(jobs)
      .set(setData)
      .where(ownerFilter(jobId, user))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, job: updated });
  } catch (error) {
    console.error("Update job error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });

// DELETE /api/hiring/jobs/[jobId]
export const DELETE = withAuth(async (request, { params, user }) => {
  try {
    const { jobId } = params;
    const [deleted] = await db
      .delete(jobs)
      .where(ownerFilter(jobId, user))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete job error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
