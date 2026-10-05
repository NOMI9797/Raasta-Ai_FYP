import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { jobs } from "@/libs/schema";
import { and, eq } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { previewAgent } from "@/libs/agent/recruiter-agent";

// GET /api/agents/preview?jobId=&mode=&dailyInviteCap= — dry run: what the recruiter agent would
// do for this job right now. Changes nothing.
export const GET = withAuth(async (request, { user }) => {
  try {
    const params = new URL(request.url).searchParams;
    const jobId = params.get("jobId");
    if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    const [job] = await db.select().from(jobs)
      .where(user.role === "admin" ? eq(jobs.id, jobId) : and(eq(jobs.id, jobId), eq(jobs.userId, user.id)))
      .limit(1);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const cap = Number(params.get("dailyInviteCap"));
    const preview = await previewAgent(job, {
      mode: params.get("mode"),
      ...(Number.isInteger(cap) && cap > 0 ? { dailyInviteCap: cap } : {}),
    });
    return NextResponse.json({ success: true, preview });
  } catch (error) {
    console.error("Agent preview error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
