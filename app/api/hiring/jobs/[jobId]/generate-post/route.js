import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { jobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";
import { LlmError } from "@/libs/ai/llm";
import { POST_PLATFORMS, generatePlatformPost, getPlatformSpec, jobApplyUrl } from "@/libs/hiring/platform-content";

function ownerFilter(jobId, user) {
  return user.role === "admin" ? eq(jobs.id, jobId) : and(eq(jobs.id, jobId), eq(jobs.userId, user.id));
}

function describeError(error) {
  if (error instanceof LlmError && error.code === "rate_limit") return "The AI is busy right now. Try again in a minute.";
  return error?.message || "Failed to generate the post";
}

// POST /api/hiring/jobs/[jobId]/generate-post  { platform?: "linkedin" | "rozee" | "indeed" | "all", tone? }
// Writes a post fitted to each platform (format, length, hashtags, emojis) and saves it on the job.
export const POST = withAuth(async (request, { params, user }) => {
  try {
    const { jobId } = params;
    const body = await request.json().catch(() => ({}));
    const tone = typeof body.tone === "string" ? body.tone : "professional";
    const platforms = body.platform === "all" ? [...POST_PLATFORMS] : [body.platform || "linkedin"];
    const unknown = platforms.filter((p) => !POST_PLATFORMS.includes(p));
    if (unknown.length) {
      return NextResponse.json({ error: `Unknown platform "${unknown[0]}". Use ${POST_PLATFORMS.join(", ")} or all.` }, { status: 400 });
    }

    const [job] = await db.select().from(jobs).where(ownerFilter(jobId, user)).limit(1);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    // The apply link is built here, never taken from the browser, so a post can't be made to point elsewhere
    const applyUrl = jobApplyUrl(job.id, new URL(request.url).origin);
    const settled = await Promise.allSettled(platforms.map((platform) => generatePlatformPost({ job, platform, tone, applyUrl })));

    const posts = {};
    const errors = {};
    const patch = { updatedAt: new Date() };
    settled.forEach((outcome, i) => {
      const platform = platforms[i];
      if (outcome.status === "fulfilled") {
        posts[platform] = outcome.value;
        patch[getPlatformSpec(platform).field] = outcome.value.text;
      } else {
        errors[platform] = describeError(outcome.reason);
      }
    });

    if (Object.keys(posts).length === 0) {
      const first = Object.values(errors)[0];
      const busy = settled.some((o) => o.status === "rejected" && o.reason instanceof LlmError && o.reason.code === "rate_limit");
      return NextResponse.json({ error: first, errors }, { status: busy ? 429 : 502 });
    }

    const [updated] = await db.update(jobs).set(patch).where(ownerFilter(jobId, user)).returning();
    return NextResponse.json({
      success: true,
      posts,
      errors,
      linkedinPost: posts.linkedin?.text,
      rozeePost: posts.rozee?.text,
      indeedPost: posts.indeed?.text,
      job: updated,
    });
  } catch (error) {
    console.error("Generate post error:", error.message);
    return NextResponse.json({ error: describeError(error) }, { status: 500 });
  }
}, { requireUser: true });
