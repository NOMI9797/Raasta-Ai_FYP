# Part 4E · Functionality Deep Dive: Client Acquisition (Sales)

[← Index](README.md) · Previous: [Part 4D](04d-functionality-publishing.md) · Next: [Part 4F · Platform, operations, UI](04f-functionality-platform-ops.md)

**Features in this file:** S1 Campaigns · S2 Leads · S3 Lead Scraper · S4 LinkedIn post scraping · S5 Rozee job-lead enrichment and tiering · S6 AI outreach-message generation · S7 LinkedIn invites (three execution models) · S8 Connection-acceptance tracking · S9 Follow-up messaging · S10 Sales agent · S11 Statistics.

> **Reading guide and honest depth statement.** This module predates the hiring work, was written in a different style (emoji `console.log`, `@/` imports, large functions) and was **not covered by the specification or the 436-test suite** (`tests/hiring` contains no sales tests). The descriptions below are from reading the code, not from running it. Where a selector is explicitly marked `TODO: validate against the live site` in the source, the feature is marked **[UNVERIFIED]**. Known defects found while reading are listed in each feature and collected in [08b](08b-weaknesses-demo-cheatsheet.md).

---

## S1 · Campaigns

**Purpose.** A container for an outreach effort: who you target (ICP) and which platforms the leads may come from.

**Trigger.** *Sales › Campaigns* → create/edit/delete; `GET /api/campaigns` on load.

**Flow (`app/api/campaigns/**`).**
* `POST /api/campaigns` `{name, description?, icpConfig?, sources?}`: name required (trimmed, 400 if empty); `icpConfig` stored only if at least one of `targetRole`, `industry`, `serviceType` is present; `sources` filtered to `linkedin`/`rozee` (default `["linkedin"]`; note `indeed` is **not** an allowed campaign source although Indeed leads can be imported from the scraper into a campaign that allows them via `leads/scrape/import`); the user's list cache key is deleted **before** the insert (cache-aside), a per-campaign hash is written after.
* `GET /api/campaigns`: Redis-first (`user:{id}:campaigns:list`, 3 s timeout, 300 s TTL) with DB fallback. One aggregate query with `COUNT(DISTINCT …)` for leads, processed leads, messages generated and sent. **Status is derived on read** — `draft` (no leads), `active` (some unprocessed), `completed` (all processed) — and written back if different (a GET that writes, as noted).
* `GET/PUT/DELETE /api/campaigns/[id]`, all owner-filtered and cache-invalidating; admin sees all campaigns.

**Rules & edge cases.** Name required; ICP optional; cache failures never fail the request; an admin's list joins all users' leads.

**Security.** `withAuth` and owner filter on the campaigns routes themselves. **Note:** several `redis-workflow` routes that take a campaign id do not re-check ownership (below).

**Design decision.** ICP kept as a small JSON object because it only feeds prompts. Cache-aside because the list is read far more than written. *Limit:* no campaign-level analytics beyond invite statuses.

**30 seconds.** "A campaign names the audience and allowed platforms. The list is cached in Redis for five minutes, with the database as the fallback, and its status is computed from lead progress."

---

## S2 · Leads: manual URLs, CSV, bulk update, clear failed

**Purpose.** Collect the people or companies to contact.

**Flow (`POST /api/campaigns/[id]/leads`).**
1. Owner-filtered campaign lookup (404).
2. Input: `urls[]` and/or `csvData[]` (rows with `url|linkedinUrl|rozeeUrl|profile_url`, `name|fullName|full_name`, `title|jobTitle|job_title`, `company|companyName|company_name`). The CSV is parsed in the browser; the API receives rows.
3. `buildLeadFromUrl`: `detectPlatformFromUrl` (`libs/platform-urls.js`) must recognise the platform **and** the campaign must allow it; otherwise the row is dropped.
4. **De-duplication across all of the user's campaigns** by exact URL string (one query of all the user's leads joined to campaign names); duplicates are returned as `skippedLeads` with "Already exists in campaign: X". All duplicates → 400.
5. Insert `pending` leads; campaign `draft → active`; Redis cache refreshed (best effort).
* `GET /api/leads` — all of the user's leads with campaign name and a trimmed `conversion` summary (`tier, score, primaryChannel, enrichedAt, personalizationMode`).
* `GET/PUT/DELETE /api/leads/[id]`; `POST /api/leads/bulk-update` (leads + their posts); `DELETE /api/leads/clear-failed` (leads with `status = error`); `GET/POST /api/leads/[id]/posts`.

**Edge cases.** URL variants (trailing slash, tracking parameters) are *different strings* so duplicates can slip through; a lead with no URL cannot exist; invalid rows are silently dropped (the response counts only valid ones).

**Security.** All routes owner-filtered by `leads.userId`.

**Design decision.** One `leads` table for every source with `source` + `source_data`. *Trade-off:* flexible, but the JSON blob is untyped.

**30 seconds.** "Leads come from pasted URLs, CSV rows or the scraper; we keep only URLs from platforms the campaign allows and skip anything the user already has in another campaign."

---

## S3 · Lead Scraper (platform search and import)

**Purpose.** Find leads by searching job boards instead of typing URLs.

**Flow.** `POST /api/leads/scrape {platform: "rozee"|"linkedin"|"indeed", filters:{query, location, keywords, limit, country}}` (`maxDuration = 300`): looks up the platform **adapter** (`getAdapter`), refuses `comingSoon` adapters, and for platforms with an accounts table requires an **active** account of the user (400 otherwise). It calls `adapter.search(account, filters)` and returns results *in memory* (no DB write). The UI shows rows; the operator picks some; `POST /api/leads/scrape/import {campaignId, profiles[], enrichInserted?}` validates each profile (URL, platform allowed by the campaign), inserts leads as `status = completed` with `name`, `title` and `source_data` pre-filled, and optionally enriches Rozee jobs.

| Platform | `search` implementation | State |
|---|---|---|
| Rozee.pk | `searchRozeeJobs` (Playwright, authenticated session, selectors "validated against the live site (2026-04)") returns job cards `{title, company, location, salary, url, source}` | works as of 2026-04 per source comments; selectors drift |
| Indeed | hosted job runner `misceres/indeed-scraper` through `apify-client` (`libs/indeed-job-search.js`), needs `SCRAPER_API_TOKEN`; country from `filters.country` or `INDEED_JOBS_COUNTRY` (US, PK, UK, CA, AU, IN, DE, FR, AE, SG) | needs a paid token; no account needed (`accountsTable: null` on purpose) |
| LinkedIn | returns "LinkedIn profile search isn't wired up yet. Add URLs manually" | **not built** |

**Interpretation.** For job boards, a *lead is a company that is hiring* (`name` = company, `title` = role): a buying signal for a recruitment/IT-services seller.

**Security.** Owner-filtered; the Indeed token is server-side only.

**30 seconds.** "The scraper searches Rozee.pk or Indeed and shows the hiring companies it finds; the operator selects some and we import them into a campaign as ready leads."

---

## S4 · LinkedIn post scraping

**Purpose.** Get something specific to say to each LinkedIn lead.

**Flow.** Normal path: the UI calls `POST /api/scrape {urls, limitPerSource, deepScrape, rawData}`, which runs a hosted scraper actor through `apify-client`, returns items (profile + posts). `extractLeadInfo` picks the best name/title/company/picture from many field variants; `cleanScrapedPosts` normalises content, timestamps and counts. The caller stores `posts` rows (`engagement = likes + 2·comments + 3·shares`) and sets the lead `completed`. For the sales agent this is the `scrape_profiles` step, which calls the same endpoint with `limitPerSource: 2` ("cap agent scrape to two posts per lead", commit `32ace69`). **Optional:** `libs/linkedin-post-scraper.js` (Playwright, `ENABLE_MANUAL_SCRAPER=true`) is a "demonstration-only" scraper wired into the invite flow whose result is ignored.

**Rules & edge cases.** URL matching of items to leads uses a substring of the profile slug (collisions possible); no items → lead stays `pending` (agent: marks `error` on exception); scraping fails → HTTP 500; **`POST /api/scrape` has no authentication [GAP]** (anyone who can reach the server can spend the owner's scraper credits).

**30 seconds.** "A hosted scraper fetches a lead's recent posts; we clean them, store them with an engagement score, and the best posts become the raw material for the message."

---

## S5 · Rozee job-lead enrichment and tiering

**Purpose.** Prioritise job-listing leads and find a way to contact the company.

**Flow (`POST /api/leads/[id]/enrich` → `enrichRozeeLeadInDb`).** Only for `source = rozee` leads (400 otherwise). `scrapeRozeeJobDetail` (Playwright) reads the job page; `buildRozeeConversionFromDetail` computes the **tier** and **outreach hints** deterministically (`libs/lead-conversion.js`):

* score = 28 + company name (+14) + title (+10) + location (+6) + description > 200 chars (+14) and > 900 (+8) + skills ≥ 4 (+16) or ≥ 1 (+7) + salary (+6), capped at 100;
* tier **A ≥ 72**, **B ≥ 52**, else **C**; `personalizationMode = company_focused` for A, else `job_focused`;
* `extractSkillHints` (about 45 technology keywords) when the page lists no skills; emails extracted from the description and detail (≤ 8), `primaryChannel = email` if any else `linkedin`;
* optional **company research** (`rozee-enrichment.js`): Google Custom Search (100 free/day) or SerpAPI to find the official site, visit it for emails/phones/social links, optionally LinkedIn company data (needs `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_ENGINE_ID` or `SERP_API_KEY`; skipped when absent).
* Stored in `leads.source_data.conversion` (description ≤ 8,000 chars).

**Limits.** The score measures *how complete and specific the posting is*, not buying propensity; no validation data exists [GAP]. User agent in the scraper is a fixed Chrome 124/macOS string (flagged in `docs/ai-hiring/19`, finding 7).

**30 seconds.** "We score a job listing by how much real information it has, split into three tiers, and look for an email so we know whether to email or use LinkedIn."

---

## S6 · AI outreach-message generation

**Purpose.** Draft a personal message per lead.

| Endpoint | Behaviour | Auth |
|---|---|---|
| `POST /api/messages/generate` | one LinkedIn message: lead's **top 5 posts by engagement then recency**, `generatePersonalizedMessage` (uses the top 3, each cut to 500 chars) → saved `draft` | **none** [GAP] (`GET` history is `withAuth`) |
| `POST /api/messages/generate-bulk` | all `completed` leads without a message (or listed `leadIds`), batches of 5 in parallel, 2 s between batches; per-lead results | `withAuth`; **probable defect:** the insert omits `userId`, a `NOT NULL` column, so each insert should fail [verify] |
| `POST /api/messages/generate-stream` | same text streamed as server-sent events | `withAuth` |
| `POST /api/messages/generate-rozee` | B2B message for a Rozee job lead via `generateRozeeJobLeadOutreach` (facts only: company, role, location, skills, 2,500-char job excerpt, 2,200-char company research, tier, suggested channel, ICP summary) | `withAuth` |
| `PUT/DELETE /api/messages/[id]` | edit/delete a draft | `PUT` **none** [GAP], `DELETE` `withAuth` + owner |
| Redis path | `redis-workflow/.../queue-leads`, `auto-queue`, `workers/message-generator`, `generation-status` push leads into a Redis stream `campaign:{id}:message-generation` (group `message-generators`) and generate in the background | `withAuth` (queue/generation), see ownership note |

**Prompt (LinkedIn)**: "expert at writing personalized LinkedIn outreach… reference specific content from their posts… professional yet conversational, under 150 words, a clear but soft call-to-action, authentic, start directly with the message… ready to send as-is" at temperature 0.7, max 500 tokens; common preambles ("Here's a personalized LinkedIn message…") are stripped by regex.

**Known defect [GAP].** All sales generators default to `llama-3.1-8b-instant`, a model Groq has retired (commit `3eb4998` documents `model_not_found` for Llama 3.x); the model dropdown (`useMessages.js`) lists only Llama models. Until the default (and the list) change to a current model, message generation fails with "Failed to generate message".

**Edge cases.** Lead with no posts → 400 "Please scrape the profile first"; model returns empty → "No message generated"; messages are *drafts*; the operator can edit.

**Safety design.** The Rozee prompt forbids invented facts; the LinkedIn prompt is not grounded beyond the posts supplied (risk of mild invention). No toxicity or compliance filter.

**30 seconds.** "For each lead we give the LLM their best recent posts, or the job posting's facts for companies, and get a short draft the operator can edit. The Rozee prompt only allows facts we scraped."

---

## S7 · LinkedIn invites: three execution models

**Purpose.** Send connection requests within safe limits, with progress and control.

**Common core (`libs/linkedin-invite-automation.js` `processInvitesDirectly`).** For each lead: open the profile (45 s navigation timeout), detect **already connected / pending** (no Connect button and Pending button present → pending; neither → connected), find the **Connect** button (direct, then the "More" dropdown; many selector fallbacks), click, handle the invite modal and **send without a note**, update the lead (Redis hash first, then Postgres: `inviteStatus` `sent|accepted|failed`, `inviteSent`, `inviteSentAt`), then wait **10–30 s random** before the next lead; collect `{sent, alreadyConnected, alreadyPending, failed, errors[]}`; optional progress callback. Session: `testLinkedInSession` replays stored cookies/localStorage/sessionStorage in a Playwright persistent context under `/tmp/linkedin-test-<sessionId>` and checks that `/feed` loads without redirecting to login/checkpoint.

**The three ways to run it.**

| Model | Endpoint | Process | Control | Use |
|---|---|---|---|---|
| **Direct** | `POST /api/redis-workflow/campaigns/[id]/activate` (and `activate-stream`) | inside the HTTP request; holds a browser until the batch finishes | none (request can time out) | small batches, demos |
| **Background job** | `POST /api/campaigns/[id]/start-workflow` | inserts `workflow_jobs` (**one queued/processing job per user**, else 409) and `spawn('npx', ['tsx','workers/workflow-worker.js', jobId], {detached:true})`; the worker checks the daily limit, slices to the remaining quota, runs **batches of 10 leads** with a fresh browser session per batch, writes progress to the DB and Redis (`job:{id}:status`, snapshot 10 min), exits on `pause`/`cancel` published to `job:{id}:control`, and falls back to DB polling if Redis is unreachable | `POST /api/jobs/[id]/{pause,resume,cancel}`, `GET /api/jobs/[id]/status` and `/stream` (SSE) | the main path |
| **Redis-batched** | `queue-invites` → `workers/invite-sender` | leads queued in a stream `campaign:{id}:invite-sending` in 5-lead batches; a per-campaign lock `batch-processing:campaign:{id}` | status endpoints | earlier design; the two routes trust `x-internal-call`/`x-user-id` headers and have **no session check** [GAP] |

**Rate limiting.** `rate-limit-manager.js`: `checkDailyLimit` (rolling 24 h since `last_daily_reset`; schema default 30, set to 30 for all accounts by `scripts/update-daily-limits.js` when the limit was lowered from 100), `incrementDailyCounter` after sending; accounts can have their limit changed through `POST /api/linkedin/accounts/update-limit`.

**Edge cases.** Session invalid → job fails with "Session invalid: …" and the account is flagged inactive; no eligible leads → job completes as a successful no-op (`skipped: all_leads_already_processed`); LinkedIn UI change → "Failed to click Connect button" per lead; Redis down → direct status writes continue (Redis updates are best effort); worker crash → job stays `processing` until someone polls `GET /api/jobs/[id]/status`, which marks any job older than **2 hours** as `timeout` ("Worker may have crashed") [PARTIAL: detection only happens when the status is polled]; resume continues from remaining eligible leads (not from an index).

**Security / risk.** Automation of LinkedIn violates its terms; the owner accepts the account-ban risk (CLAUDE.md). Sessions are stored as plain JSON. **`spawn('npx', …)` requires a long-lived host and the repo's `postinstall` Playwright install; it will not work on Vercel.**

**Design decision.** A detached per-run process isolates Chromium from the web server and survives browser close (the original justification, `SCALABILITY_ANALYSIS.md`); the analysis itself says it caps out around 50–100 concurrent users and proposes BullMQ [PLANNED].

**30 seconds.** "We replay the operator's LinkedIn session in Playwright, click Connect on each lead with a random 10–30 second pause, never above the account's daily limit, either inline, as a background process we can pause or cancel over Redis pub/sub, or through a Redis stream of small batches."

---

## S8 · Connection-acceptance tracking

**Purpose.** Know who accepted so follow-ups can be sent.

**Flow (`libs/linkedin-connection-checker.js` `checkConnectionAcceptances`).** (1) `testLinkedInSession`; (2) `fetchLeadsWithSentInvites(userId)`; (3) scrape the **My Network › Connections** page, scrolling to load at least `max(3 × sent, 100)` connections; (4) reduce profile URLs to usernames (`extractUsernameFromUrl`); (5) lead is *accepted* if its username is among the connections; (6) update `invite_status = accepted` (Redis then Postgres) and `invite_accepted_at`; (7) send the stored message to accepted leads (S9); (8) stamp `last_connection_check_at`.

**Triggers.** Manual: `POST /api/linkedin/connections/check-acceptance` (user session, or `x-internal-agent-token` equal to `INTERNAL_AGENT_TOKEN` plus a `userId`); automatic: `GET /api/linkedin/connections/check-schedule` with `Authorization: Bearer ${CRON_SECRET}` (default **`dev-cron-secret-change-in-production`** if the variable is unset [GAP]) called by Vercel Cron at **09:00 and 14:00 (UTC)** for every active account that has not reached its daily check limit.

**Limits/edge cases.** Daily check cap per account (`daily_connection_checks`); vanity-URL mismatch (e.g. numeric-ID URLs) can miss matches; LinkedIn may paginate/lazy-load differently; invites accepted long ago but beyond the 100 newest connections are missed.

**30 seconds.** "We open the connections page, collect usernames, and any lead whose invite we sent and whose username appears there is marked accepted; a daily cron does this twice a day."

---

## S9 · Follow-up messaging

* **LinkedIn** (`libs/linkedin-message-sender.js` `sendMessageToLead`): finds the **Message** button through ordered strategies (aria-label, text, class), handles the premium overlay (commit `a5bf6bd`), types the stored message and sends; delay **30–90 s** between messages; daily cap `daily_message_limit` (default 10) checked before each send via `checkDailyMessageLimit`; success sets `leads.message_sent`, `messages.status = sent`.
* **Rozee.pk** (`libs/rozee-message-sender.js`, `POST /api/rozee/messages/send`): in-platform message to a profile; selectors are marked `TODO: validate against the live messaging UI` **[UNVERIFIED]**; daily cap 15. `libs/rozee-auto-applier.js` and `POST /api/rozee/apply` (apply to a job as a candidate) are likewise **[UNVERIFIED]**.
* Errors are stored in `leads.message_error`.

**Compliance note.** Messages are sent **only to accepted connections**, which is the polite default; the operator is responsible for the content.

**30 seconds.** "Once someone accepts, their stored message is sent through LinkedIn's own message box, slowly and under a daily cap."

---

## S10 · Sales agent (generic `AgentRunner`)

**Purpose.** Run the whole sales sequence as a pipeline with an approval checkpoint.

**Flow.** `POST /api/agents/runs {pipelineType: "sales_operator", mode, config:{campaignId, accountId, rozeeAccountId?, dailyInviteLimit?, waitSeconds?, customPrompt?}}` creates an `agent_runs` row and, **inside the web server process**, starts `new AgentRunner(...).execute()` as a fire-and-forget promise (it dies if the server restarts) **[PARTIAL]**. Pipeline steps (`libs/agent-pipelines/sales-operator.js`): `scrape_profiles` → `generate_messages` → **`approve_messages` (checkpoint)** → `send_invites` → `wait_and_check` (default 180 s, then calls `check-acceptance` with the internal token) → `send_messages` → `send_rozee_messages` → `report_results`. Modes: `semi_auto` pauses at the checkpoint (`paused_at_checkpoint`, in-app notification) until `POST /api/agents/runs/[id]/approve`; `full_auto` skips it. Step outputs persist in `agent_steps`; failure marks the run `failed` with the step name; `cancel` skips remaining steps.

**Defects/limits.** Internal self-calls (`/api/scrape`, `/api/messages/generate`) are made **without credentials**, which is why those endpoints are unauthenticated [GAP]; `wait_and_check` sleeps inside the server process; `approve_messages` approves *the whole batch* with no per-message editing in the agent UI; a saved config can be launched by id without an ownership check [GAP]; model default is the retired Llama.

**30 seconds.** "The sales agent is a fixed sequence — scrape, draft, ask you to approve, invite, wait, check acceptances, message — that either pauses for approval or runs straight through."

---

## S11 · Campaign statistics

`GET /api/campaigns/stats[?campaignId]` (admin sees all) counts leads by `invite_status` globally and per campaign plus a timeline, from one query of the relevant leads (`calculateStats`/`calculateTimeline`); the dashboard (`app/dashboard/statistics`, `StatsCharts`, `SummaryCards`, `DetailedBreakdown`) renders them. Nawal's only commit fixed error handling and access in this area (admin sees all campaigns; empty-state shape). Metrics are about **LinkedIn invites** (sent, accepted, pending, failed); reply rate or conversions to clients are **not tracked** [GAP] — which is also why there is no `clients` table.
