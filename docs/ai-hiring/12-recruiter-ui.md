# 12 · Recruiter UI

Style: DaisyUI + Tailwind, `lucide-react` icons, `react-hot-toast`, client components (`"use client"`), data via `fetch` or TanStack Query (match the surrounding page). Status labels and colours always come from `libs/hiring/statuses.js`.

## 1. Sidebar (`components/layout/Sidebar.js`)
Add to the recruiter children, after Pipeline:
```js
{ key: "recruiter-interviews", label: "Interviews", href: "/dashboard/recruiter/interviews", icon: Video },
{ key: "recruiter-decisions",  label: "Decisions",  href: "/dashboard/recruiter/decisions",  icon: Gavel },
```
(import `Video` and `Gavel` from `lucide-react`; use `CheckSquare` if `Gavel` isn't available)

## 2. Jobs list and job settings
- `app/dashboard/recruiter/jobs/page.js`, job card: add counters (Applied · Shortlisted · Interviewed · Final) and links to "Candidates" and "Interview questions".
- **Hiring automation** card (in the job edit modal `app/dashboard/hiring/components/CreateJobModal.js` or a new `JobHiringSettings` component on the job candidates page). It edits `hiringConfig`:
  - Toggles: Auto-screen, Auto-invite, Auto-finalize (with a warning: "Candidates will be rejected without your review").
  - Numbers: Min fit score, Max shortlist, Questions, Interview length, Invite expiry (hours), Final threshold.
  - Weights: three sliders that auto-normalise to 100%.
  - Record video toggle.
  - Saves via `PATCH /api/hiring/jobs/[jobId]` with `{ hiringConfig }`.

## 3. Job candidates page (`app/dashboard/recruiter/jobs/[jobId]/candidates/page.js`)
- Replace `statusBadge()` with `STATUS_META`.
- Filter tabs: All · Applied · Shortlisted · Interview · Evaluation · Decision · Closed (from `stage`).
- Header actions: **Screen all new**, **Re-run shortlist**, **Interview questions**, **Copy apply link** (existing).
- Each candidate row:
  - Name, email, applied date, status badge
  - **Fit** badge (score) · **Interview** badge (score, if any) · **Final** badge (score, if any)
  - Actions by status:
    - `new|screened|reviewed` → Screen, Shortlist, Reject
    - `shortlisted` → Send interview invite
    - `interview_invited` → Copy status ("Invited 2h ago, expires in 70h"), Resend, Extend, Cancel
    - `interview_expired` → Re-invite
    - `interview_in_progress` → **Watch live**
    - `interview_completed` → **View results**, Approve suggestion
    - `final_*` → View results, Mark hired
- The expanded row adds a **Screening** section (matched/missing chips, strengths, concerns, rationale), keeps the existing parsed resume sections, and adds a "Download resume" button.

## 4. Pipeline Kanban (`app/dashboard/recruiter/pipeline/page.js`)
- Columns = `KANBAN_STAGES`, with candidates grouped by `STATUS_META[status].stage`.
- Card: name, job title, status badge, best available score.
- Drag and drop: on drop into a column, open a small menu of statuses in that stage that `canTransition(from, to)` allows. If there's exactly one, apply it directly. If none, snap back with a toast.
- Filter by job (dropdown).

## 5. Interviews list (`app/dashboard/recruiter/interviews/page.js`)
- Table: Candidate · Job · Status · Invited · Started · Duration · Interview score · Communication · Final · Actions (View / Watch live).
- Filters: job, status, date range. Auto-refresh every 15s while any row is `in_progress`.
- API: `GET /api/hiring/interviews?jobId=&status=&page=`.

## 6. Interview detail (`app/dashboard/recruiter/interviews/[interviewId]/page.js`)
API: `GET /api/hiring/interviews/[interviewId]` → interview row + job + candidate (basic) + responses + turns + signed recording URLs (15 min).

Tabs:
1. **Live** (only while `in_progress`): an `EventSource` to `/api/hiring/interviews/[interviewId]/stream`. Shows the current question, the rolling transcript, and answer scores as they arrive. Read-only.
2. **Summary:** final score ring, breakdown (resume / interview / communication with weights), recommendation badge, AI summary, strengths, risks, suggested next steps, and **Approve** / **Override** buttons (decision API).
3. **Q&A:** per base question, a card with the question, the answer, the score (progress bar), reasoning, keywords covered (green) and missed (red), and nested follow-ups.
4. **Transcript:** chat-style list of turns. Clicking a turn seeks the video to `offsetMs`.
5. **Recording:** HTML5 video (or audio-only) with question markers on the timeline.
6. **Communication:** WPM, filler words per minute, pause ratio, eye contact, emotion distribution. Charts as simple DaisyUI `radial-progress` + bar lists (no new chart library needed).
7. **Integrity:** tab-hidden events (informational, with the note "not proof of misconduct").

Actions: Re-analyse, Extend/Re-invite (if abandoned or expired), Delete recording (privacy).

### Live SSE route: `app/api/hiring/interviews/[interviewId]/stream/route.js`
- withAuth + ownership. Create a dedicated ioredis **subscriber** connection and `SUBSCRIBE interview:{id}`; forward each message as `data: …\n\n`; send a heartbeat comment every 15s. On abort, unsubscribe and quit.
- `export const dynamic = "force-dynamic"`, `export const runtime = "nodejs"`.
- Mirror the response headers from `app/api/agents/runs/[runId]/stream/route.js`.

## 7. Decisions queue (`app/dashboard/recruiter/decisions/page.js`)
- **Implemented in Phase 8 as the supervised agent's approval inbox** (see 13, agent section): the recruiter agent's pending requests (job post, shortlist, hold-backs, invites, final decisions) with escalations pinned on top and evidence before scores, plus the stage-2 list below for jobs no agent manages.
- Grouped by job: candidates in `interview_completed` with a final analysis, sorted by final score.
- Each row: name, scores, recommendation, suggested decision, and buttons **Accept suggestion** / **Shortlist** / **Reject** / **Open**.
- Bulk "Accept all suggestions" per job (skips `needs_review`).

## 8. Interview questions page
See [07-question-bank.md](07-question-bank.md).

## 9. Dashboard home (optional)
Add a "Hiring" stats card: applications this week, shortlisted, interviews completed, pending decisions.

## Implementation notes (Phase 8)

- **Interviews list** (§5): `GET /api/hiring/interviews?jobId=&status=&from=&to=&page=&pageSize=` (25 per page, max 100; `to` given as a day includes that day). Ownership comes from the job; admins see all. The page refreshes every 15 s while any row is `in_progress`.
- **Interview detail** (§6): `GET /api/hiring/interviews/[id]` returns the interview (without its token hash and engine state), job, candidate, scored answers, transcript and recording links valid for 15 minutes (signing is async: always `await` it). Tabs: Live (only while `in_progress`), Summary (score ring, breakdown, AI summary, approve / override / mark hired through the decision API), Q&A, Transcript (a time jumps the player), Recording (player, question markers, downloads, delete), Communication, Integrity (with the "not proof of misconduct" note). Header actions: Re-analyse, Extend link, Re-invite. The page polls every 10 s while the interview runs or its analysis is pending and keeps the recording links it already has, so a video someone is watching is not restarted.
- **Live stream:** `GET /api/hiring/interviews/[id]/stream` forwards the engine's events from Redis channel `interview:{id}` (`question`, `caption_final`, `answer_finalized`, `answer_scored`, `integrity`, `status`) over a dedicated subscriber (`subscribeToInterview` in `libs/interview/events.js`), with a 15 s heartbeat; it is read-only. When the engine reports `completed` or `abandoned`, the page reloads and the Live tab goes away.
- **Seeking:** `/api/files/[token]` now answers HTTP Range requests (206 / 416, `Accept-Ranges: bytes`) so `<video>` and `<audio>` can seek. Only the local driver honours a range (S3 links go straight to S3); `parseRange` and the `range` field of `getObjectStream` are in `libs/hiring/storage.js`.
- **Delete recording:** `DELETE /api/hiring/interviews/[id]/recording` removes everything under `recordings/{id}/` and sets `recording_status = 'deleted'`. Scores, transcript and analysis stay. It is refused while the interview is invited, opened or in progress, or while analysis is running. A deleted recording is never re-analysed (`analyseInterview` and the re-analyse route refuse), so the stored scores are not overwritten with empty results.
- **Kanban** (§4): columns are `KANBAN_STAGES`; cards sit in the column of `STATUS_META[status].stage`; the card shows the best score (final, then interview, then fit) and a link to the interview. Dropping on a column uses `allowedMovesToStage(from, stage)`: one option is applied, several open a small menu, none is refused with a toast (for the Interview and Evaluation columns the toast says why: invites are sent from the candidate, and the interview moves candidates itself). Each card also has a "Move to…" menu for keyboard and touch use.
- **Job candidates page** (§3): Interview and Final score badges, the "Invited 2h ago · expires in 70h" line, and `CandidateActions` per status: Shortlist / Reject, Invite, Re-invite, Watch live, View results, Approve suggestion, Mark hired. Resend, Extend and Cancel stay in the expanded invite section.
- **Not built:** the optional dashboard home "Hiring" card (§9).

## Implementation notes (publishing, hiring agent, dialogs)

- **Publish panel** (`PublishPanel.js`, opened with **Publish** on a job card): one card per platform with the connection, the post (editable, character counter), **Write with AI**, **Post to <platform>**, **Copy and open <platform>** (hand-off, then **I posted it** with an optional link) and a **Post to all connected** button. A platform that is not connected, over its limit or without a post explains why its button is off. Rules and API: 19.
- **Job card:** shows where the job is posted (LinkedIn, Rozee.pk chips with links); the old LinkedIn-only post box and Rozee button are replaced by the panel.
- **Hiring agent page** (`/dashboard/recruiter/agent`, sidebar **Recruiter > Hiring agent**): agents and runs for the hiring pipeline only. The form asks for a job, the tone, the LinkedIn and Rozee.pk accounts to post with, shortlist settings and the mode. It never asks for a campaign. Sales agents live on `/dashboard/agents` (**Sales Agents**, sales mode only); `GET /api/agents/configs` and `/runs` take `?pipeline=recruiter | sales_operator`.
- **Dialogs:** `components/ui/DialogProvider.js` (mounted in `LayoutClient.js`) gives `useDialog()` with `confirm({ title, message, items?, confirmText, cancelText, tone })` and `alert(...)`, both returning promises. Tones: `danger` (starts on Cancel), `warning`, `info`, `success`, `error`. Escape closes only the top dialog. Every `window.confirm` / `alert` in the app was replaced.

## Implementation notes (setup guide)

- **Setup guide** page (`/dashboard/recruiter/setup`, sidebar **Recruiter > Setup guide**): the four programs with Start, Stop, Restart and their output, Postgres and Redis, the settings that matter, and a checklist of what to do next. Details and rules: 20.
- **Guidance strip** at the top of Jobs, Candidates, Hiring agent and Interviews; a **guard** before starting the Hiring agent and before sending an invite; a **sidebar dot** while something is off.

## Implementation notes (hiring agent workflow)

- **Plain words, always current:** every active hiring agent run carries an `activity` (`libs/agent/run-summary.js`, returned by `GET /api/agents/runs`): Starting, Working, N requests waiting for you, Waiting for applicants (with the apply link), Managing N applicants (3 being screened, 1 shortlisted ...), Paused, or Still waiting for the hiring worker (with a link to the Setup guide). The card shows it without being opened, and the Agents page refreshes the cards every 4 seconds while a run is active.
- **Decisions is offered only when something waits:** the card shows a **Review N requests** button only when the agent has pending requests. The Decisions page, when empty, says what each active agent is doing (and that nothing needs you yet), and looks again every 4 seconds while an agent is starting or working.

## Acceptance
- A recruiter can run the whole flow from the UI without touching the database.
- No hard-coded status strings remain in UI files (`grep -rn "'shortlisted'" app/dashboard` shows only imports from `statuses.js`).
