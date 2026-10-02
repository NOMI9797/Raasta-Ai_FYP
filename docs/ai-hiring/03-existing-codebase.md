# 03 · Existing Codebase (what's already here)

Snapshot of `main` at commit `fa594fe` (May 2026). Verify before relying on any line numbers.

## Hiring module today

| Piece | File | Notes |
|---|---|---|
| Jobs CRUD | `app/api/hiring/jobs/route.js`, `app/api/hiring/jobs/[jobId]/route.js` | `ownerFilter(jobId, user)` pattern |
| AI job post | `app/api/hiring/jobs/[jobId]/generate-post/route.js` | Groq |
| Public apply page | `app/apply/[jobId]/page.js` | Name, email, LinkedIn, cover note, resume |
| Apply API | `app/api/hiring/apply/[jobId]/route.js` | Text extraction (mammoth for DOCX; **naive regex for PDF**), LLM parse (`llama-3.3-70b-versatile`), inserts candidate `status:"new"`. **The resume file is not stored:** `resumeUrl = "uploaded:<filename>"`. Raw text is kept in `parsedData._resumeText` (10k chars) |
| Re-parse | `app/api/hiring/candidates/[candidateId]/reparse/route.js` | Uses `_resumeText` |
| Candidate list | `app/api/hiring/candidates/route.js` | |
| Candidate PATCH/DELETE | `app/api/hiring/candidates/[candidateId]/route.js` | `ALLOWED = ["new","reviewed","shortlisted","rejected"]`, **hard-coded** |
| Recruiter pages | `app/dashboard/recruiter/{jobs,candidates,pipeline}/page.js`, `app/dashboard/recruiter/jobs/[jobId]/candidates/page.js` | Job candidates page has `statusBadge()` and expandable parsed-resume cards |
| Kanban | `app/dashboard/recruiter/pipeline/page.js` | `STAGES` array, **hard-coded**; drag → PATCH status |
| Sidebar | `components/layout/Sidebar.js` | Recruiter group: `requireMode: "recruiter"`, children Jobs/Candidates/Pipeline |
| Agent pipeline | `libs/agent-pipelines/recruiter.js` | Steps: `load_job, generate_post, approve_post*, post_to_linkedin, publish_to_rozee, scrape_rozee_applicants, monitor_candidates, screen_candidates, notify_shortlist*` (* = checkpoint). `screen_candidates` = naive skill-substring count ≥ `minSkillMatch` |
| Agent runner | `libs/agent-runner.js` | Runs steps, persists `agent_runs`/`agent_steps`, modes `full_auto` / `semi_auto` |
| Agent UI | `app/dashboard/agents/**`, APIs `app/api/agents/**` | Run SSE stream pattern in `app/api/agents/runs/[runId]/stream/route.js` |

## `candidates.parsedData` shape (LLM output)

```json
{
  "name": "", "location": "", "email": "", "phone": "", "github": "", "linkedin": "",
  "summary": "",
  "skills": ["..."],
  "skillsByCategory": { "languages": [], "frontend": [], "backend": [], "databases": [], "tools": [], "other": [] },
  "yearsExperience": 3,
  "jobTitles": [],
  "experience": [{ "title": "", "company": "", "period": "", "bullets": [] }],
  "projects":   [{ "name": "", "description": "", "technologies": [] }],
  "education":  [{ "degree": "", "institution": "", "period": "" }],
  "availability": null,
  "strengths": [],
  "_resumeText": "first 10k chars"
}
```
It may instead be `{ "parseError": "..." }`.

## `jobs` columns used by this feature

`id, userId, title, requiredSkills (json string[]), experienceRange, techStack (json string[]), salaryMin, salaryMax, salaryCurrency, location, locationType, employmentType, linkedinPost, formalDescription, status (draft|published|closed)`

Job description text for AI = `formalDescription || linkedinPost || title`.

## Conventions

```js
// Route handler pattern
import { NextResponse } from "next/server";
import { db } from "@/libs/db";
import { jobs, candidates } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { withAuth } from "@/libs/auth-middleware";

function ownerFilter(jobId, user) {
  return user.role === "admin" ? eq(jobs.id, jobId) : and(eq(jobs.id, jobId), eq(jobs.userId, user.id));
}

export const GET = withAuth(async (request, { params, user }) => {
  try {
    const { jobId } = params;
    // ...
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("X error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { requireUser: true });
```

- `user` is the Drizzle `users` row: `id, email, name, role (admin|sales_operator|recruiter), modes (json)`.
- Session on the client: `useSession()` → `session.user.role`, `session.user.modes`.
- Redis: `import { getRedisClient } from "../redis"` (ioredis, `lazyConnect`).
- Email: `import { sendEmail } from "../mailgun"`; sender comes from `config.mailgun.fromNoReply` / `fromAdmin` in `config.js`.
- Background work today: `app/api/campaigns/[id]/start-workflow/route.js` spawns `npx tsx workers/workflow-worker.js <jobId>`. The new hiring worker is **long-running** instead (see [13-workers-automation.md](13-workers-automation.md)).

## Quirks to respect

1. **Two schema files.** `libs/schema.js` (resolved first at runtime) and `libs/schema.ts` (drizzle-kit). Keep them identical in tables and columns.
2. **Migration journal out of sync.** `drizzle/meta/_journal.json` lists up to `0007`; `0008_user_modes.sql` exists but is not in the journal; the `0002` SQL is missing. Hand-write `drizzle/0009_ai_hiring.sql` and apply it with `psql "$DATABASE_URL" -f drizzle/0009_ai_hiring.sql` (or `npm run db:push` after a review). Use `IF NOT EXISTS` everywhere.
3. **`libs/db.ts` forces `ssl: 'require'`.** A local non-SSL Postgres will fail. Make it `ssl: process.env.DATABASE_SSL === 'false' ? false : 'require'` in Phase 1.
4. **`@/` alias only works inside Next.js.** Code that the engine or worker imports (`libs/ai`, `libs/hiring`, `libs/interview`, `libs/db.ts`, `libs/schema.*`, `libs/redis.js`, `libs/mailgun.js`) must use relative imports. `libs/mailgun.js` imports `@/config`, so change it to `../config` in Phase 0.
5. **Vercel config** (`vercel.json`) limits functions to 300s. Long-running processes can't run there, which is why the engine and worker are separate.
6. Package name is still the template's `ship-fast-code`, and `README.md` is template boilerplate. Leave both alone unless asked.
7. The FYP report says resume parsing uses spaCy, but the code uses an LLM. See [18-report-updates.md](18-report-updates.md).
