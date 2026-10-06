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

## Who runs the worker

By default the web server does: it starts `workers/hiring-worker.js` as a child process at start-up, again if it stops, and whenever a job is queued (`libs/system/worker-host.js`, `instrumentation.js`; details in 20). `npm run worker:hiring` still works for running it yourself with `HIRING_WORKER_MODE=external`. The worker ends itself when the web server that started it is gone (`HIRING_WORKER_PARENT_PID`).

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
| `screen-candidate` | `{ candidateId }` | `fitScorer` → save → `enqueue('shortlist-job', {jobId}, {delayMs: 30000})` (debounced: skip if `lock:shortlist-pending:{jobId}` exists); on an agent-managed job, wakes the agent instead | 60s |
| `shortlist-job` | `{ jobId }` | `applyShortlist(jobId)` → for new shortlisted: `ensure-questions`, `send-invite` | 60s |
| `ensure-questions` | `{ jobId }` | generate the bank if none active | 90s |
| `personalise-questions` | `{ candidateId }` | add 1–2 candidate questions (if enabled) | 60s |
| `send-invite` | `{ candidateId, resend? }` | `sendInvite` (requires questions; if missing, enqueue `ensure-questions` and retry with delay) | 30s |
| `send-reminder` | `{ interviewId }` | `sendReminder` | 30s |
| `assemble-recording` | `{ interviewId }` | ai-engine `/media/concat` for audio and video parts | 5m |
| `analyse-interview` | `{ interviewId }` | see [11-stage2-evaluation.md](11-stage2-evaluation.md) | 15m |
| `finalize-candidate` | `{ candidateId, interviewId }` | final score + LLM summary + decision | 90s |
| `send-outcome-email` | `{ candidateId }` | only if the job enables it | 30s |
| `agent-advance` | `{ runId }` | one supervised-agent tick (see below); one at a time per run | 5m |

Worker logs: one line per job with `type`, `id`, `attempt`, `ms`, `ok/error`. **Never log** resume text, transcripts, tokens or emails.

## Admin visibility
Implemented in `libs/hiring/queue-admin.js`, shown as the "Hiring queue" card on `app/dashboard/admin/page.js` (refreshes every 10 s).
- `GET /api/admin/hiring-queue` (admin only): `waiting` (consumer-group lag; the stream length when no worker ever connected), `inFlight`, `delayed`, worker status (`seen` / `active` = a consumer was seen in the last 30 s, last seen), the newest 50 failed jobs and the failed total. 503 when Redis is unreachable.
- `POST /api/admin/hiring-queue/retry { id }` (admin only): removes the entry from `hiring:jobs:dead` and queues it again as a fresh attempt (attempt 0). The entry is deleted first, so two clicks retry it once; if queueing fails it is put back. 404 if it is gone, 409 if someone else retried it.
- The card warns when jobs are waiting but no worker is running (the usual reason a screening or invite never happens).

## Supervised recruiter agent (`libs/agent/`)

A person-triggered tick (start, resume, approve) is queued at once, not after the delayed-queue wait; screening results wake the agent after 8 seconds (so applicants screened together share one tick).

The hiring agent is its own agent with its own page (`/dashboard/recruiter/agent`). It posts through `libs/hiring/publishing.js` (see 19): one post per platform, the job goes live on Raasta-AI first, posting limits apply, and a sign-in or security check on a platform stops that post and keeps the agent away from that account for 12 hours. The sales agent (`libs/sales/agent/`, `/dashboard/agents`) uses the same supervised engine and worker.

The recruiter agent works on the recruiter's behalf for one job. It is a **supervised agent**: a fixed workflow whose actions are routed through a per-action policy that decides whether the agent acts on its own, asks first, or leaves the step to a human. It is not a free-roaming LLM agent: the steps of hiring are known in advance, and the AI judgement already lives inside each step (screening, questions, interview, summary). Rationale and research: the "Recruiter Agent Options" brief (2026-10-04).

### Modes and policy (`libs/agent/policy.js`)

| Action | Effect on the candidate | Assisted | Autopilot |
|---|---|---|---|
| `write_post` | none | auto | auto |
| `publish_post` | public | **ask** | auto |
| `import_applicants`, `screen`, `prepare_questions` | none | auto | auto |
| `shortlist` | positive | **ask** | auto |
| `hold_back` (not shortlisted) | adverse | **ask** | **ask** |
| `send_invites` | outward | **ask** (approved together with the shortlist) | auto, up to `dailyInviteCap` per job per day |
| `final_decision` | adverse | **ask** | **ask** |
| `hire` | final | human only | human only |

- `decide(action, mode, { escalations })` returns `auto | ask | human`. Any escalation turns `auto` into `ask`.
- **Escalations** (always asked, in both modes, and never bulk-approvable): score fewer than `BORDERLINE_MARGIN` (5) points from the threshold, unreadable resume (`manualReview`), no score, `needs_review` (fewer than half the questions answered), integrity flags (tab hidden ≥ 3 times or ≥ 30 s).
- Old configs: `semi_auto` → `assisted`, `full_auto` → `autopilot` (migration `0011` renames recruiter rows; `normaliseMode` maps anything else to `assisted`). Sales agents keep `semi_auto` / `full_auto` and the generic `AgentRunner`.

### How it runs

- `POST /api/agents/runs` (recruiter) → `startRecruiterRun` (`libs/agent/launch.js`): checks job ownership, allows **one active agent per job**, stores a config snapshot (`agent_runs.config`) and `agent_runs.job_id`, queues the first tick. Nothing runs inside the web request.
- Worker job **`agent-advance { runId }`** (`libs/agent/recruiter-agent.js` → `advanceRun`), one tick at a time per run (`lock:agent:{runId}`, 5 min). A tick:
  1. **Setup (once):** load job → write post (LLM) → `publish_post` (blocking approval in Assisted; run status `paused_at_checkpoint`) → publish to LinkedIn / Rozee → import Rozee applicants. An already-published job skips the posting steps.
  2. **Operate (every tick):** carry out actions the recruiter approved since the last tick; retire pending requests whose candidate moved on; then `buildPlan` (pure, unit-tested): queue screening for new applications → shortlist plan once the batch is screened (same threshold/top-N rule as stage 1) → request the question bank once per job → invites → final decisions for evaluated candidates.
  3. Run status becomes `waiting` (idle until the next event); step statuses and `results` summarise progress.
- **Triggers** (`libs/agent/triggers.js`, coalesced per run): a screening finishes, `shortlist-job` / `queueAfterShortlist` on a managed job, `finalize-candidate` finishes, the recruiter decides a request, resume. A sweep every 15 min ticks all active runs (catches missed events and the next day's invite allowance).
- **One switch per job:** while an agent manages a job (`isJobManagedByAgent`), the worker's own automation stands down: `shortlist-job` is skipped, `queueAfterShortlist` doesn't auto-invite, and `finalizeCandidate` doesn't auto-finalize. The agent's mode decides instead.
- Run statuses: `queued | running | waiting | paused_at_checkpoint | paused | completed | failed | cancelled`. A closed job completes the run; stopping a run withdraws its open requests.

### Approval inbox and audit trail (`agent_actions`, `libs/agent/actions.js`)

Every action is a row: `action`, `route`, `status` (`pending | approved | rejected | executed | failed | superseded`), `summary`, `payload` (incl. the recruiter's `choice`), `evidence` (skills, strengths, concerns, scores), `escalations`, `decided_by` (`agent` or the user id), `decision_note`, timestamps. One action per subject (`dedupe_key`, e.g. `shortlist:<candidateId>`), so ticks are idempotent and a rejected request isn't asked again.

| Route | Purpose |
|---|---|
| `GET /api/agents/actions?jobId=` | Pending requests (inbox) + candidates with approved requests not yet carried out |
| `POST /api/agents/actions/[actionId]` | `{ decision: approve \| reject, choice?, note? }`; `choice` overrides the proposal (e.g. shortlist someone the agent proposed to hold back). `needs_review` final decisions require a choice |
| `POST /api/agents/actions/bulk` | `{ ids, decision }`; escalated requests are refused (each needs its own decision) |
| `POST /api/agents/runs/[runId]/pause` · `/resume` | Pause switch |
| `POST /api/agents/runs/[runId]/approve` | Approves the run's blocking request (job post) |
| `POST /api/agents/runs/[runId]/cancel` | Stops the agent and withdraws its open requests |
| `GET /api/agents/runs/[runId]` | Run, steps and the action history (audit trail) |
| `GET /api/agents/preview?jobId=&mode=&dailyInviteCap=` | Dry run: what the agent would do now. Changes nothing |

UI: **Decisions** page (`app/dashboard/recruiter/decisions`): escalations pinned on top, evidence shown before scores, per-request approve / choose / dismiss with an optional note, "Approve all as proposed" per group (skips escalations); jobs without an agent keep the stage-2 decisions list there. **Agents** page: Assisted / Autopilot choice with the policy, min fit score / max shortlist (saved on the job), invites per day, preview; run card with step progress, activity log, pause / resume / stop and a link to Decisions.

Bulk approval of final decisions (`bulkApprove`) also skips escalated candidates (borderline scores), not only `needs_review`.
