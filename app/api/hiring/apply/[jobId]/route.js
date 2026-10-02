import { NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/libs/db";
import { candidates, jobs } from "@/libs/schema";
import { eq, and, sql } from "drizzle-orm";
import { CANDIDATE_STATUS } from "@/libs/hiring/statuses";
import { getHiringConfig } from "@/libs/hiring/config";
import { enqueue } from "@/libs/hiring/queue";
import { notify, NOTIFICATION_TYPES } from "@/libs/notifications";
import { putObject, deleteObject } from "@/libs/hiring/storage";
import {
  RESUME_TYPES,
  resumeExtension,
  validateResumeFile,
  buildParsedData,
} from "@/libs/hiring/resume-text";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const duplicateResponse = () =>
  NextResponse.json({ error: "You have already applied for this position" }, { status: 409 });

function sameApplicant(jobId, email) {
  return and(eq(candidates.jobId, jobId), sql`lower(${candidates.email}) = ${email}`);
}

// POST /api/hiring/apply/[jobId] — public endpoint for candidates to apply
export async function POST(request, { params }) {
  try {
    const { jobId } = params;
    // A malformed link is just an unknown job, not a server error
    if (!UUID_PATTERN.test(jobId)) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const [job] = await db
      .select()
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

    const formData = await request.formData();
    const name = formData.get("name")?.toString().trim();
    const email = formData.get("email")?.toString().trim().toLowerCase();
    const linkedinUrl = formData.get("linkedinUrl")?.toString().trim() || null;
    const coverNote = formData.get("coverNote")?.toString().trim() || null;
    const resumeFile = formData.get("resume");
    const hasResume = resumeFile && typeof resumeFile.arrayBuffer === "function" && resumeFile.size > 0;

    if (!name || !email) {
      return NextResponse.json(
        { error: "Name and email are required" },
        { status: 400 }
      );
    }

    if (!EMAIL_PATTERN.test(email)) {
      return NextResponse.json({ error: "Please enter a valid email address" }, { status: 400 });
    }

    if (hasResume) {
      const fileError = validateResumeFile({ filename: resumeFile.name, size: resumeFile.size });
      if (fileError) {
        return NextResponse.json({ error: fileError }, { status: 400 });
      }
    }

    // Fail fast on duplicates before storing or parsing anything
    const [existing] = await db
      .select({ id: candidates.id })
      .from(candidates)
      .where(sameApplicant(job.id, email))
      .limit(1);
    if (existing) return duplicateResponse();

    let resumeKey = null;
    let resumeUrl = null;
    let parsedData = null;

    if (hasResume) {
      const ext = resumeExtension(resumeFile.name);
      const buffer = Buffer.from(await resumeFile.arrayBuffer());
      resumeUrl = resumeFile.name.slice(0, 255); // original filename, for display

      const key = `resumes/${job.id}/${crypto.randomUUID()}${ext}`;
      try {
        await putObject(key, buffer, RESUME_TYPES[ext]);
        resumeKey = key;
      } catch (error) {
        // Keep the application even if storage is down; the parsed text is still saved
        console.error("Resume storage failed:", error?.message);
      }

      parsedData = await buildParsedData({ buffer, filename: resumeFile.name });
    }

    // Serialise concurrent submissions for the same job + email, then re-check
    const candidate = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${job.id}:${email}`}))`);
      const [dup] = await tx
        .select({ id: candidates.id })
        .from(candidates)
        .where(sameApplicant(job.id, email))
        .limit(1);
      if (dup) return null;

      const [created] = await tx
        .insert(candidates)
        .values({
          jobId: job.id,
          userId: job.userId,
          name,
          email,
          linkedinUrl,
          coverNote,
          resumeUrl,
          resumeKey,
          parsedData,
          status: CANDIDATE_STATUS.NEW,
        })
        .returning();
      return created;
    });

    if (!candidate) {
      if (resumeKey) await deleteObject(resumeKey).catch(() => {});
      return duplicateResponse();
    }

    // Screening is asynchronous; a queue outage must not lose the application
    if (getHiringConfig(job).autoScreen) {
      try {
        await enqueue("screen-candidate", { candidateId: candidate.id });
      } catch (error) {
        console.error("Failed to queue screening:", error?.message);
      }
    }

    await notify({
      userId: job.userId,
      type: NOTIFICATION_TYPES.NEW_APPLICATION,
      title: `New application for ${job.title}`,
      body: `${name} applied${hasResume ? " with a resume" : ""}.`,
      link: `/dashboard/recruiter/jobs/${job.id}/candidates`,
    });

    return NextResponse.json({
      success: true,
      message: "Application submitted successfully",
      candidateId: candidate.id,
    });
  } catch (error) {
    console.error("Apply error:", error?.message);
    return NextResponse.json(
      { error: "Failed to submit application" },
      { status: 500 }
    );
  }
}
