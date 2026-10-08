# Part 8B · Known Weaknesses, Live Demo Plan and One-Page Cheat Sheet

[← Index](README.md) · Previous: [Part 8A · Panel questions](08a-panel-questions.md) · Next: [Part 9 · Future work](09-future-work.md)

> **Principle.** A panel forgives a weakness that you found, understood and ranked. It does not forgive one you hid or did not know about. Every row below was found by reading the code or running the system; for each there is an **honest sentence** you can say, the **fix**, and where the evidence is.

## Contents

* [8B.1 Known weaknesses, with honest framing and fix](#8b1-known-weaknesses-with-honest-framing-and-fix)
* [8B.2 Live demo script with a backup plan](#8b2-live-demo-script-with-a-backup-plan)
* [8B.3 One-page cheat sheet](#8b3-one-page-cheat-sheet)

---

## 8B.1 Known weaknesses, with honest framing and fix

Priority: **P1** fix before showing it to anyone outside the team; **P2** fix before a real pilot; **P3** improvement. Effort is the author's estimate.

### Security and privacy

| # | Weakness | Evidence | Say this | Fix (effort) | P |
|---|---|---|---|---|---|
| W1 | Nine API handlers have no login check (message edit with mass assignment, message generation, campaign lead listing, paid scraper, two invite routes, three DB dev tools) | [6.2.7](06-cross-cutting.md#627-security-findings-register-ranked) SEC-01…05 | "Our own audit of 167 endpoints found them; they are in the older sales half and developer utilities, none touches hiring data, and each fix is a few lines." | `withAuth` + owner filter; delete or gate dev routes; add a test that every route is protected or allow-listed (2–3 h) | P1 |
| W2 | Cron endpoint accepts a published default secret when `CRON_SECRET` is unset | `check-schedule/route.js:23` | "A deployment would have to set it; we should refuse to run without it." | fail closed (15 min) | P1 |
| W3 | No rate limiting or CAPTCHA on register, sign-in, apply | [6.2.4](06-cross-cutting.md#624-rate-limiting-and-abuse-control-consolidated) | "Spam applications cost model calls; the Redis limiter already exists." | apply `rateLimit()` per IP (3–4 h) | P1 |
| W4 | No HTTP security headers (CSP, HSTS, frame options) | `next.config.js` | "Not configured yet." | `headers()` in config (1 h) | P2 |
| W5 | Platform session cookies stored unencrypted; one document wrongly says encrypted | `libs/schema.ts`, `LINKEDIN_INTEGRATION.md` | "A database leak would expose sessions; we found the document is wrong and will correct it." | AES-GCM column encryption, fix document (3 h) | P2 |
| W6 | No retention or purge; deleting a candidate leaves files; no candidate data-rights path; no legal review | [6.3](06-cross-cutting.md#63-privacy-and-data-protection) | "Consent and minimisation are built; retention and data rights are the work before a pilot." | purge job, delete-by-prefix, admin export/delete (1–2 days) | P2 |
| W7 | PDF/DOCX parsers receive untrusted bytes with no content check, sandbox or timeout | SEC-12 | "A bad file could stall one request." | magic-byte check; parse in worker with timeout (half a day) | P2 |
| W8 | Account enumeration at register ("User already exists"); no email verification; no password reset by email; no MFA | `auth/register/route.js` | "Basic authentication is in place; hardening is future work." | generic message, verification email, reset flow (1–2 days) | P3 |

### AI validity and fairness

| # | Weakness | Evidence | Say this | Fix (effort) | P |
|---|---|---|---|---|---|
| W9 | No accuracy evaluation of any AI judgement | [5.6](05-ai-components.md#56-how-quality-was-measured-and-how-it-should-be) | "We verified the pipeline and logic, not agreement with human raters; here is the protocol." | run the 30–50 CV ranking study and 100-answer grading (2–4 days) | P1 |
| W10 | Raw CV text sent for scoring still contains name and contact details | [5.5](05-ai-components.md#55-fairness-explainability-and-human-oversight) | "De-identification is partial: structured fields are stripped, raw text is not." | remove name/contact from raw text; run the counterfactual test (1 day) | P1 |
| W11 | No accent or camera-robustness test; English-only | 5.4, 5.5 | "We designed for fairness but have not measured it." | WER by accent; same session under varied lighting (1–2 days) | P2 |
| W12 | Fit rubric weights live only in the prompt | `FIT_SYSTEM` | "The model sees the weights; the arithmetic is not ours." | ask for four sub-scores and compute the sum in code (half a day) | P3 |
| W13 | Prompt-injection not tested | 5.4 | "Mitigated by design, no adversarial test set yet." | build 20 injection CVs/answers (1 day) | P3 |
| W14 | Ideal answers are model-written; a wrong one mis-scores everyone | 5.3.1 | "That is why the recruiter edits the bank." | add a recruiter review step before first use; sample audit (half a day) | P2 |
| W15 | Cost unknown: token usage is not logged | `libs/ai/llm.js` | "We know the call ceilings, not the money." | log `usage` per call; run 10 interviews (1 h + run) | P2 |

### Engineering and operations

| # | Weakness | Evidence | Say this | Fix (effort) | P |
|---|---|---|---|---|---|
| W16 | No CI; Compose/nginx deployment specified but not built; not deployed anywhere | [6.8](06-cross-cutting.md#68-deployment-pipeline) | "Quality gates are manual commands; Phase 9 is the planned fix." | GitHub Actions + Compose (1–2 days) | P2 |
| W17 | Never load-tested; engine is a single in-memory process capped at 20 sessions | [6.5](06-cross-cutting.md#65-performance-and-scalability) | "We know where it breaks first, we have not pushed it." | 3-interview scripted load test, then 20 (1 day) | P2 |
| W18 | 134 changed or new paths are uncommitted | `git status` | "Commit before the viva." | commit in logical pieces (30 min) | P1 |
| W19 | Migration history cannot rebuild the schema alone (five tables have no `CREATE TABLE`; journal out of sync; two schema files) | [00 §7](00-inventory.md#7-database-entities-22-tables) | "A fresh database uses `db:push`; the SQL files are additive." | export a baseline migration; drop `schema.js` duplication (1 day) | P3 |
| W20 | Not tested: UI components, route layer, sales module, live platforms | [6.7.4](06-cross-cutting.md#674-what-is-not-tested-say-this-before-the-panel-asks) | "The deciding logic is tested; the glue and UI are tested by hand." | route-level tests, a few Playwright flows (2 days) | P2 |
| W21 | Logging is plain text/JSON without aggregation, metrics, alerts or request ids | [6.6](06-cross-cutting.md#66-logging-monitoring-and-observability) | "Self-diagnosing Setup guide instead of an observability stack." | Sentry, request ids (1 day) | P3 |

### Product and process

| # | Weakness | Evidence | Say this | Fix (effort) | P |
|---|---|---|---|---|---|
| W22 | Platform automation violates platform terms; Indeed paused the test account; Rozee.pk wizard not verified live | [6.4](06-cross-cutting.md#64-third-party-platform-automation-legal-and-ethical-position) | "A known, owner-accepted risk with manual and assisted routes as fallbacks." | official partner APIs for production | P2 |
| W23 | Sales module is older, untested, has a retired default model name, an unauthenticated internal-call design, and a probable defect in bulk generation (insert may omit a required `userId`, to verify) | [4E](04e-functionality-client-acquisition.md) | "It works as a demo path; it needs the same hardening as hiring." | model default, auth, tests (2–3 days) | P2 |
| W24 | Template leftovers: package name `ship-fast-code`, boilerplate README, inert Stripe handlers, `lead` route discards emails, "forgot password" has no flow | [00 §5.6](00-inventory.md#56-identity-operations-billing-utilities) | "Inherited from the starter template and not part of the thesis." | clean up or remove (half a day) | P3 |
| W25 | The report still describes spaCy and an old worker | `docs/ai-hiring/18` | "The report update list exists." | edit the Overleaf report | P1 |
| W26 | No supervisor-meeting record, SRS or sprint board in the repository; 4.5-month commit gap | [2E §E.7](02e-development-process.md#e7-supervisor-review-checkpoints) | "Process evidence is outside git; here it is." | assemble dates and minutes | P1 |
| W27 | Authorship and licence of the earlier prototype not documented | [7.3.8](07-implementation-journey.md#738-provenance-what-the-panel-can-and-cannot-see) | "[Team states it.]" | one agreed sentence | P1 |
| W28 | Desktop-only interview; no OCR for scanned CVs; one language | [1.3.3](01-big-picture.md#13-what-multi-platform-actually-means-here) | "Scope choices, listed." | – | P3 |

---

## 8B.2 Live demo script with a backup plan

**Goal.** In about 15 minutes show the whole hiring loop on real screens, then take questions. Rehearse it twice on the demo machine. Never demonstrate a live LinkedIn, Rozee.pk or Indeed action (the Indeed test account is paused); use the practice site or recorded evidence.

### Before the day (checklist)

| # | Task | How to check |
|---|---|---|
| 1 | Commit everything (W18); tag the commit you demo | `git status` clean |
| 2 | Run the full test suites once | `npm run test:hiring` (92 s), `pytest` in `services/ai-engine` (70 s) |
| 3 | Build the fast server once so the first run is not slow | `npm run serve` (first build 2–3 min) |
| 4 | Install ffmpeg and confirm it | `ffmpeg -version` in the same terminal that starts the app |
| 5 | Camera-tracking files present | `npm run sync:mediapipe` once |
| 6 | Create a demo recruiter account; choose recruiter mode | `/signup`, `/onboarding` |
| 7 | Create the job from `tests/fixtures/jobs/devops-engineer.json` values; set `minFitScore` 70, `maxShortlist` 3, auto-invite on, auto-finalize off; for a short interview set `questionCount` 3 and `interviewMaxMinutes` 8 | job settings card |
| 8 | Apply the 10 fixture résumés (`tests/fixtures/resumes/`) through the public form, **except one strong CV that you will submit live** (there is no seed script [GAP]) | candidates page |
| 9 | Complete one full interview and analysis **and keep it** as the backup | Interviews page shows "Interviewed" |
| 10 | Record a screen video of the whole run (Plan C) | file on the desktop |
| 11 | Plan the second screen or laptop for the candidate, **with headphones** (speakers cause echo) | test mic and sound |
| 12 | Use Chrome or Edge on desktop; pre-allow microphone and camera for the site | browser settings |
| 13 | Check keys by length only, never print values | `GROQ_API_KEY` set; `DEEPGRAM_API_KEY` optional |
| 14 | Close heavy apps; exclude the project folder from antivirus scanning if possible | see `docs/ai-hiring/21` §4 |

### Demo flow (about 15 minutes)

| Min | Scene | What you do | What you say (one sentence) | Expect | If it fails |
|---|---|---|---|---|---|
| 0:00 | **1 · Everything is running** | Open **Recruiter → Setup guide** | "Four programs cooperate: web app with worker, interview engine, AI engine; the guide shows and controls them." | all green | Press Start on the red one; if still red go to Plan B/C |
| 1:00 | **2 · Job and post** | Open the job; show the **Hiring automation** card; open **Publish**; show the LinkedIn, Rozee.pk and Indeed texts | "One job, a different post per platform, and automation limits per job." | per-platform text | Skip publish; show copy text only |
| 2:30 | **3 · A candidate applies** | In a private window open `/apply/<jobId>`; submit the held-back strong CV | "Public form, no account; the file is stored and parsed, screening runs in the background." | success message | Use the Plan B pre-applied candidate |
| 4:00 | **4 · Screening and shortlist** | Candidates page: fit badges, matched/missing skills, rationale; the unreadable CV; the shortlist of 3 | "The model scores and explains; a rule shortlists by threshold and cap; the recruiter can override." | scores appear within a minute | If scoring stalls, explain the fallback and show pre-screened candidates |
| 6:00 | **5 · Question bank** | **Interview questions** page; open one question's ideal answer and keywords; edit a word | "Generated per job, editable, frozen per interview." | 3–8 questions | – |
| 7:00 | **6 · The invitation** | Open the newest file in `.storage/outbox` in a browser; point at expiry and the single-use link | "A 256-bit link whose hash we store." | styled email | Click **Resend invite** and re-open |
| 8:00 | **7 · The interview** | On the candidate screen: open link → consent → device check → greeting → answer 2–3 questions; on the recruiter screen keep the **Live** tab open | "Streaming speech, an adaptive loop, scored in the background, never shown to the candidate." | captions, voice, live scores on recruiter side | Plan B: run `npx tsx scripts/interview-test-client.js <token>` (scripted candidate) |
| 12:00 | **8 · The result** | Wait about a minute for analysis; open **Summary**, **Q&A**, **Transcript** (click a time to jump in the recording), **Communication**, **Integrity**, **Behaviour** | "Final score is a formula over resume, interview and delivery; every number shows its source." | final score, breakdown, summary | Open the Plan B completed interview instead |
| 14:00 | **9 · The decision** | **Decisions** page: accept the suggestion, mark hired | "The recruiter decides; adverse actions always wait for a person." | status changes | – |
| 14:45 | **10 · The agent (optional)** | **Agent** page: Preview Assisted versus Autopilot | "Rules, not free-roaming AI: do, ask, or leave to a human." | counts by route | skip |
| 15:30 | Questions | Keep the cheat sheet open | | | |

**Short version (8 minutes):** scenes 1, 4, 7 (one question only), 8, 9.

### Failure matrix

| Failure | How you notice | Quick fix | Fallback you can say |
|---|---|---|---|
| Language-model provider down or slow | screening stalls; follow-ups are generic | wait; show queue card | "This is the designed fallback: keyword score, canned follow-up. Here are already-screened candidates." |
| Worker not running | candidates stay "New"; Setup guide shows it | **Start** in Setup guide, or `npm run worker:hiring` | – |
| Interview engine not running | room says it cannot connect | Start it in Setup guide (`npm run engine:start`) | Plan B scripted client or the saved interview |
| Microphone, camera or permission trouble | no captions, no level meter | Chrome/Edge desktop; re-allow in site settings | Plan B |
| Echo or feedback | the interviewer repeats itself | **headphones** | – |
| No Deepgram key or quota | captions missing | none needed | "Whisper fallback: no live captions, same scoring." |
| Voice model unavailable | robotic browser voice | none | "Designed fallback to the browser voice." |
| `ffmpeg` missing | Recording tab says parts could not be joined | install; **Re-analyse** | open the saved interview |
| Email not delivered | no email | open `.storage/outbox` | – |
| Port 8085 busy or slow first load | blank page | stop `npm run dev`; use `npm run serve` | Plan C |
| Anything with a live platform | never demo | – | practice site or Plan C |

**Plan B** = the pre-completed interview and the scripted interview client. **Plan C** = the recorded screen video. **Plan D** = the one-page supervisor brief (https://claude.ai/artifact/BZJANV9uu6nTQTBqe2fxF6) and this cheat sheet, talking through the diagrams.

---

## 8B.3 One-page cheat sheet

**What it is.** Raasta-AI: a Next.js 14 web app + Postgres + Redis, with a Node worker, a Node WebSocket interview engine, a Python AI engine and an optional posting engine. Two modules: **AI hiring pipeline** (deep, tested) and **client acquisition** (older, lighter).

**The pipeline in ten words.** Post → apply → parse → score → shortlist → invite → interview → analyse → score → decide.

**Numbers to know.** 20 modules · 22 tables · 167 API handlers (149 with auth, 18 without: 9 intended, 9 defects) · 436 JS + 37 Python tests pass · 121 commits (99 / 22 / 1) · 134 uncommitted paths · phases 0–8 done, 9 not · 51 s → 2.5 s first-visit time with `npm run serve`.

**Defaults to quote.** `minFitScore` 70 · `maxShortlist` 20 · invite expiry 72 h · reminder after 24 h · 8 questions · 2 follow-ups max · interview 25 min · reconnect window 15 min · engine cap 20 sessions · silence 8 s · resume ≤ 5 MB · upload part ≤ 10 MB · final weights 0.3 / 0.5 / 0.2 · final threshold 70 · auto-finalize off.

**Formulas.** Fit rubric (in the prompt): skills 45, experience 30, projects 15, education 10. Communication = 0.30 pace + 0.30 fluency + 0.25 eye contact + 0.15 composure (pace full marks at 110–160 wpm). Final = 0.3 fit + 0.5 interview + 0.2 communication, missing parts re-weighted. Fallback answer score = 0.7 × keyword coverage + 0.3 × length.

**Tokens and security in one breath.** Staff: NextAuth JWT, bcrypt-12, role re-read per request, owner filter on every hiring query. Candidate: 256-bit link stored as SHA-256, 10-minute HS256 ticket, rate limits, signed 5–15 minute file links. Services: bearer tokens, HMAC signatures.

**Why these designs.** Model judges, code decides · queue every slow job · capability links not accounts · lock before await in the live loop · every dependency has a fallback · human approval for adverse actions.

**Ten honest gaps.** (1) AI accuracy and fairness not measured · (2) nine open sales/dev routes · (3) no rate limit on public forms · (4) no retention or data-rights path · (5) platform cookies unencrypted · (6) no CI, not deployed, never load-tested · (7) UI/route/sales untested · (8) Indeed account paused, platform automation against terms · (9) 134 paths uncommitted, commit gap unexplained · (10) authorship of the earlier prototype to be stated.

**One-liners.**
* "We trained no model; we built the system that makes models safe to use."
* "The LLM never decides who is rejected."
* "We know where it breaks first."
* "Everything that touches a candidate's data is hashed, signed, or expiring."
* "The interview rules were inherited; the code was written anew, and we measured that."

**Who covers what (fill in).** Hiring pipeline: ______ · Interview engine: ______ · Sales module: ______ · Platform automation: ______ · Security/privacy: ______ · AI evaluation: ______ · Demo operator: ______
