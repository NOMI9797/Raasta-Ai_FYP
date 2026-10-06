# CLAUDE.md — Raasta-AI

This file is read automatically by Claude Code. Keep it short; details live in `docs/ai-hiring/`.

## What this repo is

Raasta-AI is a Final Year Project: a multi-platform AI-powered **Recruitment** and **Client Acquisition** system.

- **Client Acquisition (Sales):** campaigns → leads → LinkedIn post scraping → AI messages → invites.
- **Hiring (Recruiter):** jobs → AI job posts → publish (LinkedIn/Rozee) → public apply form → resume parsing → candidates.

**Current work (branch `feature/ai-hiring-pipeline`):** build the **AI Hiring Pipeline**. It covers AI resume screening, auto-shortlisting, interview invitations, a browser-based **Raasta AI Interviewer**, post-interview analysis and a final shortlist.
Start with `docs/ai-hiring/README.md`.

## Stack

- Next.js 14 App Router, **JavaScript** (some `.ts` in `libs/`), React 18, Tailwind + **DaisyUI**, `lucide-react` icons, TanStack Query, `react-hot-toast`.
- PostgreSQL via **Drizzle ORM** (`libs/db.ts`, `libs/schema.js` + `libs/schema.ts`).
- NextAuth (`libs/next-auth.js`), route protection via `withAuth()` in `libs/auth-middleware.js`.
- Redis via `ioredis` (`libs/redis.js` → `getRedisClient()`, `RedisStreamManager`).
- LLM: Groq through the OpenAI SDK (`baseURL: https://api.groq.com/openai/v1`).
- Email: Mailgun (`libs/mailgun.js` → `sendEmail({to, subject, text, html})`).
- Playwright for LinkedIn/Rozee automation.

## Commands

```bash
npm run dev            # Next.js on http://localhost:8085 (compiles each screen on first visit: slow on a laptop)
npm run serve          # the same app as a production build on :8085, much faster to use (docs/ai-hiring/21-performance.md)
npm run build
npm run lint
npm run db:studio      # Drizzle studio
# New in this branch (see docs/ai-hiring/15-env-deployment.md):
npm run engine:dev     # interview engine (WebSocket) on :8090
npm run worker:hiring  # hiring worker. Optional: the web server starts it by itself (HIRING_WORKER_MODE=external to run it yourself)
cd services/ai-engine && uvicorn main:app --port 8000   # Python AI engine
docker compose up      # everything together
npm run check:branding # fails if the legacy source name appears anywhere
```

## Conventions (follow existing code)

- API routes: `export const GET = withAuth(async (request, { params, user }) => {...}, { requireUser: true })`. Next 14 `params` is a plain object, so don't `await` it.
- Ownership: admins see everything; others are filtered by `jobs.userId === user.id`. Copy `ownerFilter()` from `app/api/hiring/jobs/[jobId]/route.js`.
- Responses use `NextResponse.json({ success: true, ... })` or `{ error }` with the right status code.
- Groq client: `new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: "https://api.groq.com/openai/v1" })`. For new code, use `libs/ai/llm.js` (created in Phase 0).
- UI: DaisyUI classes (`btn`, `card`, `badge`, `tabs`, `modal`), lucide icons, client components with `"use client"`.
- Code in `libs/interview/`, `libs/hiring/`, `libs/ai/`, `libs/agent/`, `services/` and `workers/` **must use relative imports, not `@/`**, because it also runs outside Next.js under `tsx`.

## Hard rules

1. **Single product identity.** The interview feature is native to Raasta-AI. Never write the name of the legacy source project in code, comments, docs, commit messages, file names, env vars or UI. The interviewer is "Raasta AI Interviewer". Check: `npm run check:branding` must pass (script: `scripts/check-branding.sh`).
2. **The legacy source lives outside the repo** at `../interview-engine-src/` (read-only reference). Never copy it in wholesale, never add it as a submodule, and never copy its git history, binaries (`*.exe`, `*.h5`, `*.task`), test outputs, uploads or its frontend.
3. **Schema changes go in both `libs/schema.js` and `libs/schema.ts`**, plus a hand-written SQL migration in `drizzle/` (next number `0019`). Do **not** run `drizzle-kit generate`, because the journal is out of sync. See `docs/ai-hiring/05-data-model.md`.
4. **Postgres only.** No MongoDB or Mongoose in new code.
5. **Candidate statuses come from `libs/hiring/statuses.js`.** Never hard-code status strings in routes or UI.
6. **Human in the loop for rejections** unless the job's `hiring_config.autoFinalize` is true.
7. **Never log raw interview tokens, resume text or API keys.**
8. Work **one phase at a time** (`docs/ai-hiring/16-phases-and-prompts.md`). Finish the phase's acceptance checks, update the checklist there, then stop and summarise.
9. Don't touch Sales/Client-Acquisition code unless a phase says so.
10. **No native browser dialogs.** Use `useDialog()` from `components/ui/DialogProvider.js` (`confirm`, `alert`) instead of `window.confirm` / `alert`.

## Where things are

| Area | Path |
|---|---|
| Hiring APIs | `app/api/hiring/**` |
| Public apply form | `app/apply/[jobId]/page.js`, `app/api/hiring/apply/[jobId]/route.js` |
| Recruiter UI | `app/dashboard/recruiter/**`, sidebar `components/layout/Sidebar.js` |
| Sales conversations & meetings | Replies read over IMAP (`libs/sales/inbox/`), answered from the knowledge base (`libs/sales/conversation/`: read, decide, compose, reply), follow-ups and meeting booking (`libs/sales/meetings/`: slots, ICS, settings); agent step `libs/sales/agent/conversations.js`; pages `app/dashboard/sales/{conversations,meetings}/` |
| Sales knowledge base (RAG) | `libs/sales/knowledge/` (chunk, local embeddings, pgvector + keyword hybrid search, grounded answers); page `app/dashboard/sales/knowledge/` |
| Sales agent | `libs/sales/agent/` (policy, planner, scoring, tick `advanceSalesRun`, launch). Same supervised engine as the hiring agent (`libs/agent/`), run by the hiring worker |
| Schema / DB | `libs/schema.{js,ts}`, `libs/db.ts`, `drizzle/` |
| New: AI helpers | `libs/ai/` |
| New: hiring logic | `libs/hiring/` |
| New: interview logic | `libs/interview/` |
| New: supervised recruiter agent | `libs/agent/` (policy, runs, actions, worker tick); UI `app/dashboard/recruiter/agent/**` |
| New: job publishing (LinkedIn, Rozee.pk) | `libs/hiring/platform-content.js`, `libs/hiring/publishing.js`; panel `app/dashboard/recruiter/components/PublishPanel.js` |
| New: interview engine (WS) | `services/interview-engine/` |
| New: Python AI engine | `services/ai-engine/` |
| New: background worker | `workers/hiring-worker.js` |
| New: setup guide (start / stop programs, guidance) | `libs/system/`, `components/system/`, `app/dashboard/recruiter/setup/` |
| New: worker run by the web server | `instrumentation.js`, `instrumentation-node.js`, `libs/system/worker-host.js` |
| New: speed (fast production mode, dev warm-up) | `scripts/serve.js`, `libs/system/dev-warmup.js`, `next.config.js` |
| New: candidate interview room | `app/interview/[token]/` |
| Feature docs | `docs/ai-hiring/` |
