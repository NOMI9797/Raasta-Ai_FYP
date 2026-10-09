# Part 4D · Functionality Deep Dive: Writing and Publishing Job Posts

[← Index](README.md) · Previous: [Part 4C](04c-functionality-evaluation-decisions.md) · Next: [Part 4E · Client acquisition](04e-functionality-client-acquisition.md)

**Features in this file:** H3 AI post generation per platform · H4 Publishing to LinkedIn (automatic) and hand-off · H5 Posting engine (visible window) · H6 Assisted posting with the browser extension · plus the Indeed sign-in window and diagnostics that support them.

> **Why this area is the most evidence-driven part of the system.** Every decision below was changed by something observed on the real platforms (2026-10-06 to 2026-10-08): Indeed's bot check, Rozee.pk's new wizard, an Indeed employer account pause. The honest summary for the panel: **LinkedIn can be posted to automatically; Indeed and Rozee.pk are posted with a supervised visible-window engine or a browser extension; and the pipeline does not depend on any of them, because candidates only need the apply link.**

---

## H3 · AI job-post generation, one post per platform

**Purpose.** A LinkedIn feed post, a Rozee.pk job ad and an Indeed job description are three different documents; write each in its platform's format.

**Trigger.** *Publish* panel → **Write with AI** (`POST /api/hiring/jobs/[jobId]/generate-post {platform: "linkedin"|"rozee"|"indeed"|"all", tone?}`); the agent's setup step.

**Flow.**
1. `ownerFilter` job lookup (404).
2. The apply link is **built server-side** (`jobApplyUrl(jobId)` from `NEXT_PUBLIC_APP_URL`/`NEXTAUTH_URL`), never taken from the browser, so a post cannot be made to point elsewhere.
3. For each platform in parallel (`Promise.allSettled`): `generatePlatformPost` → `buildPostPrompt` → `chatText` on the **fast model** (temperature 0.7, 2,000 tokens). If the answer is shorter than 40 characters it asks **once more**; if still empty it throws "The AI did not return a {platform} post" (this fixed a bug where a model that ran out of "thinking" budget returned nothing and the post was only the apply link).
4. `finalizePost(platform, raw, {applyUrl})` — deterministic enforcement:

| Rule | LinkedIn | Rozee.pk | Indeed |
|---|---|---|---|
| Max characters (`maxChars`) | 3000 | 4000 | 4000 |
| Word range in the prompt | 130–220 | 180–350 | 180–380 |
| Emojis | allowed (≤ 3 in the prompt) | stripped | stripped |
| Hashtags | ≤ 5 (extra removed) | 0 | 0 |
| Markdown (`**`, `#`, backticks, `*` bullets) | stripped | stripped | stripped |
| Apply link | inserted as `Apply here: <url>` before the hashtag line if missing | `How to apply: <url>` | `How to apply: <url>` |
| Structure | hook in the first two lines, short paragraphs, CTA | sections *About the role, Responsibilities, Requirements, What we offer (only if given), How to apply* | same sections; first two sentences name title, location and type |

5. Hard prompt rules for every platform: use only the facts given; never invent a company name, salary, perks or team size; write the salary exactly as given (no invented pay period); plain text; return only the post.
6. Saved into the corresponding `jobs` column; the response lists `warnings` (what was changed, e.g. "Emojis removed", "Apply link added", "Shortened to fit 3000 characters").

**Inputs → outputs → side effects.** Job fields in; text out; one LLM call per platform; DB update.

**Validation.** `validatePost`: non-empty and ≤ `maxChars`; length counter in the panel; a platform error doesn't block the others (`errors{}` per platform; 429 if all failed with a rate limit, 502 otherwise).

**Edge cases.** Salary only partly given ("?" shown) ; no skills → "not specified"; long output → cut at a paragraph/line/space boundary above 60% of the limit; unknown platform → 400.

**Security.** The post is *the recruiter's own content*; no candidate data is in the prompt. **Prompt-injection surface:** job fields are authored by the (authenticated) recruiter.

**Design decision.** Per-platform prompt **plus** a code-side enforcer, because LLMs ignore length/format rules about 1 in N times and a platform rejecting a post is costly. *Rejected:* one generic post pasted everywhere. *Limit:* no A/B or quality evaluation of the posts [GAP].

**30 seconds.** "We write a separate post for each job board with a prompt tuned to that board, and then code enforces the board's rules — no markdown, hashtag and emoji limits, the apply link present, length under the limit."

---

## H4 · Publishing: automatic (LinkedIn) and hand-off (all platforms)

**Purpose.** Get the saved post onto a platform while preventing double posts, floods and unsafe retries.

**Trigger.** `POST /api/hiring/jobs/[jobId]/publish {platforms: "all"|[...], mode: "auto"|"handoff", accountIds?}`; `POST …/publish/confirm {platform, postUrl?}` ("I posted it").

**Flow (`libs/hiring/publishing.js`).**
* `publishToPlatforms` runs platforms **one after another**; each stands alone (one failing doesn't stop others). With `"all"` in `auto` mode it targets platforms that have a connected account **and** offer background posting (today only LinkedIn); in hand-off mode it targets all.
* `publishToPlatform({job, platform, mode, initiatedBy, accountId})`:
  1. `validatePost`; refuse if the job is `closed`.
  2. **Hand-off:** insert `job_publications` (`handed_off`), return `{text, handoffUrl, kit?}`. `composerHandoffUrl` for LinkedIn opens `linkedin.com/feed/?shareActive=true&text=<post>` (the recruiter presses Post); for Rozee.pk/Indeed it returns the employer dashboard URL and the **posting kit** (`buildPostingKit`).
  3. **Auto:** `autoPostAvailability(platform)` → refuse if not available (`auto_unavailable`); `resolveAccount` (the account asked for, else the owner's active one, else the team's only active one); read this account's `job_publications` from the last 24 h; **guard**; release stale in-flight attempts (> 10 min); insert a `publishing` row (the **partial unique index** `one_inflight` makes a second concurrent attempt fail with `in_progress`); `adapter.publishJob(account, job)`; update the row to `published`/`failed`/`needs_login`/`unconfirmed`; on success `recordPublished` sets the job's `status = published` and per-platform URL/time.
* `evaluateGuard` (pure): per-account **daily cap** (LinkedIn 3, Rozee.pk 5, Indeed 3 per rolling 24 h; env `PUBLISH_DAILY_CAP_<PLATFORM>`), **minimum gap** (10/5/10 minutes), **retry brake** 2 minutes after a failed attempt, and for **agent-initiated** posts a **12-hour cool-off** after any `needs_login` on that account.
* `classifyFailure`: `unconfirmed` (Post clicked but never confirmed; counts as a post), `needs_login` for checkpoint/challenge/security check/session/sign-in wording (never retried), else `failed`; error text is reduced to its first line (`plainError`) because Playwright call logs are meaningless to recruiters; a 30000 ms-timeout becomes "the page did not respond the way the automation expects… Use Copy and open".
* `confirmHandoff`: marks the open hand-off `published`; the pasted link must be **https on the platform's own domain** (`isAllowedPostUrl`: `linkedin.com|lnkd.in`, `rozee.pk|rozeegpt.ai`, `indeed.com`).
* `getPublishingOverview` (`GET …/platforms`): for the panel, per platform: connection state, saved post and problems, where it's published, latest attempt, whether auto/engine/assisted are available, guard state with remaining quota and next allowed time, and `canAutoPublish`.

**Why background posting is switched off for Indeed and Rozee.pk** (`autoPostAvailability`): Indeed's employer area sits behind Cloudflare; a hidden browser got HTTP 403 while a visible window with a person passed (`docs/ai-hiring/19 §5c`). Rozee.pk's "Post a job" is now an AI wizard whose last step spends a credit or sells an upgrade — a decision that belongs to a person (§5g). `INDEED_AUTO_POST=true` would turn the path on, but **nothing is built behind that flag** (`libs/indeed-job-publisher.js` answers `ui_changed`).

**LinkedIn automatic post.** `libs/linkedin-post-publisher.js` via the adapter: session replay, open the composer, type, click Post, confirm. A checkpoint/challenge URL returns `code: checkpoint` and the attempt stops. Success needs a URL; selectors are fragile (many fixes in history).

**Edge cases.** Double click while publishing → `in_progress` (straight answer, not "too soon"); account switched off → "connected but switched off"; limit reached → message with the time to retry; platform asks for a security check → `needs_login`, **no retry**, recruiter told to confirm on the platform; storage of the post URL only from an allowed domain.

**Security.** The posting account is chosen with a server-side resolver; operators share connected accounts (finding 4 in `docs/ai-hiring/19`) [GAP: no per-person scoping]; stored sessions are plain JSON [GAP].

**Design decision.** *Guarded, auditable attempts* (a row per attempt) over a boolean "published". The guard values were chosen to look like "a person posts a few jobs a day, not dozens" (comment in code). *Rejected:* retry-until-success (what gets accounts restricted).

**30 seconds.** "Posting is guarded: validate, check the account's daily cap and gap, take a database claim so two posts can't overlap, and if the platform shows a sign-in or security check we stop and tell the recruiter instead of retrying. Where we can't safely automate, we hand the text over."

---

## H5 · Posting engine (visible window; Indeed and Rozee.pk)  *(special depth: honest status)*

**Purpose.** Fill the platform's "Post a job" form like a person, with a person watching and in control, and read every field back.

**Components.** `services/poster-engine/index.js` → `libs/poster/engine.js` (process, polling loop, health on `127.0.0.1:8095`), `runner.js` (step engine), `flow-indeed.js` / `flow-rozee.js` (the platform maps), `human.js` (typing/mouse), `page-tools.js`, `practice/*` (stand-in sites), `runs.js` (DB store), `service.js` (start/limits/cool-offs), `shots.js` (screenshots), `run-model.js` (statuses). UI: `PostingEngine.js` in the Publish panel. API: `posting-runs` routes.

**Trigger.** Recruiter → Publish → Indeed/Rozee.pk → **Practice (no account)**, **Rehearse (posts nothing)** or **Post with the engine**.

**Flow.**

```mermaid
sequenceDiagram
  autonumber
  actor R as Recruiter
  participant W as Web app
  participant D as Postgres posting_runs
  participant E as Posting engine (local)
  participant B as Visible browser window
  participant P as Platform or practice site
  R->>W: POST posting-runs {platform, mode}
  W->>W: startPostingRun: checks, cool-off, posting limits (post mode)
  W->>D: insert queued run with kit (job text, no credentials)
  W-->>R: run id (panel polls every 1.5 s)
  E->>D: claimNext (compare-and-set to running)
  E->>B: launchPersistentContext (own profile per person and platform; Indeed: per account)
  E->>B: runPosting(flow, kit, human typing)
  B->>P: step by step: type, choose, read back
  alt check, sign-in, field problem, unknown page, confirm, sponsor, account paused
    E->>D: status needs_you or awaiting_confirm, gate {kind,message}
    R->>B: person acts in the window
    B-->>E: page moves on, engine resumes
  end
  E->>D: finishRun(published, rehearsed, failed, cancelled) and outcome
  E->>W: onRunFinished: job_publications mode engine, jobs columns
```

**Rules that make it safe.**
* **Modes:** `rehearsal` fills everything and stops before the final confirm; `post` waits for the *person* to press the platform's own final button; `practice` runs entirely against a stand-in site (no account, no network — all other addresses are refused).
* **Gates** (`GATE`): `check` (bot/verification — the engine never clicks it), `sign_in` (engine never types a password or code), `field` (could not set or read back), `page` (unknown page), `confirm`, `sponsor` (engine only answers "No thanks", never chooses a paid plan), `account` (platform paused the account → run ends `account_paused`).
* **Never pressed (Rozee.pk):** Publish Job, Apply Credit, Post with free Featured Job credit, Upgrade to Top Job; the dialog that opens on the draft is answered "Keep as draft".
* **Read-back verification:** each field ends `verified | unverified | skipped`; the panel shows them as chips with a screenshot per step (the signed-in account's name blacked out; screenshots served only to the starter or an admin; newest 15 runs kept).
* **Job location type** is the engine's to set (found by its label, set to the job's own type); if Indeed's page will not take it, the form is left as Indeed has it, the step says so, and the run carries on: the engine never stops to ask for it (owner decision, 2026-10-08).
* **Human-like input** (`human.js`): uneven key gaps, longer after words/punctuation, occasional slips on short boxes that it corrects, a 75-second budget for long text, mouse along a curve; `POSTER_TYPING_SPEED` natural|fast|off. Owner decision 2026-10-07: human-like behaviour and stealth are allowed; order of preference: (1) visible window with a person, (2) human-like input, (3) stealth. The one stealth measure in use, on by default, is hiding Chrome's own automation flag (`--enable-automation` dropped, `navigator.webdriver` false; `POSTER_STEALTH=false` turns it off): measured on 2026-10-08, Cloudflare challenge pages stayed on "Just a moment..." with the flag and passed on their own without it. A check is watched 8 s before a person is asked (most pass by themselves), and one that comes back after being completed three times ends the run as `check_loop`.
* **Cool-offs:** after `account_paused` the engine leaves **that account** alone for **24 h** (a new account is not held back by another account's pause) (`POSTER_PAUSED_COOLOFF_HOURS`), after `blocked` or `check_loop` for **30 min** (HTTP 429 to the panel). Posting limits count only `post` runs.
* **Liveness:** heartbeat every 10 s; `reapStale` ends a live run silent for 60 s as `failed` ("engine_stopped… check the platform's jobs list") and drops a queued run nobody claimed after 30 min; a closed window, Stop, or nobody returning for 10 minutes ends the run; `cancelRequested` is polled every 2 s.
* **Uniqueness:** one live run per (job, platform) via a partial unique index.

**Edge cases.** Two engines → the second refuses to start (port 8095 in use); an older engine that doesn't know `practice` is detected through `/health` (`modes`, `platforms`) so a practice run isn't mistaken for a real post; Google refuses sign-in inside an automated window → use the platform's emailed code; city list doesn't load → the city is left to the person; pay in another currency than rupees → not typed into Rozee's rupee budget.

**What is verified and what is not (state it exactly).** *Verified:* the engine, runner and flows against **practice sites** in a real Chromium (rehearsal, post, check, sign-in, refusals, go-back, stop, closed window, timeout, paused account, block page, typing) — `poster-core`, `poster-runner`, `poster-rozee` tests; the DB path with the real engine process. *Not verified on the real platforms:* Indeed's location suggestions, custom drop-downs, rich-text description, review read-back, the sponsor confirmation, whether the check returns later; the Rozee.pk wizard under automation. *Observed live:* the first Indeed window reached sign-in without a check; a later window was refused by a block page; the owner's test employer account was **paused** (cause unknown; could be the automation, the nonsense test job, or the account's own details). A throw-away Rozee.pk draft ("Test Engineer", id 159237) was created while mapping and must be deleted by the owner.

**Security.** The engine acts only on the signed-in account of the person in front of the window; the kit contains job text only; no credential ever enters Raasta-AI for these platforms; the browser profile lives in `.runtime/poster-profiles/<user>/<platform>` (Indeed: `indeed-<account id>`, git-ignored). **Only the Indeed account that is switched on** under Platforms is used: with none switched on, Rehearse and Post are refused; a switched-off account is never picked, even one the job was posted with before.

**Design decision.** A *supervised* visible engine instead of a headless bot or a sanctioned API: the APIs need partner approval (§5e table: Indeed career-site aggregation, XML feed, Job Sync API; Rozee.pk: none published). *Limit:* it must run on the recruiter's own machine, so it cannot be part of a server deployment without moving the run store behind an API.

**30 seconds.** "A small program opens a real browser window on the recruiter's computer, types the post into the platform's form like a person, checks every field by reading it back, and stops for the human at every sign-in, verification, unknown page and the final button. We built it after our measurements showed hidden bots get blocked; we verified it against practice sites and the live runs showed Indeed's strictness."

---

## H6 · Assisted posting with the browser extension

**Purpose.** The route that needs no automation at all: show the job's fields beside the platform's own form in the recruiter's normal browser.

**Components.** `extensions/raasta-poster/` (Manifest V3, permission `storage` only): `bridge.js` (runs on `http://localhost:8085`/`127.0.0.1:8085`), `panel.js` + `lib/fill.js` + `lib/kit.js` (run on `employers.indeed.com`, `hiring.rozee.pk`, `www.rozee.pk`, `www.rozeegpt.ai`); page side `libs/poster-bridge.js`; kit builder `libs/hiring/posting-kit.js`.

**Flow.** (1) *Publish › Copy and open* calls `publish` in hand-off mode → server returns `{text, handoffUrl, kit}`; (2) `libs/poster-bridge.js` sends the kit to the extension with `window.postMessage` (same window and origin, `ns: "raasta-poster"`), then opens the platform; without the extension the page falls back to clipboard + open; (3) on the platform's page the panel offers **Copy** per field, **Fill the form** (matches boxes by visible names; ticks the job-type chip; never clicks Continue/Post, never overwrites typed text, never touches password fields), **Copy page report** (every visible box with names, a selector hint, whether it has text — never the text — passwords/links/query parts excluded) and **I posted it**; (4) **I posted it** stores a confirmation in the extension; the Publish panel picks it up on open/focus and calls `publish/confirm`.

**Kit contents.** Fields in the order the form asks: title (Indeed: `indeedTitle` removes bracketed asides, symbols and emojis, ≤ 60 chars; the original is kept as "Title as written"), location, workplace type, job type, experience, pay (+ min/max/currency), skills, the saved description, apply link; empty fields omitted; values ≤ 8,000 chars; **expires after 2 hours** (the extension caps lifetime at 4 h).

**Security (verified claims).** No network requests; reads only Raasta-AI's own address and the listed platform pages; writes kit text with `textContent` (never HTML); `kit.js` copies only known properties, checks platform and dates, drops links to other hosts; no credentials or cookies cross either way.

**Verified.** Tested end to end with the real extension in Chromium against stand-in pages; verified on the real Indeed Post-a-job flow with a signed-in account on 2026-10-06 for steps 1–2 (title, location, job type); the description step "not yet verified on the real editor". **Product caveats the panel shows:** Indeed's default **Application method is Email** (applicants would bypass Raasta-AI's apply form and therefore screening; the panel tells the person to route applicants to the Apply link) and the **Sponsor** step pre-selects a paid plan ("No thanks" posts for free); a post Indeed keeps as *Pending* is "submitted", not yet live.

**Design decision.** Extension over screen-scraping or credentials: nothing sensitive is handled. *Limits:* manual install ("Load unpacked"), expects `localhost:8085`, Fill is name-pattern based and may miss boxes (hence *Copy page report* to tune `NAMES`).

**30 seconds.** "The extension puts the job's fields next to Indeed's or Rozee.pk's own form in the recruiter's logged-in browser, can fill them, and the recruiter presses the platform's Post button. It never clicks, never sees passwords, and tells Raasta-AI when the recruiter says they posted."

---

## Supporting: connecting the Indeed account and diagnostics

* **Connect (`libs/indeed-connect.js`, `/api/indeed/connect`).** Start/poll/cancel a **real Chromium window** where the person signs in; only the resulting session is stored (`indeed_accounts`); one window per person; waits `INDEED_CONNECT_WAIT_MINUTES` (default 5, max 30); returns 501 on a server without a screen (`INDEED_CONNECT_WINDOW=off`). Reconnecting the same email refreshes the row in place. Only the person who connected an account (or an admin) can switch off/test/remove it.
* **Diagnose (`libs/indeed-diagnose.js`, `libs/indeed-debug.js`, `POST /api/indeed/accounts/debug`).** A read-only visit that follows "Post a job" and records each page: screenshot + page structure (headings, buttons, links, fields, each with a stable selector hint) + `trace.json` (console/page errors, failed requests); never records field values, cookies, storage or URL query strings; one run per account at a time and a 60 s gap; newest 20 runs kept in `debug-indeed/`. With "show the window" it waits up to `INDEED_CHECK_WAIT_SECONDS` (180) for the person to clear a check and then carries on (it only watches; it never clicks the check). **A correction recorded in the docs:** an early write-up concluded a check can never complete under automation; that was unsupported (the detector read only the page title and moved on within seconds), and the detection was fixed (`pageShowsCheck`, `waitForCheckToClear` with several consecutive clear polls).
