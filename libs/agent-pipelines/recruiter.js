import { jobs, candidates } from "@/libs/schema";
import { eq, and, desc } from "drizzle-orm";
import OpenAI from "openai";

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY || "",
  baseURL: "https://api.groq.com/openai/v1",
});

export const recruiterPipeline = {
  steps: [
    {
      key: "create_job",
      label: "Create Job Posting",
      isCheckpoint: false,
      async execute(ctx) {
        const c = ctx.config;
        const jd = c.jobDefaults || {};

        const [job] = await ctx.db
          .insert(jobs)
          .values({
            userId: ctx.userId,
            title: jd.title || "Untitled Position",
            requiredSkills: jd.requiredSkills || [],
            techStack: jd.techStack || [],
            experienceRange: jd.experienceRange || null,
            location: jd.location || null,
            locationType: jd.locationType || null,
            employmentType: jd.employmentType || "full-time",
            salaryMin: jd.salaryMin || null,
            salaryMax: jd.salaryMax || null,
            salaryCurrency: jd.salaryCurrency || "USD",
            linkedinAccountId: c.linkedinAccountId || null,
            status: "draft",
          })
          .returning();

        return { jobId: job.id, title: job.title };
      },
    },
    {
      key: "generate_post",
      label: "Generate AI LinkedIn Post",
      isCheckpoint: false,
      async execute(ctx) {
        const { jobId } = ctx.stepOutputs.create_job;
        const tone = ctx.config.postTone || "professional";

        const [job] = await ctx.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
        if (!job) throw new Error("Job not found");

        const skills = (job.requiredSkills || []).join(", ") || "not specified";
        const stack = (job.techStack || []).join(", ") || "not specified";
        const salaryPart =
          job.salaryMin || job.salaryMax
            ? `Salary range: ${job.salaryCurrency || "USD"} ${job.salaryMin || "?"} – ${job.salaryMax || "?"}`
            : "";
        const applyUrl = ctx.config.appBaseUrl
          ? `${ctx.config.appBaseUrl}/apply/${job.id}`
          : "";
        const applyLine = applyUrl ? `\n- Apply link: ${applyUrl}` : "";

        const systemPrompt = `You are an expert recruiter copywriter who creates engaging LinkedIn job posts.
Write in a ${tone} tone. The post should:
- Grab attention in the first line
- Highlight what makes this role exciting
- List key skills/stack concisely
- Include practical details (location, type, salary if provided)
- End with a clear call-to-action that directs applicants to the apply link (if provided)
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
${salaryPart}${applyLine}`;

        const completion = await groq.chat.completions.create({
          model: "llama-3.1-8b-instant",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.8,
          max_tokens: 600,
        });

        const linkedinPost = completion.choices[0]?.message?.content?.trim() || "";

        await ctx.db
          .update(jobs)
          .set({ linkedinPost, updatedAt: new Date() })
          .where(eq(jobs.id, jobId));

        return { jobId, linkedinPost };
      },
    },
    {
      key: "approve_post",
      label: "Approve LinkedIn Post",
      isCheckpoint: true,
      async execute() {},
    },
    {
      key: "publish_job",
      label: "Publish Job & Post to LinkedIn",
      isCheckpoint: false,
      async execute(ctx) {
        const { jobId } = ctx.stepOutputs.create_job;

        // Mark job as published
        await ctx.db
          .update(jobs)
          .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
          .where(eq(jobs.id, jobId));

        // LinkedIn posting via Playwright would go here when LinkedIn automation is wired
        // For now, mark as published — recruiter gets a notification that it's ready to post
        return { jobId, published: true, linkedinPosted: false, note: "Job published. LinkedIn auto-posting available when account is connected." };
      },
    },
    {
      key: "monitor_candidates",
      label: "Monitor Incoming Candidates",
      isCheckpoint: false,
      async execute(ctx) {
        const { jobId } = ctx.stepOutputs.create_job;

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
    {
      key: "screen_candidates",
      label: "AI Screen & Rank Candidates",
      isCheckpoint: false,
      async execute(ctx) {
        const { jobId } = ctx.stepOutputs.create_job;
        const criteria = ctx.config.autoScreenCriteria || {};
        const minSkillMatch = criteria.minSkillMatch || 2;
        const requiredSkills = (criteria.requiredSkills || []).map((s) => s.toLowerCase());

        const allCandidates = await ctx.db
          .select()
          .from(candidates)
          .where(and(eq(candidates.jobId, jobId), eq(candidates.status, "new")));

        const ranked = [];

        for (const c of allCandidates) {
          const parsed = c.parsedData || {};
          const candidateSkills = (parsed.skills || []).map((s) => s.toLowerCase());
          const matchCount = requiredSkills.filter((rs) =>
            candidateSkills.some((cs) => cs.includes(rs) || rs.includes(cs))
          ).length;

          const score = matchCount;
          const recommended = score >= minSkillMatch ? "shortlisted" : "reviewed";

          // Update status based on screening
          await ctx.db
            .update(candidates)
            .set({ status: recommended, updatedAt: new Date() })
            .where(eq(candidates.id, c.id));

          ranked.push({
            id: c.id,
            name: c.name,
            score,
            matchedSkills: matchCount,
            recommendation: recommended,
          });
        }

        ranked.sort((a, b) => b.score - a.score);

        return {
          screened: ranked.length,
          shortlisted: ranked.filter((r) => r.recommendation === "shortlisted").length,
          reviewed: ranked.filter((r) => r.recommendation === "reviewed").length,
          rankings: ranked,
        };
      },
    },
    {
      key: "notify_shortlist",
      label: "Review Shortlist",
      isCheckpoint: true,
      async execute() {},
    },
  ],
};
