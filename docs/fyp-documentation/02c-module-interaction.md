# Part 2C · Module Interaction

[← Index](README.md) · Previous: [Part 2B (cont.)](02b2-conceptual-modules-cont.md) · Next: [Part 2D · Foundational concepts](02d-foundational-concepts.md)

## Contents

* [C.1 Conceptual module maps](#c1-conceptual-module-maps)
* [C.2 Interaction and dependency diagrams, single points of failure](#c2-interaction-and-dependency-diagrams)
* [C.3 Sequence diagrams for the three key scenarios](#c3-sequence-diagrams)

---

## C.1 Conceptual module maps

The full system has 20 modules; to keep each diagram drawable, it is shown as three maps. **Each box contains the module's single responsibility.**

### C.1.1 Hiring modules

```mermaid
flowchart TB
  M2["M2 Job Management<br/>owns jobs and per-job policy"]
  M3["M3 Job Distribution<br/>posts per platform, guarded publishing"]
  M4["M4 Intake and Parsing<br/>safe public apply, store, extract, structure"]
  M5["M5 Screening and Shortlisting<br/>fit score and threshold-and-cap rule"]
  M6["M6 Question Bank<br/>validated questions with ideal answers"]
  M7["M7 Candidate Communication<br/>hashed invite links, emails, reminders, expiry"]
  M8["M8 Interview Module<br/>live spoken interview"]
  M9["M9 Evaluation and Scoring<br/>analyse, score, suggest"]
  M10["M10 Decision Support<br/>evidence, controls, audit"]
  M11["M11 Supervised Agent<br/>do, ask or leave to human"]
  M2 --> M3 --> M4 --> M5 --> M6 --> M7 --> M8 --> M9 --> M10
  M11 -.->|"drives"| M3
  M11 -.->|"drives"| M5
  M11 -.->|"drives"| M7
  M11 -.->|"asks via"| M10
```

*Reading:* the solid chain is the candidate's journey; dotted arrows show the agent steering the same steps by policy instead of the worker's built-in automation.

### C.1.2 Shared platform modules

```mermaid
flowchart TB
  M1["M1 Identity and Access<br/>who, which role, which rows"]
  M12["M12 Background and Operations<br/>queue, worker, supervision, setup guide"]
  M13["M13 Notifications<br/>in-app alerts, never throws"]
  M14["M14 Dashboard and Analytics<br/>pure aggregations"]
  M17["M17 Platform Accounts<br/>sessions, limits, connect"]
  M18["M18 Storage<br/>files, signed links"]
  M19["M19 AI Platform Layer<br/>robust LLM client, prompts"]
  M20["M20 Billing and Public Site<br/>template code"]
  M1 --- M12
  M12 --- M18
  M12 --- M19
  M1 --- M17
  M13 --- M12
  M14 --- M1
```

*Reading:* these have no business story of their own; every other module uses them. A line means "talks to".

### C.1.3 Client-acquisition modules

```mermaid
flowchart TB
  M15["M15 Client Acquisition<br/>campaigns, leads, discovery, tiering, message drafting"]
  M16["M16 Outreach Automation<br/>invites, messages, acceptance, background runs"]
  M17["M17 Platform Accounts<br/>LinkedIn, Rozee.pk sessions and limits"]
  M19["M19 AI Platform Layer<br/>LLM"]
  M15 --> M16
  M16 --> M17
  M15 -.->|"separate LLM client today"| M19
  M16 -.->|"sales agent runs both"| M15
```

*Reading:* the only dotted line that is a **design smell** is M15 → M19: the sales side has its own OpenAI client (`libs/groq-service.js`) instead of `libs/ai/llm.js`.

---

## C.2 Interaction and dependency diagrams

### C.2.1 Synchronous calls (who calls whom, direction = caller to callee)

```mermaid
flowchart LR
  BR["Browsers"]
  WEB["Web app route handlers"]
  ENG["Interview engine"]
  AI["AI engine"]
  WRK["Hiring worker"]
  PG[("Postgres")]
  RD[("Redis")]
  ST[("Storage")]
  LLM["Groq"]
  STT["Deepgram"]
  ML["Mailgun"]

  BR -->|"HTTPS"| WEB
  BR -->|"WSS ticket"| ENG
  WEB --> PG
  WEB --> RD
  WEB --> ST
  WEB --> LLM
  WEB --> ML
  ENG --> PG
  ENG --> RD
  ENG --> AI
  ENG --> LLM
  ENG --> STT
  WRK --> PG
  WRK --> RD
  WRK --> ST
  WRK --> LLM
  WRK --> AI
  WRK --> ML
```

*Reading:* the arrows that matter for failure analysis are the ones into the three data boxes (Postgres, Redis, Storage). The web app and the worker never call the engine; the engine never calls the worker directly (it only writes jobs to Redis).

### C.2.2 Events and queues (asynchronous, direction = producer to consumer)

```mermaid
flowchart LR
  APPLY["apply route"] -->|"screen-candidate"| Q[("hiring:jobs stream")]
  SCRN["screen routes"] -->|"screen-candidate"| Q
  Q --> W["hiring worker"]
  W -->|"shortlist-job, delayed 30 s"| Q
  W -->|"ensure-questions, personalise-questions, send-invite"| Q
  W -->|"send-reminder"| Q
  ENGE["interview engine"] -->|"analyse-interview"| Q
  UPL["upload route"] -->|"assemble-recording"| Q
  W -->|"analyse-interview re-queue, finalize-candidate"| Q
  W -->|"send-outcome-email, agent-advance"| Q
  W -->|"publish interview:id"| PS["Redis pub/sub"]
  ENGE -->|"publish interview:id"| PS
  PS -->|"SSE"| REC["recruiter browser"]
  Q -.->|"retries exhausted"| DLQ[("hiring:jobs:dead")]
  ADM["admin retry"] --> Q
```

*Reading:* nearly every arrow ends in the same stream: the queue is the system's spine. The engine and the upload route are the two producers that run outside the worker.

### C.2.3 Single points of failure

Highlighted in red in the diagram; the table gives the blast radius and the mitigation that actually exists in code.

```mermaid
flowchart TB
  PG[("Postgres")]:::spof
  RD[("Redis")]:::spof
  WRK["Hiring worker"]:::spof
  ENG["Interview engine, single instance"]:::spof
  GROQ["Groq LLM"]:::risk
  FFM["ffmpeg on the worker host"]:::risk
  MAIL["Mailgun"]:::risk
  PLAT["Platform sessions: LinkedIn, Rozee.pk, Indeed"]:::risk
  PG --- RD
  classDef spof fill:#fecaca,stroke:#b91c1c,color:#111
  classDef risk fill:#fef3c7,stroke:#b45309,color:#111
```

| Component | Why it is a single point | What stops | What still works | Mitigation present | Mitigation missing |
|---|---|---|---|---|---|
| **Postgres** | System of record; every module reads it | Everything: logins, apply, interviews | Nothing | Pool of 10 connections, idle timeout, UTC session | Replica, backups documented but not scripted |
| **Redis** | Queue, locks, rate limits, live events, caches | Screening/invites/analysis (jobs cannot be enqueued; apply route logs and keeps the application); live view | Public pages, apply (saved), interviews already connected (engine does not need Redis to run the loop) | `rateLimit` fails open; question lock proceeds unlocked; sales cache falls back to DB; Setup guide reports it | HA Redis; durable AOF settings not documented |
| **Hiring worker** | All async work | Screening, shortlist, invites, reminders, analysis, finalize, agent | Interviews (engine), manual actions (invite button calls `sendInvite` directly) | Embedded mode restarts it with backoff and circuit breaker; Setup guide + admin card warn "jobs waiting but no worker" | More than one worker is supported by the consumer group, but none is run |
| **Interview engine** | Holds live sessions in memory; one process | All live interviews at once | Everything else | 15 s state snapshots; resume window 15 min; SIGTERM snapshot; clients reconnect ≤ 5 times; sweep closes orphans | Horizontal scale-out (documented out of scope) |
| **Groq** | One LLM provider | New applications get `parseError`/`error` and wait; interviews degrade to fallbacks | Everything non-AI | Retries, fallbacks, re-parse button, "Screening failed – retry" | Second provider/failover |
| **ffmpeg** | Needed to join and decode recordings | Recording assembly, pace/fluency | Transcript-based estimate; AI-engine fallback if running | `ffmpegAvailable` check in Setup guide; AI-engine `/media/concat` fallback | Container image bundling it |
| **Mailgun** | Only way candidates learn of the interview | Invites/reminders | Everything else; links can be re-sent | Failure recorded on the interview and retried; dev outbox | Second channel (SMS/WhatsApp) |
| **Platform sessions** | Stored cookies expire/are challenged | Auto-posting, invites, messages | Hand-off posting, hiring pipeline | `needs_login` stop, 12 h agent cool-off, 24 h/30 min engine cool-off | Official APIs |

---

## C.3 Sequence diagrams

### C.3.1 Scenario (i): a candidate applies and is auto-shortlisted

```mermaid
sequenceDiagram
  autonumber
  actor C as Candidate
  participant W as Web app apply route
  participant S as Storage
  participant L as LLM Groq
  participant P as Postgres
  participant R as Redis
  participant K as Hiring worker
  C->>W: POST apply (multipart)
  W->>P: select job, check not closed
  W->>P: duplicate check on lower(email)
  W->>S: putObject resumes/job/uuid.pdf
  W->>W: extract text (pdf-parse)
  W->>L: parse resume to JSON
  L-->>W: structured data
  W->>P: tx + advisory lock: re-check, insert candidate (new)
  W->>R: XADD screen-candidate
  W->>P: notify recruiter
  W-->>C: 200 Application submitted
  K->>R: XREADGROUP
  R-->>K: screen-candidate
  K->>P: load candidate and job
  K->>L: fit score (rubric, no personal fields)
  L-->>K: JSON
  K->>K: postProcessFit (recompute skills, clamp, scrub)
  K->>P: update fit_score, fit_analysis, status screened
  K->>R: SET lock shortlist-pending NX PX 30000
  K->>R: ZADD hiring:delayed shortlist-job (+30 s)
  Note over K,R: later, moveDueDelayed XADDs it into the stream
  K->>P: applyShortlist tx + advisory lock
  K->>P: set shortlisted or not_shortlisted
  K->>R: XADD ensure-questions, send-invite (if autoInvite)
```

*How to read it:* numbered steps run top to bottom. The line `W-->>C: 200` is the end of the **synchronous** part. Everything after it happens even if the candidate closes the tab. The 30-second delay lets several applicants arriving together share one shortlist run (so the cap compares everybody).

### C.3.2 Scenario (ii): a shortlisted candidate receives the link, takes the interview and is evaluated

**(ii-a) Invite and access**

```mermaid
sequenceDiagram
  autonumber
  participant K as Hiring worker
  participant P as Postgres
  participant M as Mailgun
  actor C as Candidate
  participant W as Web app token APIs
  participant R as Redis
  participant E as Interview engine
  K->>P: tx + lock: cancel old invites, insert interview (token hash), candidate interview_invited
  K->>M: email link /interview/token
  M-->>C: invite email
  C->>W: GET /api/interview/token
  W->>R: INCR rl:interview:hash:get
  W->>P: lookup by SHA-256 hash, check status and expiry
  W->>P: markOpened
  W-->>C: candidate-safe view
  C->>W: POST consent
  W->>P: set consent_at
  C->>W: POST session
  W-->>C: wsUrl and 10 min JWT ticket
  C->>E: WSS /ws?ticket
  E->>E: verifyTicket (HS256, typ, exp)
  E->>P: load interview, job, candidate, freeze question snapshot
  E-->>C: session_ready
```

**(ii-b) One question cycle inside the engine**

```mermaid
sequenceDiagram
  autonumber
  actor C as Candidate browser
  participant E as Engine session
  participant D as Deepgram
  participant A as AI engine TTS
  participant L as LLM Groq
  participant P as Postgres
  E->>A: POST /tts (question)
  A-->>E: WAV bytes or failure
  E-->>C: ai_speaking (audio base64 or null)
  C-->>E: ai_done_speaking
  C->>E: binary PCM16 frames
  E->>D: stream audio
  D-->>E: partial and final transcripts
  E-->>C: caption_partial, caption_final
  C->>E: answer_done (or 8 s silence)
  E->>E: lock, strip echo, intent checks
  E->>L: analyse answer (fast model)
  L-->>E: flags
  E->>L: follow-up question (only if needed)
  E->>P: append turn, create response
  E--)L: score answer in background
  L--)E: score and reasoning
  E->>P: update response score
  E->>A: POST /tts (next question)
  E-->>C: question and ai_speaking
```

**(ii-c) After the interview**

```mermaid
sequenceDiagram
  autonumber
  actor C as Candidate browser
  participant W as Web app upload route
  participant S as Storage
  participant R as Redis
  participant K as Hiring worker
  participant P as Postgres
  participant L as LLM Groq
  participant N as Recruiter
  C->>W: POST upload part n (audio, video, behavior)
  W->>S: putObject recordings/id/kind/0000n.webm
  C->>W: POST upload final part
  W->>R: XADD assemble-recording
  K->>S: list parts, ffmpeg concat to audio.webm and video.webm
  K->>P: recording_status complete
  Note over K,R: analyse-interview was queued by the engine when the interview ended and re-queues itself every 30 s until recording is complete
  K->>S: decode audio
  K->>K: pace, pauses, fillers, behaviour summary
  K->>P: store analysis JSON
  K->>R: XADD finalize-candidate
  K->>P: communication score, final score, suggested decision
  K->>L: evidence-only summary
  L-->>K: JSON or failure (fallback summary)
  K->>P: candidates.final_score, final_analysis
  K->>P: notify recruiter
  N->>W: POST decision (approve or override)
  W->>P: applyDecision conditional update
```

*How to read the three:* (ii-a) is **security-heavy** (hash lookup, rate limit, consent gate, ticket); (ii-b) is the **real-time loop** (the "score in background" arrow is open-headed because it does not block the next question); (ii-c) is **fully asynchronous** and can take minutes.

### C.3.3 Scenario (iii): a key client-acquisition flow

```mermaid
sequenceDiagram
  autonumber
  actor O as Sales operator
  participant W as Web app
  participant P as Postgres
  participant A as Apify scraper
  participant L as LLM Groq
  participant R as Redis
  participant K as workflow-worker process
  participant LI as LinkedIn via Playwright
  O->>W: POST campaigns (ICP)
  O->>W: POST campaigns/id/leads (URLs, CSV)
  W->>P: insert pending leads, skip duplicates
  O->>W: POST scrape (lead URLs)
  W->>A: run actor
  A-->>W: posts per profile
  W->>P: store posts, lead completed
  O->>W: POST messages/generate-bulk
  W->>L: one message per lead from top posts
  W->>P: messages status draft
  O->>W: POST campaigns/id/start-workflow
  W->>P: insert workflow_jobs queued (one per user)
  W->>K: spawn detached
  K->>P: check daily limit, eligible leads
  loop each batch of 10
    K->>LI: replay session, open profile, click Connect, send without note
    K->>P: update invite status, counters
    K->>R: publish job:id:status
  end
  R-->>W: SSE progress to operator
  Note over O,K: pause or cancel publishes job:id:control and the worker exits at once
  O->>W: POST check-acceptance (or cron)
  W->>LI: scrape connections page
  W->>P: mark accepted leads
  W->>LI: send stored message to each accepted lead (daily cap)
```

*How to read it:* the middle `loop` is the part that takes tens of minutes; it is the reason this flow uses a detached process and Redis pub/sub rather than a single HTTP request. The operator's review of drafts happens between steps 11 and 12 and is optional in the manual flow (mandatory checkpoint in the sales agent's `semi_auto` mode).
