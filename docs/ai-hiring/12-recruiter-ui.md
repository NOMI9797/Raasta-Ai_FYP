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
- Grouped by job: candidates in `interview_completed` with a final analysis, sorted by final score.
- Each row: name, scores, recommendation, suggested decision, and buttons **Accept suggestion** / **Shortlist** / **Reject** / **Open**.
- Bulk "Accept all suggestions" per job (skips `needs_review`).

## 8. Interview questions page
See [07-question-bank.md](07-question-bank.md).

## 9. Dashboard home (optional)
Add a "Hiring" stats card: applications this week, shortlisted, interviews completed, pending decisions.

## Acceptance
- A recruiter can run the whole flow from the UI without touching the database.
- No hard-coded status strings remain in UI files (`grep -rn "'shortlisted'" app/dashboard` shows only imports from `statuses.js`).
