# 13 · Workers and Automation

## Queue: `libs/hiring/queue.js`

Redis Streams with one consumer group. It uses `getRedisClient()` from `libs/redis.js` (relative import).

```js
export const STREAM = 'hiring:jobs';
export const DEAD = 'hiring:jobs:dead';
export const GROUP = 'hiring-workers';

export async function enqueue(type, payload, { delayMs = 0, attempt = 0 } = {})
// delayMs > 0 → ZADD 'hiring:delayed' score=now+delayMs member=JSON; the worker moves due items into the stream every 5s
// otherwise XADD hiring:jobs * type <type> payload <json> attempt <n> enqueuedAt <iso>
```
- Idempotency: each handler must be safe to run twice. Use the DB state as the guard (e.g. `send-invite` does nothing if an active interview exists and `resend` isn't set).
- Locks: `SET lock:<name> <worker> NX PX <ms>` for per-job critical sections (`shortlist-job`, `ensure-questions`).

## Worker: `workers/hiring-worker.js`

Long-running. `npm run worker:hiring` → `tsx workers/hiring-worker.js`.

Use a **dedicated** ioredis connection for the blocking `XREADGROUP` (`new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })`). Don't block on the shared `getRedisClient()` instance; use the shared one for `XADD`/`XACK`/locks.

```
startup: XGROUP CREATE hiring:jobs hiring-workers $ MKSTREAM (ignore BUSYGROUP)
loop:    XREADGROUP GROUP hiring-workers <WORKER_ID> COUNT 5 BLOCK 5000 STREAMS hiring:jobs >
         for each message → handler(type)(payload) with timeout
           success → XACK
           failure → attempt < 3 ? enqueue(same, delay 2^attempt × 10s) + XACK : XADD hiring:jobs:dead … + XACK
every 5s:   move due items from ZSET hiring:delayed → stream
every 60s:  XAUTOCLAIM idle > 5 min (recover messages from crashed workers)
every 15m:  sweep → expireStaleInvites(), sendReminders(), abandonStaleSessions() (interviews in_progress with last_activity_at older than resumeWindowMinutes + 5 and no live session)
SIGTERM:    stop reading, finish in-flight, exit
```
Concurrency: `HIRING_WORKER_CONCURRENCY` (default 3). LLM-heavy handlers respect Groq rate limits: on a 429, back off using the `retry-after` header.

## Job types

| type | payload | handler | Timeout |
|---|---|---|---|
| `screen-candidate` | `{ candidateId }` | `fitScorer` → save → `enqueue('shortlist-job', {jobId}, {delayMs: 30000})` (debounced: skip if `lock:shortlist-pending:{jobId}` exists) | 60s |
| `shortlist-job` | `{ jobId }` | `applyShortlist(jobId)` → for new shortlisted: `ensure-questions`, `send-invite` | 60s |
| `ensure-questions` | `{ jobId }` | generate the bank if none active | 90s |
| `personalise-questions` | `{ candidateId }` | add 1–2 candidate questions (if enabled) | 60s |
| `send-invite` | `{ candidateId, resend? }` | `sendInvite` (requires questions; if missing, enqueue `ensure-questions` and retry with delay) | 30s |
| `send-reminder` | `{ interviewId }` | `sendReminder` | 30s |
| `assemble-recording` | `{ interviewId }` | ai-engine `/media/concat` for audio and video parts | 5m |
| `analyse-interview` | `{ interviewId }` | see [11-stage2-evaluation.md](11-stage2-evaluation.md) | 15m |
| `finalize-candidate` | `{ candidateId, interviewId }` | final score + LLM summary + decision | 90s |
| `send-outcome-email` | `{ candidateId }` | only if the job enables it | 30s |

Worker logs: one line per job with `type`, `id`, `attempt`, `ms`, `ok/error`. **Never log** resume text, transcripts, tokens or emails.

## Admin visibility
- `GET /api/admin/hiring-queue` (admin role only): stream length, pending count, dead-letter entries (last 50), and a retry action `POST /api/admin/hiring-queue/retry { id }`.
- Show this in `app/dashboard/admin/page.js` as a small card.

## Agent pipeline integration (`libs/agent-pipelines/recruiter.js`)

The event-driven worker is the main automation. The agent pipeline gives a **visible, step-by-step run** for demos and the FYP report. New step list:

| # | key | label | checkpoint | does |
|---|---|---|---|---|
| 1 | `load_job` | Load Selected Job | – | existing |
| 2 | `generate_post` | Generate AI Job Post | – | existing |
| 3 | `approve_post` | Approve Post | ✔ | existing |
| 4 | `post_to_linkedin` | Publish to LinkedIn | – | existing |
| 5 | `publish_to_rozee` | Publish to Rozee | – | existing |
| 6 | `scrape_rozee_applicants` | Import Rozee Applicants | – | existing |
| 7 | `monitor_candidates` | Monitor Applications | – | existing |
| 8 | `screen_candidates` | AI Resume Screening | – | **new body**: fit score all `new`, `applyShortlist` (don't auto-invite here) |
| 9 | `prepare_questions` | Prepare Interview Questions | – | ensure the question bank exists |
| 10 | `approve_shortlist` | Review Shortlist | ✔ | replaces `notify_shortlist`; recruiter may adjust |
| 11 | `send_interview_invites` | Send Interview Invites | – | `sendInvite` for every `shortlisted` without an active interview |
| 12 | `await_interviews` | Wait for Interviews | – | returns current counts (invited/completed/expired); doesn't block; the run summary shows progress |
| 13 | `final_evaluation` | Final Evaluation | – | runs `finalize-candidate` for completed interviews not yet finalised; returns ranked list |
| 14 | `approve_final` | Approve Final Shortlist | ✔ | on approve: apply suggested decisions (bulk-approve logic) |

In `full_auto` the runner skips checkpoints (existing behaviour), so the agent screens, invites, and finalises with suggestions applied. Update `AgentConfigForm.js` with fields for `minFitScore`, `maxShortlist` and `autoInvite` (they write to the job's `hiringConfig`).

Note: interviews take hours or days. `await_interviews` must **not** poll in a loop inside a 300s function. It reports status, and the recruiter re-runs steps 13–14 later (add a "Run final evaluation" button on the run card that calls a new endpoint `POST /api/agents/runs/[runId]/resume-from { stepKey: 'final_evaluation' }`, implemented in `AgentRunner`).
