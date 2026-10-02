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
- [ ] `libs/ai/prompts/fit.js` + `libs/hiring/fit-scorer.js` (prompt, rubric, post-processing, synonyms).
- [ ] `libs/hiring/shortlist.js` (`applyShortlist`).
- [ ] Worker handlers: `screen-candidate`, `shortlist-job` (debounced).
- [ ] APIs: `POST /api/hiring/jobs/[jobId]/screen`, `POST /api/hiring/candidates/[candidateId]/screen`; `PATCH /api/hiring/jobs/[jobId]` accepts a validated `hiringConfig`; the candidates list returns the new fields.
- [ ] UI: fit badges, screening section, Screen/Re-run buttons, Hiring automation card (12 §2).
- [ ] Agent pipeline: new `screen_candidates` body.

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
- [ ] `libs/ai/prompts/questions.js` + `libs/interview/question-generator.js` (+ validation).
- [ ] Worker handlers `ensure-questions`, `personalise-questions`.
- [ ] APIs from 07.
- [ ] UI page `app/dashboard/recruiter/jobs/[jobId]/interview-questions/page.js` with dnd reorder.

**Acceptance:** 07 acceptance list.

**Prompt**
```
Read CLAUDE.md and docs/ai-hiring/07-question-bank.md. Implement Phase 3 from docs/ai-hiring/16-phases-and-prompts.md. Reuse @dnd-kit (already installed) for reordering. Plan first, wait for "go".
```

---

## Phase 4: AI engine (Python)

**Docs:** 14, 04 (server rows)

**Tasks**
- [ ] Port TTS, voice, emotion and gaze from `../interview-engine-src/server/` into routers; storage-key inputs; auth.
- [ ] `/media/concat` with ffmpeg.
- [ ] Optional face router behind `FACE_ANALYSIS_ENABLED`.
- [ ] Dockerfile; README with run steps.

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
- [ ] `libs/interview/{tokens,mappers,answer-analyzer,answer-scorer,follow-up,tts-client,repository,events}.js`.
- [ ] `libs/interview/session-engine.js` (`InterviewSession`): port the loop **preserving every rule in 04**.
- [ ] STT adapters: Deepgram + Whisper fallback.
- [ ] `services/interview-engine/{index,session-manager}.js`: ticket auth, protocol from 09, snapshots, resume, shutdown.
- [ ] Unit tests for the session engine with fake deps (see 17).
- [ ] Test client script `scripts/interview-test-client.js` that streams fixture WAVs.

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
- [ ] Public APIs under `app/api/interview/[token]/` with rate limits.
- [ ] `app/interview/layout.js`, `app/interview/[token]/page.js` + components (welcome, consent, device check, interview, completed, error states).
- [ ] `public/worklets/pcm16-downsampler.js`; recorder + upload queue; WS client with reconnect.
- [ ] `libs/hiring/invitations.js`, `libs/hiring/emails.js`; worker handlers `send-invite`, `send-reminder`; sweep job.
- [ ] Recruiter APIs: invite / resend / extend / cancel.

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
- [ ] Worker handlers: `assemble-recording`, `analyse-interview`, `finalize-candidate`, `send-outcome-email`.
- [ ] `libs/interview/analysis-client.js`, `libs/hiring/final-evaluator.js` (communication score formula, final score, LLM summary, decision guard).
- [ ] Decision APIs (11 §3).

**Acceptance:** 11 acceptance list.

**Prompt**
```
Read CLAUDE.md, docs/ai-hiring/11-stage2-evaluation.md and 13-workers-automation.md. Implement Phase 7. The communication-score and final-score formulas must be deterministic and unit-tested. Rejections require recruiter approval unless hiringConfig.autoFinalize is true. Plan first, wait for "go".
```

---

## Phase 8: Recruiter UI and agent pipeline

**Docs:** 12, 13 (agent section)

**Tasks**
- [ ] Sidebar items; interviews list; interview detail (tabs) + live SSE route; decisions queue; Kanban rework; job candidates page actions.
- [ ] Agent pipeline steps 8–14 + `resume-from` endpoint + `AgentConfigForm` fields.
- [ ] Admin queue card.

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
| 2 | ☐ | | | |
| 3 | ☐ | | | |
| 4 | ☐ | | | |
| 5 | ☐ | | | |
| 6 | ☐ | | | |
| 7 | ☐ | | | |
| 8 | ☐ | | | |
| 9 | ☐ | | | |
