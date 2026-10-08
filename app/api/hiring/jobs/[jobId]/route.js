import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { validateHiringConfig } from "@/libs/hiring/config";

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
      "rozeePost",
      "indeedPost",
      "formalDescription",
      "linkedinPostUrl",
      "status",
    ];

    const setData = { updatedAt: new Date() };
    for (const key of allowedFields) {
      if (body[key] !== undefined) setData[key] = body[key];
    }

    // Hiring automation settings: a partial update merges onto the job's saved settings,
    // then the whole config is validated and stored normalised (weights sum to 1)
    if (body.hiringConfig !== undefined) {
      const [existing] = await db
        .select({ hiringConfig: jobs.hiringConfig })
        .from(jobs)
        .where(ownerFilter(jobId, user))
        .limit(1);
      if (!existing) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }
      const incoming = body.hiringConfig;
      const saved = existing.hiringConfig || {};
      const merged = incoming && typeof incoming === "object" && !Array.isArray(incoming)
        ? { ...saved, ...incoming, finalWeights: { ...(saved.finalWeights || {}), ...(incoming.finalWeights || {}) } }
        : incoming;
      const { config, errors } = validateHiringConfig(merged);
      if (errors.length) {
        return NextResponse.json({ error: "Invalid hiring settings", details: errors }, { status: 400 });
      }
      setData.hiringConfig = config;
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
