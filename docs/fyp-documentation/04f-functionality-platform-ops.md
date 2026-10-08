# Part 4F · Functionality Deep Dive: Identity, Accounts, Operations, UI Foundations

[← Index](README.md) · Previous: [Part 4E](04e-functionality-client-acquisition.md) · Next: [Part 5 · AI components](05-ai-components.md)

**Features in this file:** P1 Registration, sign-in, sessions · P2 Roles, modes, onboarding, admin · P3 Platform accounts · P4 Settings · P5 Queue and worker · P6 Embedded worker, Setup guide, supervisor · P7 Admin queue card · P8 Storage and signed links · P9 Email delivery · P10 Rate limiting · P11 Dashboard shell and UI foundations · P12 Public site · P13 Billing · P14 Speed tooling · P16 Branding check, tests, scripts · P17 Utility/debug endpoints.

---

## P1 · Registration, sign-in, sessions

**Purpose.** Let people create an account and sign in with email/password or Google.

**Trigger.** `/signup` → `POST /api/auth/register`; `/signin` → NextAuth credentials or Google; every API call afterwards carries the session cookie.

**Flow.**
1. *Register* (`app/api/auth/register/route.js`): requires `firstName`, `lastName`, `email`, `password`; email regex; password length ≥ 8; case-insensitive uniqueness (`lower(email)`); `bcrypt` cost 12; `id = nanoid()`; `role = sales_operator`, `modes = []`; returns 201 with `{id,email,name}` (no auto sign-in). Generic 500 hides internals outside development.
2. *Credentials sign-in* (`libs/next-auth.js` `authorize`): trims and lower-cases the email, loads the user, compares with `bcrypt.compare`, returns `{id,email,name,image}` or `null` (no hint which part failed).
3. *Google*: `GoogleProvider` (`GOOGLE_ID/GOOGLE_SECRET`); profile mapped to `{id: sub, name, email, image}`. There is **no DB adapter**, so the `users` row for a Google user is created lazily by `authenticateUser` on the first authenticated API call (`id = session.user.id`, `googleId` = same).
4. *JWT strategy*: `callbacks.jwt` re-reads `role`, `modes`, `name`, `hasPassword` from `users` whenever the session is checked; `callbacks.session` exposes them as `session.user`.
5. *Pages guard* (`app/dashboard/layout.js`): no session → `/signin`; no modes and not admin → `/onboarding`.

**Edge cases.** Duplicate email (case-insensitive) → 400; Google user later setting a password → `POST /api/user/password` allows it without a current password; a user deleted while holding a valid JWT → `requireUser` routes return 401 "User not found in database"; `/forgot-password` shows the support email, **no reset flow exists** [GAP].

**Security.** bcrypt 12; generic failures; tokens in HttpOnly cookies by NextAuth defaults; **no rate limiting or lockout on sign-in/sign-up, no email verification, no CAPTCHA, no 2FA** [GAP]. `NEXTAUTH_SECRET` required.

**Design decision.** NextAuth with JWT: no session table, template default. *Limit:* extra DB query on each session check.

**30 seconds.** "Email-and-password accounts are hashed with bcrypt, Google sign-in is supported, and the session token is a signed JWT that the server enriches with the user's role and modes from the database on each check."

---

## P2 · Roles, modes, onboarding, admin user management

**Roles** (`users.role`): `admin`, `sales_operator` (default), `recruiter`. **Modes** (`users.modes`): `recruiter`, `sales`, chosen in `/onboarding` (a 2-step wizard: choose mode(s), optionally connect platforms — recruiter: LinkedIn, Rozee.pk, Indeed; sales: LinkedIn, Indeed) via `POST /api/user/modes` (at least one; unknown values discarded). Role is **not** changed by modes; admin is assigned by an admin (`PATCH /api/admin/users {userId, role}`, allowed roles validated) or directly in the database.

**Enforcement matrix.**

| Surface | Mechanism | Strength |
|---|---|---|
| Sidebar groups | `requireMode`/`requireRole` | cosmetic |
| `/dashboard/**` | session + modes (layout) | page-level |
| `/api/**` | `withAuth` + owner filter (`userId`/job owner); admin bypass | the real control |
| Admin pages/APIs | `role === "admin"` | strong |
| System control | `canUseSystem`: admin or recruiter mode | role-based |

**Admin page** (`app/dashboard/admin`): user table with role selector, subscription status display, and the **Hiring queue** card (P7). **Gap:** a user in `sales` mode can call recruiter APIs directly (modes are not checked server-side) and vice-versa; ownership still isolates data.

**Edge cases.** Admin sees all jobs/campaigns/candidates (owner filters short-circuit); changing a role takes effect on the user's next session check (JWT callback re-reads).

**30 seconds.** "Roles are admin, recruiter or sales; modes only choose which menus a person sees. The real protection is that every query is filtered by the owner, with admin as the one exception."

---

## P3 · Platform accounts: connect, test, activate, limits

**Purpose.** Hold the logged-in browser sessions that automation uses.

| Platform | Connect | Test | Other |
|---|---|---|---|
| **LinkedIn** | `POST /api/linkedin/connect {email,password}` — headless Chromium (`slowMo 1000`), human-like delays and random mouse moves, fills the login form (selectors matched on stable attributes, only visible elements), waits for feed/profile or detects `INVALID_CREDENTIALS`, `2FA_NOT_SUPPORTED` ("disable 2FA and try again"), checkpoint, `LOGIN_TIMEOUT`; captures cookies, localStorage, sessionStorage, profile name/picture; saves via `LinkedInSessionManager.saveSession`; one connection at a time per user (`activeConnections` set); returns debug screenshots | `POST …/accounts/test-session` replays and verifies | `toggle-active` (transactional: one active per user), `update-limit`, `DELETE` |
| **Rozee.pk** | `POST /api/rozee/connect` (same pattern; user/password typed into Raasta-AI) | `…/accounts/test-session` | `toggle-active`, `update-limit` (daily invite/message), `DELETE` |
| **Indeed** | `POST/GET/DELETE /api/indeed/connect` — a **visible window**, the person signs in; no password enters Raasta-AI | `…/accounts/test-session` | `toggle-active`, **Diagnose** (`/accounts/debug`) |

**Security findings.** (1) LinkedIn/Rozee.pk passwords **pass through the server** during connect (not stored); (2) the resulting session JSON is **stored unencrypted** (contrary to `LINKEDIN_INTEGRATION.md`) [GAP]; (3) accounts are shared among operators in the publishing resolver [GAP]; (4) the connect flow tells users to disable 2FA [GAP: poor security advice, prefer the visible-window model used for Indeed].

**30 seconds.** "A connected account is just a stored browser session plus counters. LinkedIn and Rozee.pk are connected by logging in on the server's headless browser; Indeed is connected by the person signing in in a real window."

---

## P4 · Settings

`app/dashboard/settings/page.js` (rebuilt in `41a9d0f`): **Profile** (`PATCH /api/user/profile`: name required, whitespace collapsed, ≤ 100 chars), **Security** (`POST /api/user/password`: new password ≥ 8; for accounts with a password the current one must match (bcrypt) and the new one must differ; Google-only accounts may *set* a password; hash cost 12), **Preferences**, and the **Notifications** list (filter unread, mark read, deep-link `#notifications`). The sidebar collapsed state is a cookie (`sidebar-cookie.js`) so the server renders the right layout.

---

## P5 · Hiring queue and worker  *(details of M12)*

**Purpose.** Reliable background execution.

**Worker loop (`workers/hiring-worker.js`).**
* Identity `WORKER_ID` (hostname-pid); concurrency `HIRING_WORKER_CONCURRENCY` (default 3).
* Read: dedicated blocking connection `XREADGROUP GROUP hiring-workers <id> COUNT min(5, free) BLOCK 5000 STREAMS hiring:jobs >`. The group is created at `0` with `MKSTREAM` so jobs queued before the first worker started are not skipped.
* Process: each job type has a handler and a timeout (default 60 s; analysis 15 min; recording join 5 min; agent tick 5 min); `withTimeout` rejects; success → log + `XACK`; failure → if `attempt < 3` and `error.retryable !== false` → re-enqueue with delay `max(2^attempt × 10 s, retry-after)` then ack; else `XADD hiring:jobs:dead` with the error (≤ 500 chars), ack. **Ack happens only after the job is finished or safely re-queued**; if the bookkeeping throws, the message stays pending for reclaim.
* Reclaim: every 60 s `XAUTOCLAIM … idle ≥ 5 min COUNT 20`.
* Delayed jobs: every 5 s `moveDueDelayed` (ZRANGEBYSCORE + ZREM + XADD; only the worker whose ZREM succeeds enqueues).
* Sweeps (15 min and at start): expire invites; queue reminders; tick active agents; close stale interview sessions (each independently failure-tolerant).
* Shutdown: SIGTERM/SIGINT stops reading, waits for in-flight jobs, disconnects, exits; a hosted worker also exits within 5 s when its parent PID disappears.
* Logging: one JSON line per job (`service, level, worker, type, id, attempt, ms, ok, error`), never payloads.

**Idempotency examples.** `send-invite` returns `skipped` if an active interview exists; `ensure-questions` skips if questions exist; `finalize-candidate` recomputes and overwrites; `send-outcome-email` records `outcomeEmail`; `analyse-interview` skips if `complete` unless forced.

**Edge cases.** Unknown job type → dead-letter at once; a handler throws `retryable: false` (e.g. inviting a rejected candidate) → dead-letter without retries (`c1d51b2`); Redis unreachable → worker logs and retries the read every 2 s; two workers → safe; stream trimmed to ~10,000 entries (approximate `MAXLEN`).

**30 seconds.** "Jobs are Redis stream messages processed by a consumer group; a job is acknowledged only after it's done. Failures retry with exponential back-off, then land in a dead-letter stream that an admin can retry, and crashed workers' jobs are reclaimed after five minutes."

---

## P6 · Embedded worker, Setup guide, supervisor

**Embedded worker host (`instrumentation.js` → `libs/system/worker-host.js`).** The Next server starts the worker as a child process when it boots (Node `instrumentation` hook enabled by `experimental.instrumentationHook`), restarts it with back-off `1, 2, 5, 10, 30 s`, and applies a circuit breaker (5 starts within 2 minutes → pause 5 minutes). `enqueue()` calls a global hook so queuing a job also "wakes" the worker. `HIRING_WORKER_MODE`: `embedded` (default), `external` (Docker/terminal runs it; the web server only reports), `off`. A worker started by another server is recognised by its name (`web-<pid>`) and by that server's liveness.

**Setup guide (`/dashboard/recruiter/setup`).** Shows Postgres, Redis and the programs (web, worker, interview engine, AI engine, optional posting engine) as *running / starting / stopped / crashed / not responding*, why each exists, ffmpeg availability, which settings are missing (names and states only, **never values**), the tail of each started program's log, Start/Stop/Restart buttons, and a "what next?" checklist (`buildGuidance`: start programs → connect a platform (optional) → create a job → write the post → publish → get applicants → screen → approve → interviews → decisions). Probes: HTTP `/health` with 1.5 s timeout, Redis `PING`, Postgres `SELECT 1`, config checks. `GET /api/system/status[?guidance=1&fresh=1]` shares one reading for 2 s. A guidance strip on Jobs, Candidates, Agent and Interviews; guards before starting the agent and before sending an invite offer to start missing programs.

**Supervisor (`libs/system/supervisor.js`).** Only a fixed list of programs with fixed commands can be started (the browser sends an id and an action, never a command); processes are detached with pid files and logs in `.runtime/`; starting/stopping is **on in development and off in production unless `SERVICE_CONTROL=true`**; permissions via `canUseSystem` (admin or recruiter mode).

**Why it exists.** A real incident: "the worker wasn't running, so nothing happened and no one knew" (`docs/ai-hiring/16` 2026-10-05). The page turns a silent failure into a visible, fixable one.

**30 seconds.** "The web server runs and restarts its own worker, and a Setup page shows which programs are up, starts them with fixed commands in development, and tells a new user what to do next."

---

## P7 · Admin Hiring-queue card

`GET /api/admin/hiring-queue` (admin only, 503 if Redis is down) → `getQueueOverview`: `waiting` (consumer-group lag; stream length if no worker ever connected), `inFlight`, `delayed`, worker `seen/active` (a consumer seen within 30 s) and last seen, the newest 50 dead-lettered jobs and the total. `POST …/retry {id}` removes the entry from `hiring:jobs:dead` first (so two clicks retry once), enqueues a fresh attempt 0, restores the entry if enqueue fails; 404 if gone, 409 if someone else retried. The card refreshes every 10 s and warns "jobs waiting but no worker is running".

---

## P8 · Object storage and signed links

Detailed in M18. Additional facts: drivers `local` and `s3` selectable by env; local metadata sidecar `*.meta.json` holds the content type; `listKeys` walks directories; resume download = `GET …/candidates/[id]/resume` → 302 to a signed link (300 s) with `filename`; recordings = 900 s; **`STORAGE_SIGNING_SECRET` must be ≥ 32 chars** or signing throws a configuration error (distinguished from "invalid link"). The AI engine mirrors the key rules in Python (`core/storage.py`).

---

## P9 · Email delivery

Detailed in M7/D.11. `deliverEmail({to, subject, text, html, from})` returns `{delivered: "mailgun" | "outbox" | "custom"}`; `usesDevOutbox()` is true without `MAILGUN_API_KEY` unless `NODE_ENV=production` (override `EMAIL_OUTBOX=local`, which `npm run serve` sets); the outbox filename is `<ISO time>-<sanitised address>.html/.txt` under `.storage/outbox/`. Sender `Raasta-AI <noreply@mg.reachly.ai>` (`config.mailgun.fromNoReply`; the domain is the earlier product's). `POST /api/webhook/mailgun` verifies an HMAC of timestamp+token with `MAILGUN_SIGNING_KEY` and forwards inbound replies to `support@reachly.ai`.

---

## P10 · Rate limiting

See D.16. Implementation notes: `rateLimit(key,{limit,windowSec})` uses `INCR`, sets `EXPIRE` on the first hit, returns `{allowed, remaining, retryAfterSec}`, repairs a key that lost its TTL, and **fails open** when Redis errors. Candidate budgets per token and route per hour: get 120, consent 20, session 60, upload 900, event 300.

---

## P11 · Dashboard shell and UI foundations

* **Layout:** `components/layout/DashboardShell.js` (sidebar + top bar + content), `Sidebar.js` (role/mode filtered groups, health dot from `useSystemStatus`, collapse state), `TopBar.js`, `NotificationBell.js`, `SidebarContext.js`.
* **Dialogs:** `components/ui/DialogProvider.js` exposes `useDialog()` → `confirm({title,message,items,confirmText,cancelText,tone})` and `alert(...)`, promise-based; tones danger (focus starts on Cancel), warning, info, success, error; Escape closes only the top dialog. Every native `confirm/alert` was replaced (CLAUDE.md rule 10).
* **Data:** TanStack Query provider (`components/QueryProvider.js`); devtools off unless `QUERY_DEVTOOLS=true`.
* **Guidance strip:** `components/system/GuidanceStrip.js`; hooks `useSystem.js`, `useServiceGuard.js`.
* **Theming:** DaisyUI themes via `config.js`/`tailwind.config.js` (brand colour `#6366F1`, "electric indigo", commit `4c49f70`).
* **Accessibility:** keyboard operable buttons, `aria-live` on checks, live captions, `Move to…` alternative to drag and drop.

---

## P12 · Public site (landing, blog, legal)

`app/page.js` composes `Hero`, `Problem`, `FeaturesAccordion`, `Pricing`, `FAQ`, `CTA` etc. from `components/` (ShipFast sections re-written for "Raasta-AI" in `b8b56a5`/`4aac84e`). `app/blog/**` with `content.js` articles; `app/privacy-policy`, `app/tos` template legal pages; `sitemap` via `next-sitemap` (`postbuild`); `libs/seo.js` metadata helper. These carry almost no project-specific engineering and the team should say so.

---

## P13 · Billing (Stripe)

See M20. Summary: checkout and customer-portal session creation exist (`libs/stripe.js`), webhook verifies the signature and then does nothing, plans are template placeholders, **no feature gating** → [PARTIAL]. Not part of the FYP's evaluated functionality.

---

## P14 · Speed tooling

* `npm run serve` (`scripts/serve.js`): builds into `.next-prod` (never touching a running `npm run dev`), rebuilds only when `app/`, `components/`, `libs/` or config files are newer than the last build (`--rebuild`, `--no-build`, `--port`), then starts `next start` on 8085; sets `SERVICE_CONTROL=true` and `EMAIL_OUTBOX=local` unless overridden. Measured in `docs/ai-hiring/21`: sum of first visits of main screens **51 s → 2.5 s**; sign-in to Home **1.2 s**.
* `libs/system/dev-warmup.js`: in development only (`DEV_WARMUP=false` disables) requests ~20 screens in order after the server is ready (`WARMUP_PATHS`, 250 ms gaps) so Next has compiled them before the first human arrives.
* `next.config.js`: longer-lived compiled screens in dev (`onDemandEntries` 30 min), external server packages (`pdf-parse`, drizzle, redis, openai, …) to cut bundling time, `distDir` override.
* Indexes added in `0013` for the hot queries.

---

## P16 · Branding check, tests and scripts

* `scripts/check-branding.sh` (`npm run check:branding`): fails if the earlier interview project's name appears anywhere in the repo (name assembled at runtime so the script itself doesn't contain it; excludes `node_modules`, `.git`, `.next*`, venvs, `.runtime`, `.storage`). It enforces CLAUDE.md rule 1.
* `npm run test:hiring` (`tsx --test tests/hiring/*.test.js`): 436 tests; helpers `fake-clock.js`, `mock-indeed.js`, `mock-rozee.js`.
* `scripts/interview-test-client.js`: scripted WebSocket client that streams fixture WAVs as PCM, answers `ai_done_speaking`, and flags a question arriving while the candidate is still talking (options `--answers`, `--no-answer-done`, `--disconnect-after`, `--talk-during-processing`, `--speed`).
* `scripts/sync-mediapipe.js`: copies the WASM runtime from `node_modules` and obtains the face model (≈ 4 MB) into `public/mediapipe/`.
* `scripts/update-daily-limits*.js`: one-off migration that caps LinkedIn `daily_limit` at 30. `test-prefetch.js` (root): manual test of the Redis pre-fetch API (needs `node-fetch`, not a dependency).

---

## P17 · Utility and debug endpoints

| Route | What it does | Risk |
|---|---|---|
| `POST /api/init-db` | runs `initializeDatabase()` → Drizzle `migrate` over `./drizzle` | **No auth.** Schema-changing call exposed (and the migrations folder cannot rebuild the schema anyway) |
| `POST /api/migrate-message-tracking` | `ALTER TABLE … ADD COLUMN IF NOT EXISTS` for six message-tracking columns | **No auth** |
| `GET /api/debug-schema` | reads `information_schema`, then **inserts and deletes a test row in `users`** | **No auth** (and uses a string-form `db.execute` that may not run on this Drizzle version) |
| `GET /api/test-db` | `SELECT 1`; returns `{ok}` only (comment: "never return table rows") | public by design |
| `POST /api/lead` | landing email capture; validates presence, discards the email | public by design |

**Recommended fix (Part 9):** delete `init-db`, `migrate-message-tracking` and `debug-schema`, or protect them with `role === "admin"` and disable in production.
