# AI Hiring Pipeline: Documentation

These docs specify how to build Raasta-AI's **AI Hiring Pipeline**. They are written for engineers and for Claude Code. Read them in order the first time, then use them as reference while working phase by phase.

## The pipeline in one line

**Job post → Applications → AI resume shortlist → Interview link sent → AI interview → AI analysis → Final shortlist → Recruiter decides**

## Documents

| # | File | What it covers |
|---|---|---|
| 01 | [01-pipeline-overview.md](01-pipeline-overview.md) | The full flow in plain words, the candidate status machine, who does what |
| 02 | [02-architecture.md](02-architecture.md) | Processes, folders, how they talk, request/data flows |
| 03 | [03-existing-codebase.md](03-existing-codebase.md) | What already exists in this repo, conventions, known quirks |
| 04 | [04-source-port-map.md](04-source-port-map.md) | How to port the legacy interview source into Raasta-AI (file-by-file), debranding rules |
| 05 | [05-data-model.md](05-data-model.md) | New tables/columns, Drizzle code, SQL migration `0009` |
| 06 | [06-stage1-screening.md](06-stage1-screening.md) | AI resume screening + auto-shortlist |
| 07 | [07-question-bank.md](07-question-bank.md) | AI-generated interview questions per job |
| 08 | [08-invitations.md](08-invitations.md) | Tokens, emails, reminders, expiry |
| 09 | [09-interview-engine.md](09-interview-engine.md) | WebSocket engine, STT, interview loop, TTS, protocol |
| 10 | [10-interview-room.md](10-interview-room.md) | Candidate-facing interview page (`/interview/[token]`) |
| 11 | [11-stage2-evaluation.md](11-stage2-evaluation.md) | Recording analysis, final score, final shortlist |
| 12 | [12-recruiter-ui.md](12-recruiter-ui.md) | Recruiter screens, Kanban, sidebar |
| 13 | [13-workers-automation.md](13-workers-automation.md) | Redis job queue, hiring worker, agent-pipeline steps |
| 14 | [14-ai-engine.md](14-ai-engine.md) | Python service: TTS, voice, emotion, gaze, face |
| 15 | [15-env-deployment.md](15-env-deployment.md) | Env vars, npm scripts, Docker Compose, Nginx |
| 16 | [16-phases-and-prompts.md](16-phases-and-prompts.md) | **Phase checklist + copy-paste prompts for Claude Code** |
| 17 | [17-testing.md](17-testing.md) | Test plan, fixtures, manual demo script |
| 18 | [18-report-updates.md](18-report-updates.md) | What to change in the FYP report |
| 19 | [19-platform-publishing.md](19-platform-publishing.md) | Posting a job to LinkedIn and Rozee.pk: one post per platform, limits, hand-off, review of the platform connection |
| 20 | [20-setup-and-services.md](20-setup-and-services.md) | Setup guide: see, start and stop the four programs from the app, and the on-screen guidance |
| 21 | [21-performance.md](21-performance.md) | Why `npm run dev` is slow, `npm run serve` (fast production mode), the dev warm-up |
| 22 | [22-demo-test-cases.md](22-demo-test-cases.md) | The demo test script (`npm run demo:tests`): 100 cases across the pipeline, how each case is judged, and how the tests themselves were checked |

## One-time setup

```bash
# 1. Branch
git checkout main && git pull
git checkout -b feature/ai-hiring-pipeline

# 2. Put the legacy interview source NEXT TO the repo (never inside it)
#    Unzip the interview source archive and rename the folder:
#    <parent>/Raasta-Ai_FYP/            ← this repo
#    <parent>/interview-engine-src/     ← legacy source (read-only reference)

# 3. Copy CLAUDE.md, docs/ai-hiring/ and scripts/check-branding.sh into the repo, then commit
git add CLAUDE.md docs/ai-hiring scripts/check-branding.sh
git commit -m "docs: AI hiring pipeline specification"
```

Open Claude Code in the repo root. It reads `CLAUDE.md` automatically, and `CLAUDE.md` points it here.

## How to work with Claude Code

1. Do **one phase per session**. Paste the prompt for that phase from [16-phases-and-prompts.md](16-phases-and-prompts.md).
2. Ask Claude Code to **plan first**. Review the plan, then let it implement.
3. When it finishes, run the phase's acceptance checks yourself.
4. Commit with a message like `feat(hiring): phase 2 – AI resume screening`.
5. If you give Claude Code access to `../interview-engine-src/`, tell it explicitly that the folder is read-only.

## Decisions already made

| Topic | Decision |
|---|---|
| Interview medium | **In-browser interview room** (no Google Meet, no third-party meeting bot) |
| Database | PostgreSQL only (Drizzle). No MongoDB |
| LLM | Groq via shared `libs/ai/llm.js`, model configurable |
| Speech-to-text | Deepgram streaming (`nova-3`); fallback Groq Whisper |
| Text-to-speech | Kokoro-82M inside `services/ai-engine` |
| Background jobs | Redis Streams consumer (`workers/hiring-worker.js`) |
| Recordings / resumes | Object storage (S3-compatible); local disk in development |
| Rejections | Need recruiter approval unless `autoFinalize` is enabled per job |
| Naming | "Raasta AI Interviewer". No legacy names anywhere |

## Open questions (fill in when decided)

- [ ] Deployment target for the long-running services (VM / cloud provider): ______
- [ ] Deepgram key available? If not, use the Whisper fallback: ______
- [ ] Default thresholds: min fit score ___, final threshold ___
- [ ] Facial-emotion analysis in scope for the demo? (needs TensorFlow) ______
