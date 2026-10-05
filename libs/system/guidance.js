// "What next?": turns what exists (jobs, posts, applicants, agents) and what is running into a short
// checklist, so the app can say where the person is and what to do. Relative imports only.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { agentActions, agentConfigs, candidates, jobPublications, jobs, linkedinAccounts, rozeeAccounts } from "../schema";
import { CANDIDATE_STATUS } from "../hiring/statuses";
import { SERVICE_ID } from "./features";
import { SETUP_PATH } from "./paths";

export { SETUP_PATH };
const PATHS = {
  platforms: "/dashboard/platforms",
  jobs: "/dashboard/recruiter/jobs",
  agent: "/dashboard/recruiter/agent",
  decisions: "/dashboard/recruiter/decisions",
  interviews: "/dashboard/recruiter/interviews",
  candidates: "/dashboard/recruiter/candidates",
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The checklist. `counts` come from the database, `running` is the list of programs that are up.
 * Each step: { id, title, detail, done, optional, href, cta }. `next` is the first required step not done yet;
 * `attention` lists things waiting for the person right now (approvals, a stopped worker with jobs waiting).
 */
export function buildGuidance({ counts, running = [], waitingJobs = 0 }) {
  const need = [SERVICE_ID.WORKER, SERVICE_ID.ENGINE, SERVICE_ID.AI_ENGINE];
  const missing = need.filter((id) => !running.includes(id));
  const labels = { [SERVICE_ID.WORKER]: "the hiring worker", [SERVICE_ID.ENGINE]: "the interview engine", [SERVICE_ID.AI_ENGINE]: "the AI engine" };

  const steps = [
    {
      id: "programs",
      title: "Start the background programs",
      detail: missing.length === 0
        ? "The hiring worker, interview engine and AI engine are running."
        : `Not running yet: ${missing.map((id) => labels[id]).join(", ")}. Screening, invites and interviews need them.`,
      done: missing.length === 0,
      href: SETUP_PATH,
      cta: "Open setup",
    },
    {
      id: "platforms",
      title: "Connect LinkedIn or Rozee.pk",
      detail: counts.platformAccounts > 0 ? "A platform account is connected." : "Optional. Without one you can still copy a post and publish it yourself.",
      done: counts.platformAccounts > 0,
      optional: true,
      href: PATHS.platforms,
      cta: "Connect",
    },
    {
      id: "job",
      title: "Create a job",
      detail: counts.jobs > 0 ? plural(counts.jobs, "job", "jobs") + " created." : "Describe the role: title, skills, location and salary.",
      done: counts.jobs > 0,
      href: PATHS.jobs,
      cta: "Create a job",
    },
    {
      id: "publish",
      title: "Publish the job",
      detail: counts.publishedJobs > 0 ? "The job is live and candidates can apply." : "Use Publish on the job: it writes a post for each platform and puts the job live.",
      done: counts.publishedJobs > 0,
      href: PATHS.jobs,
      cta: "Publish",
    },
    {
      id: "agent",
      title: "Let the Hiring agent run it",
      detail: counts.agents > 0 ? "A hiring agent is set up." : "Optional. The agent screens, shortlists and invites, and asks before anything important. Or do these steps yourself.",
      done: counts.agents > 0,
      optional: true,
      href: PATHS.agent,
      cta: "Set up the agent",
    },
    {
      id: "applicants",
      title: "Get applicants",
      detail: counts.applicants > 0
        ? `${plural(counts.applicants, "applicant", "applicants")} so far${counts.shortlisted ? `, ${counts.shortlisted} shortlisted` : ""}.`
        : "Share the apply link from the job card. Applicants are screened as they arrive.",
      done: counts.applicants > 0,
      href: PATHS.candidates,
      cta: "See candidates",
    },
    {
      id: "interviews",
      title: "Review the interviews",
      detail: counts.interviewsDone > 0 ? `${plural(counts.interviewsDone, "interview", "interviews")} finished and analysed.` : "Shortlisted candidates get a link; results appear here when they finish.",
      done: counts.interviewsDone > 0,
      href: PATHS.interviews,
      cta: "Open interviews",
    },
  ];

  const attention = [];
  if (counts.pendingApprovals > 0) {
    attention.push({ id: "approvals", title: `${plural(counts.pendingApprovals, "request is", "requests are")} waiting for you`, detail: "The Hiring agent asked before acting.", href: PATHS.decisions, cta: "Review" });
  }
  if (waitingJobs > 0 && !running.includes(SERVICE_ID.WORKER)) {
    attention.push({ id: "worker-waiting", title: `${plural(waitingJobs, "job is", "jobs are")} waiting for the hiring worker`, detail: "Nothing will move until it is running.", href: SETUP_PATH, cta: "Start it" });
  }

  const next = steps.find((s) => !s.done && !s.optional) || null;
  return { steps, next, attention };
}

/** Counts for one person's hiring work. */
export async function getGuidanceCounts(user, database = db) {
  const count = sql`count(*)::int`;
  const one = async (query) => (await query)[0]?.n || 0;
  const [jobsN, publishedN, platformsLi, platformsRz, applicants, shortlisted, interviewsDone, pending, agents] = await Promise.all([
    one(database.select({ n: count }).from(jobs).where(eq(jobs.userId, user.id))),
    one(database.select({ n: sql`count(distinct ${jobs.id})::int` }).from(jobs)
      .leftJoin(jobPublications, and(eq(jobPublications.jobId, jobs.id), eq(jobPublications.status, "published")))
      .where(and(eq(jobs.userId, user.id), sql`(${jobs.status} = 'published' or ${jobPublications.id} is not null)`))),
    one(database.select({ n: count }).from(linkedinAccounts)),
    one(database.select({ n: count }).from(rozeeAccounts)),
    one(database.select({ n: count }).from(candidates).where(eq(candidates.userId, user.id))),
    one(database.select({ n: count }).from(candidates).where(and(eq(candidates.userId, user.id), inArray(candidates.status, [
      CANDIDATE_STATUS.SHORTLISTED, CANDIDATE_STATUS.INTERVIEW_INVITED, CANDIDATE_STATUS.INTERVIEW_IN_PROGRESS,
      CANDIDATE_STATUS.INTERVIEW_COMPLETED, CANDIDATE_STATUS.FINAL_SHORTLISTED, CANDIDATE_STATUS.HIRED,
    ])))),
    one(database.select({ n: count }).from(candidates).where(and(eq(candidates.userId, user.id), inArray(candidates.status, [
      CANDIDATE_STATUS.INTERVIEW_COMPLETED, CANDIDATE_STATUS.FINAL_SHORTLISTED, CANDIDATE_STATUS.FINAL_REJECTED, CANDIDATE_STATUS.HIRED,
    ])))),
    one(database.select({ n: count }).from(agentActions).where(and(eq(agentActions.userId, user.id), eq(agentActions.status, "pending")))),
    one(database.select({ n: count }).from(agentConfigs).where(and(eq(agentConfigs.userId, user.id), eq(agentConfigs.pipelineType, "recruiter")))),
  ]);
  return {
    jobs: jobsN, publishedJobs: publishedN, platformAccounts: platformsLi + platformsRz, applicants, shortlisted,
    interviewsDone, pendingApprovals: pending, agents,
  };
}
