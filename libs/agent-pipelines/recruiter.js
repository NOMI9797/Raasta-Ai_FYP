import { jobs, candidates } from "@/libs/schema";
import { eq, and, desc, isNotNull } from "drizzle-orm";
import OpenAI from "openai";
import { getAdapter } from "@/libs/platforms";
import { CANDIDATE_STATUS } from "@/libs/hiring/statuses";
import { screenCandidate } from "@/libs/hiring/fit-scorer";
import { applyShortlist } from "@/libs/hiring/shortlist";

const SCREEN_CONCURRENCY = 3;

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY || "",
  baseURL: "https://api.groq.com/openai/v1",
});

export const recruiterPipeline = {
  steps: [
    // ─── Step 1: Load existing job selected by the user ───
    {
      key: "load_job",
      label: "Load Selected Job",
      isCheckpoint: false,
      async execute(ctx) {
        const { jobId } = ctx.config;
        if (!jobId) throw new Error("No jobId in agent config — select a job first.");

        const [job] = await ctx.db
          .select()
          .from(jobs)
          .where(eq(jobs.id, jobId))
          .limit(1);

        if (!job) throw new Error("Selected job not found in the database.");

        return {
          jobId: job.id,
          title: job.title,
          requiredSkills: job.requiredSkills || [],
          techStack: job.techStack || [],
          experienceRange: job.experienceRange,
          location: job.location,
          locationType: job.locationType,
          employmentType: job.employmentType,
          existingPost: job.linkedinPost || null,
          status: job.status,
        };
      },
    },

    // ─── Step 2: Generate AI LinkedIn post + attach apply form link ───
    {
      key: "generate_post",
      label: "Generate AI LinkedIn Post",
      isCheckpoint: false,
      async execute(ctx) {
        const { jobId } = ctx.stepOutputs.load_job;
        const tone = ctx.config.postTone || "professional";

        const [job] = await ctx.db
          .select()
          .from(jobs)
          .where(eq(jobs.id, jobId))
          .limit(1);
        if (!job) throw new Error("Job not found");

        const skills = (job.requiredSkills || []).join(", ") || "not specified";
        const stack = (job.techStack || []).join(", ") || "not specified";
        const salaryPart =
          job.salaryMin || job.salaryMax
            ? `Salary range: ${job.salaryCurrency || "USD"} ${job.salaryMin || "?"} – ${job.salaryMax || "?"}`
            : "";

        const baseUrl =
          ctx.config.appBaseUrl ||
          process.env.NEXTAUTH_URL ||
          process.env.NEXT_PUBLIC_APP_URL ||
          "http://localhost:3000";
        const applyUrl = `${baseUrl}/apply/${job.id}`;

        const systemPrompt = `You are an expert recruiter copywriter who creates engaging LinkedIn job posts.
Write in a ${tone} tone. The post should:
- Grab attention in the first line
- Highlight what makes this role exciting
- List key skills/stack concisely
- Include practical details (location, type, salary if provided)
- End with a clear call-to-action directing applicants to the apply link
- Use relevant emojis sparingly
- Be 150–250 words
Return ONLY the LinkedIn post text, nothing else.`;

        const userPrompt = `Create a LinkedIn job post for: "${job.title}"

Details:
- Required skills: ${skills}
- Tech stack: ${stack}
- Experience: ${job.experienceRange || "not specified"}
- Location: ${job.location || "not specified"} (${job.locationType || "not specified"})
- Employment type: ${job.employmentType || "full-time"}
${salaryPart}
- Apply link: ${applyUrl}`;

        const completion = await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.8,
          max_tokens: 600,
        });

        const linkedinPost =
          completion.choices[0]?.message?.content?.trim() || "";

        if (!linkedinPost) throw new Error("AI returned an empty post");

        await ctx.db
          .update(jobs)
          .set({ linkedinPost, updatedAt: new Date() })
          .where(eq(jobs.id, jobId));

        return { jobId, linkedinPost, applyUrl };
      },
    },

    // ─── Step 3: Checkpoint — recruiter reviews / approves the generated post ───
    //    In full_auto this step is skipped by the AgentRunner.
    {
      key: "approve_post",
      label: "Approve LinkedIn Post",
      isCheckpoint: true,
      async execute() {},
    },

    // ─── Step 4: Publish job to LinkedIn (via platform adapter) ───
    {
      key: "post_to_linkedin",
      label: "Post to LinkedIn",
      isCheckpoint: false,
      async execute(ctx) {
        const { jobId } = ctx.stepOutputs.load_job || ctx.stepOutputs.generate_post;
        const accountId = ctx.config.accountId;

        if (!accountId) {
          await ctx.db
            .update(jobs)
            .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
            .where(eq(jobs.id, jobId));

          return {
            jobId,
            published: true,
            linkedinPosted: false,
            note: "Job published locally. No LinkedIn account configured for auto-posting.",
          };
        }

        const adapter = getAdapter("linkedin");
        const account = await adapter.getAccount(accountId);
        if (!account) throw new Error("LinkedIn account not found");

        const [job] = await ctx.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
        if (!job || !job.linkedinPost) {
          throw new Error("No LinkedIn post content found for this job");
        }

        const result = await adapter.publishJob(account, job);
        if (!result.success) {
          throw new Error(`LinkedIn posting failed: ${result.error}`);
        }

        await ctx.db
          .update(jobs)
          .set({
            status: "published",
            publishedAt: new Date(),
            linkedinPostUrl: result.postUrl || null,
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, jobId));

        return {
          jobId,
          published: true,
          linkedinPosted: true,
          postUrl: result.postUrl || null,
        };
      },
    },

    // ─── Step 4b: Publish job to Rozee.pk (optional, via platform adapter) ───
    {
      key: "publish_to_rozee",
      label: "Publish to Rozee.pk",
      isCheckpoint: false,
      async execute(ctx) {
        const { jobId } = ctx.stepOutputs.load_job || ctx.stepOutputs.generate_post;
        const rozeeAccountId = ctx.config.rozeeAccountId;

        if (!rozeeAccountId) {
          return { jobId, rozeePublished: false, skipped: true, note: "No Rozee account configured" };
        }

        const adapter = getAdapter("rozee");
        const account = await adapter.getAccount(rozeeAccountId);
        if (!account) throw new Error("Rozee account not found");

        const [job] = await ctx.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
        if (!job) throw new Error("Job not found");

        const result = await adapter.publishJob(account, job);
        if (!result?.success) {
          throw new Error(`Rozee publish failed: ${result?.error || "unknown"}`);
        }

        await ctx.db
          .update(jobs)
          .set({
            rozeeAccountId,
            rozeePost: result.postContent || job.linkedinPost || null,
            rozeePostUrl: result.postUrl || null,
            rozeePublishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, jobId));

        return { jobId, rozeePublished: true, rozeePostUrl: result.postUrl || null };
      },
    },

    // ─── Step 4c: Scrape Rozee.pk applicants into candidates table (optional) ───
    {
      key: "scrape_rozee_applicants",
      label: "Scrape Rozee Applicants",
      isCheckpoint: false,
      async execute(ctx) {
        const { jobId } = ctx.stepOutputs.load_job;
        const rozeeAccountId = ctx.config.rozeeAccountId;
        if (!rozeeAccountId) {
          return { jobId, scraped: 0, skipped: true, note: "No Rozee account configured" };
        }

        const adapter = getAdapter("rozee");
        const account = await adapter.getAccount(rozeeAccountId);
        if (!account) throw new Error("Rozee account not found");

        const [job] = await ctx.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
        if (!job) throw new Error("Job not found");

        const scrapeResult = await adapter.scrapeApplicants(account, job, {
          limit: ctx.config.rozeeApplicantLimit || 25,
        });

        if (!scrapeResult.success) {
          throw new Error(`Rozee scrape failed: ${scrapeResult.error || "unknown"}`);
        }

        let inserted = 0;
        for (const candidate of scrapeResult.candidates || []) {
          if (!candidate?.profileUrl) continue;
          try {
            await ctx.db.insert(candidates).values({
              userId: ctx.userId,
              jobId,
              name: candidate.name || "Rozee Candidate",
              email: candidate.email || `rozee_${Date.now()}_${inserted}@unknown.local`,
              linkedinUrl: candidate.profileUrl,
              status: CANDIDATE_STATUS.NEW,
              source: "rozee",
              sourceData: candidate,
              parsedData: {
                skills: candidate.skills || [],
                summary: candidate.summary || candidate.headline || null,
                location: candidate.location || null,
                experience: candidate.experience || [],
              },
            });
            inserted += 1;
          } catch {
            // Likely a duplicate or constraint error — skip silently
          }
        }

        return { jobId, scraped: (scrapeResult.candidates || []).length, inserted };
      },
    },

    // ─── Step 5: Monitor incoming candidates ───
    {
      key: "monitor_candidates",
      label: "Monitor Incoming Candidates",
      isCheckpoint: false,
      async execute(ctx) {
        const { jobId } = ctx.stepOutputs.load_job;

        const allCandidates = await ctx.db
          .select()
          .from(candidates)
          .where(eq(candidates.jobId, jobId))
          .orderBy(desc(candidates.appliedAt));

        return {
          jobId,
          totalCandidates: allCandidates.length,
          newCount: allCandidates.filter((c) => c.status === CANDIDATE_STATUS.NEW).length,
          candidates: allCandidates.map((c) => ({
            id: c.id,
            name: c.name,
            email: c.email,
            status: c.status,
            hasParsedData: !!c.parsedData?.skills?.length,
          })),
        };
      },
    },

    // ─── Step 6: AI resume screening + stage-1 shortlist (docs/ai-hiring/06 §5) ───
    //    Doesn't send interview invites; that is a separate step.
    {
      key: "screen_candidates",
      label: "AI Resume Screening",
      isCheckpoint: false,
      async execute(ctx) {
        const { jobId } = ctx.stepOutputs.load_job;

        const [job] = await ctx.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
        if (!job) throw new Error("Job not found");

        const pending = await ctx.db
          .select({ id: candidates.id })
          .from(candidates)
          .where(and(eq(candidates.jobId, jobId), eq(candidates.status, CANDIDATE_STATUS.NEW)));

        // Score a few at a time to stay inside the LLM rate limit and the route time limit
        const failed = [];
        let screened = 0;
        for (let i = 0; i < pending.length; i += SCREEN_CONCURRENCY) {
          const batch = pending.slice(i, i + SCREEN_CONCURRENCY);
          const results = await Promise.allSettled(batch.map((c) => screenCandidate(c.id, { database: ctx.db })));
          results.forEach((r, idx) => {
            if (r.status === "fulfilled" && !r.value.skipped) screened += 1;
            else if (r.status === "rejected") failed.push(batch[idx].id);
          });
        }

        // minFitScore comes from the job's hiring config; the agent config is only a fallback
        const fallbackMin = ctx.config.autoScreenCriteria?.minFitScore;
        const overrides =
          job.hiringConfig?.minFitScore == null && Number.isFinite(fallbackMin) ? { minFitScore: fallbackMin } : {};
        const shortlist = await applyShortlist(jobId, { triggeredBy: "agent", overrides, database: ctx.db });

        // Report the job's totals, not just this run's changes (the worker may shortlist concurrently)
        const ranked = await ctx.db
          .select({ id: candidates.id, name: candidates.name, fitScore: candidates.fitScore, status: candidates.status })
          .from(candidates)
          .where(and(eq(candidates.jobId, jobId), isNotNull(candidates.fitScore)))
          .orderBy(desc(candidates.fitScore));

        return {
          screened,
          failed: failed.length,
          shortlisted: ranked.filter((c) => c.status === CANDIDATE_STATUS.SHORTLISTED).length,
          notShortlisted: ranked.filter((c) => c.status === CANDIDATE_STATUS.NOT_SHORTLISTED).length,
          minFitScore: shortlist.minFitScore,
          maxShortlist: shortlist.maxShortlist,
          rankings: ranked,
        };
      },
    },

    // ─── Step 7: Checkpoint — recruiter reviews shortlist ───
    {
      key: "notify_shortlist",
      label: "Review Shortlist",
      isCheckpoint: true,
      async execute() {},
    },
  ],
};
