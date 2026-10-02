# 02 · Architecture

## Processes

| Process | Tech | Port | Why separate |
|---|---|---|---|
| **web** | Next.js 14 (this repo root) | 8085 | Existing app: recruiter UI, candidate room page, REST APIs |
| **interview-engine** | Node 20, `ws`, run with `tsx` | 8090 | Holds live WebSocket sessions, timers and STT streams. Next.js route handlers (and Vercel) can't hold sockets or long-lived in-memory state |
| **hiring-worker** | Node 20, `tsx` | – | Long-running Redis Streams consumer for screening, invites, analysis and finalisation |
| **ai-engine** | Python 3.11, FastAPI | 8000 | Models need a persistent Python runtime (Kokoro TTS, Wav2Vec2, Whisper, MediaPipe, optional TensorFlow) |
| **redis** | Redis 7 | 6379 | Job streams + live pub/sub (already used by the app) |
| **postgres** | Managed (existing `DATABASE_URL`) | – | Single source of truth |
| **storage** | S3-compatible bucket (local folder in dev) | – | Resumes, interview recordings |

All Node processes live in this repo and share `libs/` (schema, db, AI, hiring and interview logic).

```
                      ┌──────────────────────── Raasta-AI repo ─────────────────────────┐
Recruiter ──HTTPS────►│ web (Next.js)                                                    │
Candidate ──HTTPS────►│   app/dashboard/recruiter/**   app/interview/[token]   app/api/** │
   │                  │                                                                  │
   └────WSS──────────►│ services/interview-engine  ── libs/interview/* ── libs/ai/*      │
                      │ workers/hiring-worker.js   ── libs/hiring/*   ── libs/ai/*       │
                      │ services/ai-engine (Python)                                      │
                      └───────┬──────────────┬──────────────┬───────────────────────────┘
                          Postgres         Redis        Object storage
External: Groq (LLM + Whisper fallback) · Deepgram (streaming STT) · Mailgun (email)
```

## New folder layout

```
libs/
  ai/
    llm.js                    # chatJSON(), chatText() over Groq (OpenAI SDK); model from env
    prompts/                  # prompt builders (fit, questions, analyzer, scorer, follow-up, summary)
  hiring/
    statuses.js               # status constants, labels, badge colours, transitions
    config.js                 # DEFAULT_HIRING_CONFIG + mergeHiringConfig(job)
    fit-scorer.js             # stage 1
    shortlist.js              # apply thresholds / top-N
    final-evaluator.js        # stage 2
    queue.js                  # enqueue(type, payload) → Redis stream
    invitations.js            # create token, send/resend, expire
    emails.js                 # HTML/text email templates
    storage.js                # putObject/getSignedUrl (s3|local)
    resume-text.js            # pdf-parse / mammoth extraction
  interview/
    tokens.js                 # random token, sha256 hash, ticket JWT sign/verify
    question-generator.js
    mappers.js                # candidate→cvData, job→roleData, questions→session questions
    answer-analyzer.js        # ported, follow-up decision
    answer-scorer.js          # ported, 0–100 scoring
    follow-up.js              # ported, follow-up question generation
    session-engine.js         # ported interview loop (InterviewSession class)
    repository.js             # Drizzle reads/writes for interviews/turns/responses
    tts-client.js             # → ai-engine /tts
    stt/deepgram.js           # streaming STT adapter
    stt/whisper-chunked.js    # fallback adapter
    analysis-client.js        # → ai-engine /analyze/*
    events.js                 # Redis pub/sub channel helpers (interview:{id})
services/
  interview-engine/
    index.js                  # HTTP + WS server, ticket auth, session manager
    session-manager.js
    package.json              # (optional) if engine deps are kept separate
  ai-engine/
    main.py  routers/{tts,voice,emotion,gaze,face}.py  core/{storage,models}.py
    requirements.txt  Dockerfile
workers/
  hiring-worker.js
app/
  interview/[token]/page.js            # candidate room (public)
  api/interview/[token]/...            # public token-auth APIs
  api/hiring/...                       # recruiter APIs (withAuth)
  dashboard/recruiter/interviews/...   # recruiter interview list/detail
scripts/check-branding.sh
docker-compose.yml  nginx/raasta.conf
```

## Communication

| From → To | Mechanism | Auth |
|---|---|---|
| Browser (recruiter) → web | HTTPS REST, SSE | NextAuth session |
| Browser (candidate) → web | HTTPS REST | Interview token in URL path (hashed lookup) |
| Browser (candidate) → engine | WSS `/ws?ticket=…` | Short-lived ticket JWT (`INTERVIEW_TICKET_SECRET`, 10 min, one interview) |
| web / engine → worker | Redis Stream `hiring:jobs` (XADD) | Internal network |
| engine → recruiter live view | Redis pub/sub `interview:{id}` → web SSE route | Internal |
| engine / worker → ai-engine | HTTP JSON | `AI_ENGINE_TOKEN` bearer header |
| all → Postgres | Drizzle (`libs/db.ts`) | `DATABASE_URL` |
| web / worker / engine → storage | `libs/hiring/storage.js` | S3 keys / local path |

## Key flows

### A. Application → shortlist
1. `POST /api/hiring/apply/[jobId]` stores the file, extracts text, parses with the LLM (existing), inserts the candidate (`new`), and calls `enqueue('screen-candidate', {candidateId})` if `autoScreen`.
2. Worker runs `fitScorer` → updates `fit_score`/`fit_analysis` → `screened` → `shortlist.applyForJob(jobId)` re-ranks and sets `shortlisted`/`not_shortlisted`.
3. On a new `shortlisted`: `enqueue('ensure-questions', {jobId})`, then `enqueue('send-invite', {candidateId})` if `autoInvite`.

### B. Invite → interview
1. `send-invite` creates the `interviews` row (token hash, expiry) and sends the email → `interview_invited`.
2. The candidate opens `/interview/{token}`. The page calls `GET /api/interview/{token}`, which validates and returns job/company info and sets `opened_at`.
3. The candidate gives consent and passes the device check, then `POST /api/interview/{token}/session` returns `{ wsUrl, ticket }`.
4. The browser connects to the engine. The engine verifies the ticket, loads the context from Postgres, starts STT and the session loop, and sets statuses to `in_progress`.
5. During the interview the browser uploads recording chunks to `POST /api/interview/{token}/upload`.
6. When the interview ends, the engine finalises: `completed`, writes the statistics, and calls `enqueue('analyse-interview')`.

### C. Analysis → final decision
1. `analyse-interview` waits until the recording is complete (or times out at 10 min), calls the ai-engine, and computes `communication_score`.
2. `finalize-candidate` computes `final_score` and the LLM summary. If `autoFinalize`, it sets `final_*`; otherwise it sets `final_analysis.suggestedDecision` and the candidate waits in the recruiter's approval queue.

## Failure handling

| Failure | Behaviour |
|---|---|
| LLM call fails | Retry 2× with backoff; screening leaves the candidate `new` with `fit_analysis.error`; the interview loop falls back to the next question from the bank |
| STT disconnects | Reconnect once; if that fails, tell the client `error {code:'stt_unavailable'}` and pause; the candidate can retry |
| TTS fails | Send the text-only question (`ai_speaking` with `audio:null`); the browser falls back to `speechSynthesis` |
| Candidate disconnects | State snapshot every 15s; reconnect with a new ticket within `resumeWindowMinutes` (default 15) and continue from the current question |
| Engine restarts | Sessions resume from the Postgres `state` snapshot on reconnect |
| Worker job fails 3× | Moved to stream `hiring:jobs:dead` with the error; visible in admin logs |
