import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { jobs } from "@/libs/schema";
import { eq } from "drizzle-orm";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/hiring/apply/[jobId]/info — public: return safe job details for the apply form
export async function GET(request, { params }) {
  try {
    const { jobId } = params;
    if (!UUID_PATTERN.test(jobId)) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const [job] = await db
      .select({
        id: jobs.id,
        title: jobs.title,
        location: jobs.location,
        locationType: jobs.locationType,
        employmentType: jobs.employmentType,
        experienceRange: jobs.experienceRange,
        requiredSkills: jobs.requiredSkills,
        formalDescription: jobs.formalDescription,
        status: jobs.status,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status === "closed") {
      return NextResponse.json(
        { error: "This position is no longer accepting applications" },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, job });
  } catch (error) {
    console.error("Job info error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
