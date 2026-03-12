import { jobs, candidates, linkedinAccounts } from "@/libs/schema";
import { eq, and, desc } from "drizzle-orm";
import OpenAI from "openai";
import { testLinkedInSession, cleanupBrowserSession } from "@/libs/linkedin-session-validator";
import { publishLinkedInPost } from "@/libs/linkedin-post-publisher";

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

        // Build the public apply form URL
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

    // ─── Step 4: Post to LinkedIn via Playwright and mark job published ───
    {
      key: "post_to_linkedin",
      label: "Post to LinkedIn",
      isCheckpoint: false,
      async execute(ctx) {
        const { jobId } = ctx.stepOutputs.load_job || ctx.stepOutputs.generate_post;
        const accountId = ctx.config.accountId;

        if (!accountId) {
          // No LinkedIn account linked — just mark job as published locally
          await ctx.db
            .update(jobs)
            .set({
              status: "published",
              publishedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(jobs.id, jobId));

          return {
            jobId,
            published: true,
            linkedinPosted: false,
            note: "Job published locally. No LinkedIn account configured for auto-posting.",
          };
        }

        // Load account
        const [account] = await ctx.db
          .select()
          .from(linkedinAccounts)
          .where(eq(linkedinAccounts.id, accountId))
          .limit(1);

        if (!account) throw new Error("LinkedIn account not found");

        // Always read latest post content from jobs table so any regenerations
        // (from Hiring page or agent UI) are respected.
        const [job] = await ctx.db
          .select()
          .from(jobs)
          .where(eq(jobs.id, jobId))
          .limit(1);
        if (!job || !job.linkedinPost) {
          throw new Error("No LinkedIn post content found for this job");
        }

        // Validate session and get browser
        const sessionCheck = await testLinkedInSession(account, true);
        if (!sessionCheck.isValid) {
          throw new Error(`LinkedIn session invalid: ${sessionCheck.reason}`);
        }

        let result;
        try {
          result = await publishLinkedInPost(sessionCheck.page, job.linkedinPost);
        } finally {
          await cleanupBrowserSession(sessionCheck.context);
        }

        if (!result.success) {
          throw new Error(`LinkedIn posting failed: ${result.error}`);
        }

        // Update job in DB
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
          newCount: allCandidates.filter((c) => c.status === "new").length,
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

    // ─── Step 6: AI Screen & Rank Candidates ───
    {
      key: "screen_candidates",
      label: "AI Screen & Rank Candidates",
      isCheckpoint: false,
      async execute(ctx) {
        const { jobId } = ctx.stepOutputs.load_job;
        const criteria = ctx.config.autoScreenCriteria || {};
        const minSkillMatch = criteria.minSkillMatch || 2;

        const [job] = await ctx.db
          .select()
          .from(jobs)
          .where(eq(jobs.id, jobId))
          .limit(1);
        const requiredSkills = (job?.requiredSkills || []).map((s) =>
          s.toLowerCase()
        );

        const allCandidates = await ctx.db
          .select()
          .from(candidates)
          .where(
            and(eq(candidates.jobId, jobId), eq(candidates.status, "new"))
          );

        const ranked = [];

        for (const c of allCandidates) {
          const parsed = c.parsedData || {};
          const candidateSkills = (parsed.skills || []).map((s) =>
            s.toLowerCase()
          );
          const matchCount = requiredSkills.filter((rs) =>
            candidateSkills.some(
              (cs) => cs.includes(rs) || rs.includes(cs)
            )
          ).length;

          const recommended =
            matchCount >= minSkillMatch ? "shortlisted" : "reviewed";

          await ctx.db
            .update(candidates)
            .set({ status: recommended, updatedAt: new Date() })
            .where(eq(candidates.id, c.id));

          ranked.push({
            id: c.id,
            name: c.name,
            score: matchCount,
            recommendation: recommended,
          });
        }

        ranked.sort((a, b) => b.score - a.score);

        return {
          screened: ranked.length,
          shortlisted: ranked.filter((r) => r.recommendation === "shortlisted")
            .length,
          reviewed: ranked.filter((r) => r.recommendation === "reviewed").length,
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
