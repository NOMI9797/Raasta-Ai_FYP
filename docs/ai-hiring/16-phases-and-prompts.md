# 16 · Phases, Checklists and Claude Code Prompts

Work strictly in order, one phase per Claude Code session. After each phase:
1. Run its acceptance checks.
2. Run `npm run lint`, `npm run build`, `npm run check:branding` and `npm run test:hiring` (once tests exist).
3. Tick the boxes below and commit: `feat(hiring): phase N – <name>`.

### How to prompt Claude Code
Start every session with the phase prompt below. They all follow the same pattern:
- Name the phase and its docs.
- Ask for a **plan first**, then implementation after your "go".
- Restate the hard rules from `CLAUDE.md`.
- Ask for a summary of changed files plus how to test.

If Claude Code drifts, remind it: *"Re-read CLAUDE.md and docs/ai-hiring/<file>. Stay inside Phase N."*

---

## Phase 0: Foundations and restructure

**Docs:** 02, 03, 04, 15

**Tasks**
- [x] Create the folders: `libs/ai/`, `libs/hiring/`, `libs/interview/`, `libs/interview/stt/`, `services/interview-engine/`, `services/ai-engine/`, `workers/`, `tests/hiring/`, `tests/fixtures/`.
- [x] `libs/ai/llm.js` (spec below).
- [x] `libs/hiring/config.js` and `libs/hiring/statuses.js` (from 05).
- [x] `libs/mailgun.js`: change `import config from "@/config"` to a relative import (`../config`).
- [x] `libs/db.ts`: SSL configurable via `DATABASE_SSL`.
- [x] Root `package.json`: scripts + deps from 15; `.env.example`; `.gitignore` gets `.storage/`, `services/ai-engine/.venv/`, `__pycache__/`.
- [x] `scripts/check-branding.sh` in place and wired to `npm run check:branding`.
- [x] Engine skeleton: `services/interview-engine/index.js` with `/health` and a WS endpoint that verifies the ticket and echoes `session_ready`.
- [x] Worker skeleton: `workers/hiring-worker.js` with the consumer group loop and a `ping` job type. (`libs/hiring/queue.js` was pulled forward from Phase 1 because the worker needs `enqueue()` for retries.)
- [x] ai-engine skeleton: `main.py` with `/health` + auth dependency, `requirements.txt`, `Dockerfile`.

**`libs/ai/llm.js` spec**
```js
// Groq through the OpenAI SDK. Relative imports only.
export async function chatText({ system, user, messages, model, temperature = 0.7, maxTokens = 400 })
export async function chatJSON({ system, user, messages, model, temperature = 0.2, maxTokens = 1200, schemaHint })
// chatJSON: response_format {type:'json_object'}; strips ``` fences; JSON.parse; on parse error retries once
// with "Return ONLY valid JSON" appended; throws LlmError {code:'parse'|'rate_limit'|'upstream', retryAfterMs}
export async function transcribe({ wavBuffer, model = 'whisper-large-v3-turbo' }) // Groq audio transcription
```

**Acceptance**
- `npm run build` passes; `npm run engine:dev`, `npm run worker:hiring` and `uvicorn main:app` all start; `/health` endpoints respond.
- `npm run check:branding` passes.

**Prompt**
```
We're on branch feature/ai-hiring-pipeline. Read CLAUDE.md and docs/ai-hiring/README.md, 02-architecture.md, 03-existing-codebase.md, 04-source-port-map.md and 15-env-deployment.md.
Implement Phase 0 from docs/ai-hiring/16-phases-and-prompts.md exactly. The legacy source at ../interview-engine-src/ is read-only reference; do not copy files wholesale and never write its project name anywhere.
First give me a short plan (files to create/modify), wait for my "go", then implement. Finish with: list of changed files, commands to verify, and anything you couldn't do.
```

---

## Phase 1: Data layer and resume storage

**Docs:** 05, 06 §1, 15

**Tasks**
- [x] Add the tables and columns from 05 to **both** `libs/schema.js` and `libs/schema.ts`.
- [x] Write `drizzle/0009_ai_hiring.sql` (from 05); apply it to a dev DB.
- [x] `libs/hiring/storage.js`: `putObject(key, buffer, contentType)`, `getObjectStream(key)`, `getSignedUrl(key, seconds)`, `listKeys(prefix)`, `deleteObject(key)`. Drivers `local` (under `STORAGE_LOCAL_DIR`) and `s3` (`@aws-sdk/client-s3`, optional `S3_ENDPOINT`). For `local`, `getSignedUrl` returns `/api/files/<signed-token>`; add that route (HMAC token with expiry, owner check not required because the token is the authorisation).
- [x] `libs/hiring/resume-text.js` (pdf-parse → fallback). `next.config.js` lists `pdf-parse` in `serverComponentsExternalPackages`; bundled by webpack it fails.
- [x] Update the apply route as in 06 §1 (validate, store, extract, dedupe, enqueue if autoScreen).
- [x] `GET /api/hiring/candidates/[candidateId]/resume`.
- [x] Candidate PATCH route uses `canTransition` from `statuses.js`.
- [x] `libs/hiring/queue.js` `enqueue()` (from 13). Done in Phase 0.

**Acceptance**
- The migration applies cleanly, and `npm run db:studio` shows the new tables.
- Applying with a PDF stores the file; the recruiter can download it; `parsedData` is richer than before for a multi-page PDF.
- Applying twice with the same email returns 409.

**Prompt**
```
Read CLAUDE.md, docs/ai-hiring/05-data-model.md, 06-stage1-screening.md (section 1 only), 13-workers-automation.md (queue section) and 15-env-deployment.md.
Implement Phase 1 from docs/ai-hiring/16-phases-and-prompts.md. Update BOTH libs/schema.js and libs/schema.ts identically. Hand-write drizzle/0009_ai_hiring.sql; do NOT run drizzle-kit generate.
Plan first, wait for "go", then implement. End with verification steps including the psql command to apply the migration.
```

---

## Phase 2: Stage 1 AI screening and shortlist

**Docs:** 06, 13, 12 §2–3

**Tasks**
- [x] `libs/ai/prompts/fit.js` + `libs/hiring/fit-scorer.js` (prompt, rubric, post-processing, synonyms).
- [x] `libs/hiring/shortlist.js` (`applyShortlist`).
- [x] Worker handlers: `screen-candidate`, `shortlist-job` (debounced).
- [x] APIs: `POST /api/hiring/jobs/[jobId]/screen`, `POST /api/hiring/candidates/[candidateId]/screen`, `POST /api/hiring/jobs/[jobId]/shortlist` (backs the Re-run shortlist button); `PATCH /api/hiring/jobs/[jobId]` accepts a validated `hiringConfig`; the candidates list returns the new fields.
- [x] UI: fit badges, screening section, Screen/Re-run buttons, Hiring automation card (12 §2).
- [x] Agent pipeline: new `screen_candidates` body.

**Acceptance:** the 06 acceptance list + 10 fixture resumes ranked sensibly.

**Prompt**
```
Read CLAUDE.md and docs/ai-hiring/06-stage1-screening.md, 13-workers-automation.md, 12-recruiter-ui.md (sections 2 and 3).
Implement Phase 2 from docs/ai-hiring/16-phases-and-prompts.md. Use libs/ai/llm.js chatJSON for the LLM. Status strings only from libs/hiring/statuses.js.
Plan first, wait for "go". Afterwards give me a manual test script using the fixtures in tests/fixtures/resumes/.
```

---

## Phase 3: Question bank

**Docs:** 07

**Tasks**
- [x] `libs/ai/prompts/questions.js` + `libs/interview/question-generator.js` (+ validation).
- [x] Worker handlers `ensure-questions`, `personalise-questions`.
- [x] APIs from 07.
- [x] UI page `app/dashboard/recruiter/jobs/[jobId]/interview-questions/page.js` with dnd reorder.

**Acceptance:** 07 acceptance list.

**Prompt**
```
Read CLAUDE.md and docs/ai-hiring/07-question-bank.md. Implement Phase 3 from docs/ai-hiring/16-phases-and-prompts.md. Reuse @dnd-kit (already installed) for reordering. Plan first, wait for "go".
```

---

## Phase 4: AI engine (Python)

**Docs:** 14, 04 (server rows)

**Tasks**
- [x] Port TTS, voice, emotion and gaze from `../interview-engine-src/server/` into routers; storage-key inputs; auth.
- [x] `/media/concat` with ffmpeg.
- [x] Optional face router behind `FACE_ANALYSIS_ENABLED`.
- [x] Dockerfile; README with run steps.

**Acceptance:** 14 acceptance list.

**Prompt**
```
Read CLAUDE.md, docs/ai-hiring/14-ai-engine.md and the server rows of docs/ai-hiring/04-source-port-map.md.
Implement Phase 4: build services/ai-engine by porting logic from ../interview-engine-src/server/ (read-only). Rewrite file paths to storage keys, add bearer-token auth, split into routers, never include the legacy project name, and don't commit any model weights.
Plan first, wait for "go".
```

---

## Phase 5: Interview engine (core)

**Docs:** 09, 04 (loop rules), 05

**Tasks**
- [x] `libs/interview/{tokens,mappers,answer-analyzer,answer-scorer,follow-up,tts-client,repository,events}.js`.
- [x] `libs/interview/session-engine.js` (`InterviewSession`): port the loop **preserving every rule in 04**.
- [x] STT adapters: Deepgram + Whisper fallback.
- [x] `services/interview-engine/{index,session-manager}.js`: ticket auth, protocol from 09, snapshots, resume, shutdown.
- [x] Unit tests for the session engine with fake deps (see 17).
- [x] Test client script `scripts/interview-test-client.js` that streams fixture WAVs.

**Acceptance:** 09 acceptance list + unit tests pass.

**Prompt**
```
Read CLAUDE.md, docs/ai-hiring/09-interview-engine.md, docs/ai-hiring/04-source-port-map.md (especially "Interview loop rules", analyzer, scorer, follow-up), 05-data-model.md and 17-testing.md.
Implement Phase 5. Port the interview loop from ../interview-engine-src/backend/modules/webhooks/controllers/webhookController.js and the analyzer/scorer/follow-up services, but adapt it to STT events + WebSocket output and Postgres (Drizzle). Preserve: single-flight lock acquired before any await, pre-speak guard with rollback, reschedule in finally, follow-up depth cap, scoring looked up from the full question list, skip heuristic with logging. Make InterviewSession dependency-injected so it is unit-testable.
Plan first (include the state machine you'll implement), wait for "go".
```

---

## Phase 6: Candidate interview room + invitations

**Docs:** 10, 08

**Tasks**
- [x] Public APIs under `app/api/interview/[token]/` with rate limits.
- [x] `app/interview/layout.js`, `app/interview/[token]/page.js` + components (welcome, consent, device check, interview, completed, error states).
- [x] `public/worklets/pcm16-downsampler.js`; recorder + upload queue; WS client with reconnect.
- [x] `libs/hiring/invitations.js`, `libs/hiring/emails.js`; worker handlers `send-invite`, `send-reminder`; sweep job.
- [x] Recruiter APIs: invite / resend / extend / cancel.

**Acceptance:** 08 + 10 acceptance lists, including one full interview end-to-end in Chrome.

**Prompt**
```
Read CLAUDE.md, docs/ai-hiring/10-interview-room.md, 08-invitations.md and 09-interview-engine.md (protocol section).
Implement Phase 6. The candidate pages must be public (no NextAuth), use a minimal Raasta-AI branded layout, and never show scores. Plan first, wait for "go". Afterwards give me a step-by-step manual test from "shortlist a candidate" to "interview completed".
```

---

## Phase 7: Stage 2 analysis and final evaluation

**Docs:** 11, 13

**Tasks**
- [x] Worker handlers: `assemble-recording`, `analyse-interview`, `finalize-candidate`, `send-outcome-email`.
- [x] `libs/interview/analysis-client.js`, `libs/hiring/final-evaluator.js` (communication score formula, final score, LLM summary, decision guard).
- [x] Decision APIs (11 §3).

**Acceptance:** 11 acceptance list.

**Prompt**
```
Read CLAUDE.md, docs/ai-hiring/11-stage2-evaluation.md and 13-workers-automation.md. Implement Phase 7. The communication-score and final-score formulas must be deterministic and unit-tested. Rejections require recruiter approval unless hiringConfig.autoFinalize is true. Plan first, wait for "go".
```

---

## Phase 8: Recruiter UI and agent pipeline

**Docs:** 12, 13 (agent section)

**Tasks**
- [x] **Supervised recruiter agent** (replaces "agent pipeline steps 8–14 + `resume-from` endpoint"): `libs/agent/` policy (Assisted / Autopilot, per-action routes, escalations), event-driven `agent-advance` worker ticks, `agent_actions` approval inbox + audit trail, pause / resume / stop, dry-run preview, migration `0011`. See 13 (agent section).
- [x] `AgentConfigForm` fields: mode with the policy, min fit score / max shortlist (saved on the job), invites per day, preview.
- [x] Decisions page (agent approvals + stage-2 decisions) and the "Decisions" sidebar item.
- [x] Sidebar "Interviews"; interviews list (`GET /api/hiring/interviews`, filters, paging); interview detail with Live / Summary / Q&A / Transcript / Recording / Communication / Integrity tabs (`GET /api/hiring/interviews/[id]`); live SSE route; delete recording (privacy).
- [x] Kanban rework (six stages, transition-aware drop); job candidates page: Interview and Final badges and the status-specific actions (12 §3).
- [x] Admin queue card (`GET /api/admin/hiring-queue`, `POST /api/admin/hiring-queue/retry`).
- [ ] Dashboard home "Hiring" stats card (12 §9, optional): not built.

**Acceptance:** 12 acceptance list; a `semi_auto` agent run goes from JD to final shortlist with 3 approvals (post, shortlist, final).

**Prompt**
```
Read CLAUDE.md, docs/ai-hiring/12-recruiter-ui.md and the agent pipeline section of 13-workers-automation.md. Implement Phase 8 in DaisyUI matching existing recruiter pages. No hard-coded status strings. Plan first, wait for "go".
```

---

## Phase 9: Hardening, deployment, demo

**Docs:** 15, 17, 18

**Tasks**
- [ ] Rate limits on public routes; token/PII log audit; error pages.
- [ ] `docker-compose.yml`, `Dockerfile.web`, `Dockerfile.node`, `nginx/raasta.conf`.
- [ ] Load test: 3 concurrent scripted interviews.
- [ ] Seed script `scripts/seed-hiring-demo.js` (1 job, 10 applicants from fixtures).
- [ ] Demo script (17 §4) rehearsed.
- [ ] Report updates (18).

**Prompt**
```
Read CLAUDE.md, docs/ai-hiring/15-env-deployment.md and 17-testing.md. Implement Phase 9: hardening, Docker Compose deployment files, the demo seed script and the load test. Plan first, wait for "go".
```

---

## Progress log
| Phase | Status | Date | Commit | Notes |
|---|---|---|---|---|
| 0 | ☑ | 2026-10-02 | `feat(hiring): phase 0 – foundations and restructure` | Full `npm run build` still fails on pre-existing lint errors in 5 non-hiring files; verified with `npm run build -- --no-lint`. Docker images not built (no Docker in the dev container). |
| 1 | ☑ | 2026-10-02 | `feat(hiring): phase 1 – data layer and resume storage` | Verified on local Postgres 16 + Redis: migration applies twice cleanly and matches `schema.ts` (`db:push` reports no changes); PDF stored and downloaded byte-identical; duplicate → 409. LLM parse tested with a stub (no Groq key in the dev container). Added `STORAGE_SIGNING_SECRET`. |
| 2 | ☑ | 2026-10-02 | `feat(hiring): phase 2 – AI resume screening and shortlist` | End-to-end on local Postgres + Redis + worker with a stub LLM (`LLM_BASE_URL`): 10 fixtures → 9 screened, 1 debounced shortlist run, exactly top 3 shortlisted with min 70 / max 3. The real-score acceptance (strong ≥ 75, unrelated < 40) still needs a run with a Groq key. Hooks to queue `ensure-questions` / `send-invite` after shortlisting are wired in Phases 3 and 6. |
| 3 | ☑ | 2026-10-02 | `feat(hiring): phase 3 – interview question bank` | Verified on local Postgres + Redis + worker with a stub LLM: shortlist → ensure-questions builds an 8-question bank (warm-up, technical, role, behavioral; invalid question dropped); personalise-questions only for candidates with screening gaps; append/replace/reorder/edit/soft and hard delete; editing a question leaves an existing interview snapshot unchanged. Real-model check (8 valid questions, ≥ 3 keywords each) still needs a Groq key. |
| 4 | ☑ | 2026-10-02 | `feat(hiring): phase 4 – AI engine` | 34 pytest tests pass. Real: storage, /media/concat (MediaRecorder chunks and separate files), voice metrics on the fixture, gaze with the real MediaPipe model on a real face, face router with a stand-in classifier. TTS and speech emotion tested with stand-in models only: huggingface.co and download.pytorch.org were blocked in the dev container, so the `/tts` → playable WAV acceptance must be run on a machine that can reach HuggingFace. |
| 5 | ☑ | 2026-10-02 | `feat(hiring): phase 5 – interview engine` | 116 unit tests pass (all 11 session-engine scenarios from 17, plus analyzer, scorer, follow-up, STT adapters and session manager). End-to-end on local Postgres + Redis + engine + ai-engine (TTS 503 → `audio:null`, browser speech) with espeak-ng fixture WAVs, a stub LLM and a scripted transcriber (the speech-model hosts are blocked in the dev container): 3-question interview completes (12 turns, 5 scored responses, weighted score, candidate `interview_completed`, `analyse-interview` queued); `answer_done` → next question in < 50 ms with the stub LLM; drop mid-answer → reconnect resumes the same question, with the time away excluded; talking during processing merges into the answer and never produces two questions. Found and fixed during e2e: the silence window now also counts voice activity, because Whisper finals lag behind speech. Real Groq latency (target ≤ 4 s) and Deepgram still need a run with keys. `analyse-interview` has no worker handler until Phase 8. |
| 6 | ☑ | 2026-10-03 | `feat(hiring): phase 6 – interview room and invitations` | 134 unit tests pass. End-to-end on Windows (local Postgres test DB, Redis in WSL, Next.js, worker, engine, stub LLM, dev outbox) — 56/56 checks: manual shortlist → auto-invite email in 0.5 s (exactly one); public API codes (404 unknown/replaced, 410 expired/cancelled, 409 completed, 403 before consent, 429 after 10 session calls); full interview through the token link (scripted candidate, 5 answers, analyse-interview queued); upload parts stored and assemble-recording queued; resend invalidates the old link; cancel; expiry on access + extend; reminder rotates the token; expire/abandon sweeps; drop mid-answer → new ticket → same question; no token in any server log. Browser (Playwright Chromium, fake mic/camera) — 17/17: welcome → consent → device check → greeting → Start → Q1, audio and video parts uploaded, refresh resumes the same question without overwriting parts, mic audio reaches the engine. AudioWorklets never load in browsers started from the dev shell on this machine, so the room now falls back to a ScriptProcessor path after 5 s (same 16 kHz output). The real-voice Chrome/Edge acceptance (speech → captions, echo cancellation with speakers) still needs a run with GROQ_API_KEY or DEEPGRAM_API_KEY on a desktop. `assemble-recording` / `analyse-interview` handlers come in Phase 7. |
| 7 | ☑ | 2026-10-03 | `feat(hiring): phase 7 – stage 2 analysis and final evaluation` | 149 Node unit tests and 37 ai-engine tests pass (formulas hand-checked: pace, fluency, composure, renormalisation without video, final score, needs_review guard). End-to-end on Windows with the real ai-engine (voice, speech emotion, MediaPipe gaze), Postgres test DB, Redis in WSL and a stub LLM — 39/39: interview → late uploads → recording assembled → analysis → communication 76, final 69 with breakdown, LLM summary with the name scrubbed, 66 s after the uploads; autoFinalize off stays interview_completed; decisions API (400/409/403, final shortlist → hired), outcome emails, bulk approve (needs_review left), re-analyse keeps the decision; autoFinalize on + no video → applied by the system with eye contact dropped; 1 of 3 answered → needs_review, never auto-applied; no tokens or answer text in logs. Fixed on the way: concurrent audio/video assembly race; ai-engine `/media/concat` now handles a reload mid-interview (several recorder streams); voice analysis no longer needs librosa (blocked by Windows Smart App Control here; jitter/shimmer null without it). TTS is blocked by the same policy on this PC (browser voice used). Recruiter screens for decisions come in Phase 8. |
| 8 | ☑ | 2026-10-05 | `feat(hiring): phase 8 – supervised recruiter agent`, `feat(hiring): phase 8 – interviews, pipeline board and admin queue` | **Recruiter UI (2026-10-05):** 191 Node unit tests pass (21 new for the UI half: byte ranges and local range reads, list filters, recording links, queue overview and retry, `allowedMovesToStage`); lint 0 errors; `next build` succeeds in a throw-away copy. Browser run on the dev server with throw-away recruiter and admin users (removed afterwards): interviews list and filters; detail page with every tab; transcript timestamp → the player starts at that moment (needs the new Range support); timeline markers; live tab fed with the engine's event types over Redis, then the interview finishing switches the page by itself; delete recording (files and keys gone, scores and transcript kept, re-analysis refused, repeat is a no-op, refused while the interview runs); Kanban drops (refused with a hint / one option applied / menu for two) and the Move menu; row actions Invite, Approve suggestion, Mark hired; admin queue card with worker-down warning, failed jobs and Retry. Found and fixed on the way: recording links were unresolved promises (signing is async) — now awaited and tested; badge wrapping on narrow screens. **Agent (2026-10-04):** 170 Node unit tests pass (21 new: policy matrix, escalations, planners, `buildPlan`). End-to-end on a fresh test DB (built from `schema.ts`; `0011` re-applied twice matches it exactly) + Redis db 2 + stub LLM — 44/44: Assisted run stops before publishing; post, shortlist (invites approved with it) and final decision approvals = the 3 approvals in the acceptance; no candidate status changes without approval; borderline / unreadable / needs_review escalated and refused in bulk; recruiter override (shortlist instead of hold back) and notes kept in the audit trail; idempotent ticks; pause / resume; Autopilot shortlists clear matches, asks about the borderline one, never holds anyone back by itself, respects the daily invite cap and sends the rest the next day; the worker's auto-invite stands down on a managed job; requests for candidates the recruiter handled directly are withdrawn; stop withdraws open requests. Real worker process: agent-advance tick, shortlist, invite queued, lock released (5/5). Browser check on the dev server (throwaway test user, removed afterwards): Agents page, run card, Decisions page; approve post, bulk approve, accept final decision → applied by the next tick. Found and fixed: a candidate with an approved-but-not-yet-applied request showed up again in the classic decisions list. |
| 9 | ☐ | | | |

### Changes between phases
- **2026-10-05: speed** (not a phase): `npm run serve` runs the app as a production build (sum of first visits of the main screens 51 s to 2.5 s; sign in to Home 1.2 s), `npm run dev` gets a background warm-up of the first screens, external server packages, longer-lived compiled screens and opt-in React Query devtools, `EMAIL_OUTBOX=local` keeps the dev email outbox in a local production run, and migration `0013` adds indexes for jobs, candidates and agent runs (21, 05). 275 Node unit tests pass (9 new), lint 0 errors, branding check passes.
- **2026-10-05: worker inside the web server, hiring agent workflow** (not a phase): the web server starts the hiring worker with itself, restarts it, wakes it when a job is queued, and the worker stops with the server (20); the agent run card, Agents page and Decisions page now say what the agent is doing and whether it needs the person (12). 266 Node unit tests pass (27 new), lint 0 errors. Verified on the real dev server: the worker was started by the server, came back 2 seconds after being killed, stopped with the old server and was started by the new one; a throw-away agent went start, working, 1 request waiting, approved (carried out in about a second), waiting for applicants; a real application through the public form was screened and the agent asked for a shortlist decision. Found and fixed on the way: a restart was held back by a cached answer; a dead worker looked alive for 30 seconds so nothing restarted it; the old supervisor tests could have started a real worker. Cause of the reported problem: no worker was running, the card never refreshed unless opened, and it offered Decisions for a run that had nothing to ask.
- **2026-10-05: setup guide** (not a phase): start, stop and watch the worker, interview engine and AI engine from the web app, with a checklist, a strip on the main screens, guards before the agent and invites, and a sidebar dot (20). 239 Node unit tests pass (26 new), lint 0 errors. Checked in a browser with throw-away users (removed afterwards): the page, starting and stopping the engine and the AI engine, the stop warning, the guard offering to start the AI engine before an invite and carrying on afterwards. The real worker command was run with Redis pointed at a dead port so it could not touch any data. Found and fixed on the way: a reading shared for two seconds hid a program that had just started; acronyms were lower-cased in dialog titles (AI engine); the page now refreshes when the tab regains focus.
- **2026-10-05: publishing, hiring agent page, dialogs** (not a phase): per-platform job posts and a publish panel (19, migration `0012`), the hiring agent separated from the sales agent (12, 13), custom dialogs instead of native confirm / alert (12). 209 Node unit tests pass (18 new), lint 0 errors, branding check passes. The publishing service was run end to end against a development database with a fake platform adapter (9 scenarios); the panel, the hiring agent page, the sales agent page and the dialogs were checked in the browser with throw-away users (removed afterwards). Nothing was posted to LinkedIn or Rozee.pk during testing. Found and fixed on the way: an empty model answer produced a post that was only the apply link; a second click while a post was going out was reported as "too soon" instead of "already publishing"; one Escape closed every stacked modal.
