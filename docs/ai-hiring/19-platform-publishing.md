# 19. Publishing a job to LinkedIn, Rozee.pk and Indeed

How a job gets from Raasta-AI onto the platforms, what each post looks like, which rules protect the connected accounts, how to connect and debug Indeed, and a review of how the platform connection works today.

## 1. The flow

```
Job  ->  one post per platform (written to that platform's format)
     ->  Publish panel (Recruiter > Jobs > Publish)
            |-- Post to all connected          (one request, each platform stands alone)
            |-- Post to LinkedIn / Rozee.pk / Indeed   (one platform)
            |-- Copy and open <platform>       (hand-off: you press Post yourself)
            |-- Post with the posting engine   (Indeed: a window you watch fills the form in; you press Confirm, section 5f)
     ->  job_publications row per attempt  ->  chips on the job card, state in the panel
```

- The job goes live on Raasta-AI (status `published`) as soon as **any** platform post succeeds or is confirmed, because candidates apply through Raasta-AI.
- Every attempt is a row in `job_publications` (migration `0012`). It is the audit trail, the limit counter and the "one at a time" guard.
- Code: `libs/hiring/platform-content.js` (what to write), `libs/hiring/publishing.js` (how to publish), UI `app/dashboard/recruiter/components/PublishPanel.js`.

## 2. One post per platform

`PLATFORM_SPECS` holds the rules; `finalizePost()` enforces them on whatever the model returns, so a bad answer cannot reach a platform.

| | LinkedIn | Rozee.pk | Indeed |
|---|---|---|---|
| Shape | Feed post: a hook in the first two lines (the part before "see more"), short paragraphs or dash lines | Job ad with plain sections: About the role, Responsibilities, Requirements, What we offer, How to apply | Job description: the first two sentences name the job title, location and employment type (search results show them), then the same plain sections as Rozee.pk |
| Length | 130-220 words, 3000 characters at most | 180-350 words, 4000 characters at most | 180-380 words, 4000 characters at most |
| Emojis | Up to three | None (removed if the model adds them) | None (removed) |
| Hashtags | 3-5 on the last line (extras removed) | None (removed) | None (removed) |
| Apply link | Added before the hashtags if the model forgot it | Added under "How to apply" if missing | Added under "How to apply" if missing |
| Markdown | Stripped (no platform renders it) | Stripped | Stripped |
| Saved in | `jobs.linkedin_post` | `jobs.rozee_post` | `jobs.indeed_post` |

The apply link is built on the server (`jobApplyUrl`) and never taken from the browser. The prompt forbids inventing a company, salary, perks or a pay period. If the model returns (almost) nothing, it is asked once more, and then the request fails with a clear message. A post that is only the apply link is never saved.

Generate with `POST /api/hiring/jobs/[jobId]/generate-post { platform: "linkedin" | "rozee" | "indeed" | "all", tone? }`. Edits are saved with `PATCH /api/hiring/jobs/[jobId]` (`linkedinPost`, `rozeePost`, `indeedPost`).

## 3. Publishing rules

**Auto** (through the connected account) and **hand-off** (copy the text, open the platform's own composer, press Post yourself) both start from a person clicking a button. The agent uses the same publisher with stricter rules.

| Rule | Value | Why |
|---|---|---|
| Automatic posts per account | LinkedIn 3, Rozee.pk 5, Indeed 3 in any 24 hours | A person posts a few jobs a day, not dozens |
| Gap between automatic posts | LinkedIn 10 min, Rozee.pk 5 min, Indeed 10 min | No bursts |
| Brake after a failed attempt | 2 min | A double click must not hammer a platform |
| One attempt at a time per job and platform | Partial unique index on `job_publications` | No duplicate public posts |
| Sign-in or security check | The attempt stops, is recorded as `needs_login`, nothing is retried | A person has to confirm it, never a script |
| Agent after a sign-in check | Leaves that account alone for 12 hours | Unattended runs must not keep trying |
| Hand-off | Never limited, never touches the platform from the server | It is the person posting |

Limits can be changed per platform with `PUBLISH_DAILY_CAP_<PLATFORM>` and `PUBLISH_MIN_GAP_MINUTES_<PLATFORM>`, where `<PLATFORM>` is `LINKEDIN`, `ROZEE` or `INDEED`.

Accounts are shared by operators (admins, sales operators and recruiters see every connected account on the Platforms page), so the panel offers an account picker when there is more than one. Without a choice the job owner's own active account is used, then the team's only active account.

## 4. API

| Route | Purpose |
|---|---|
| `GET /api/hiring/jobs/[jobId]/platforms` | Per platform: connection, saved post, last result, limits, hand-off link. Optional `?linkedin=<accountId>&rozee=<accountId>&indeed=<accountId>` |
| `POST /api/hiring/jobs/[jobId]/publish` | `{ platforms: "all" or [..], mode: "auto" or "handoff", accountIds? }` returns one result per platform |
| `POST /api/hiring/jobs/[jobId]/publish/confirm` | `{ platform, postUrl? }` after posting by hand; the link must be https on the platform's own domain |
| `POST /api/rozee/jobs/[jobId]/publish` | Older route, now a thin wrapper over the same publisher |
| `POST/GET /api/hiring/jobs/[jobId]/posting-runs` | Start a posting-engine run `{ platform: "indeed", mode: "rehearsal" or "post", options?: { openings } }`, or list the job's recent runs (section 5f) |
| `GET /api/hiring/posting-runs/[runId]`, `POST .../cancel`, `GET .../shots/[name]` | One run, stop it, a step's screenshot (only for the person who started it, or an admin) |

## 5. Review of the platform connection and posting

### How it works today

1. **Connect:** the recruiter types the platform email and password into Raasta-AI. The server opens headless Chromium, signs in (with `slowMo` and random pauses), and stores the cookies, `localStorage` and `sessionStorage` as JSON in `linkedin_accounts` / `rozee_accounts`.
2. **Post:** the server starts Chromium again, replays that session, opens the composer or form, types the text and clicks Post.

### Findings

| # | Finding | Impact |
|---|---|---|
| 1 | The password passes through Raasta-AI's server | Anyone who can read server logs or memory can see it; users must trust the app with a credential the platform wants kept private |
| 2 | Session JSON is stored unencrypted in Postgres | Database access means access to every connected account |
| 3 | A session captured in one place and replayed from a server (different network, headless, no history) | This mismatch is what platforms flag, whatever the delays are; delays and mouse movement do not fix it |
| 4 | Operators share all connected accounts | Any recruiter or sales operator can act as any connected account |
| 5 | Page scripts depend on selectors; the Rozee post-a-job selectors are marked TODO and success is "the URL contains /job/" | A redesign breaks posting silently, or reports success wrongly |
| 6 | There were no limits on posting (only on invites and messages) | A loop or a double click could post repeatedly |
| 7 | The Rozee scrapers send a fixed macOS Chrome 124 user agent from a different operating system | A mismatch like this is itself a bot signal, and it is stale. Left as it is: it is in the scraping code, outside this change |
| 8 | A sign-in or security check was reported as a generic failure and could be retried | Repeated attempts after a challenge are what get accounts restricted |

### What changed

- Limits, gaps, retry brake and the one-at-a-time guard (section 3); every attempt recorded.
- A sign-in or security check stops the attempt with a clear status (`needs_login`) and tells the person to confirm it on the platform and reconnect. The agent also backs off for 12 hours.
- Hand-off mode, so a recruiter can always post as themselves in two clicks, without any automation.
- Per-platform posts (section 2), so what is posted fits the platform.
- Every automatic post asks for a confirmation that names the account and says it is public.

### What was deliberately not done, and the owner's decision (2026-10-07)

When the posting code was first written it held back from stealth plugins, fingerprint or user-agent spoofing, proxy rotation and randomised human-like behaviour, because both platforms forbid automation in their terms and detection evasion turns a small risk (a challenge screen) into a large one (a restricted or banned account that the whole team relies on). That was a design default, not a project rule.

**Decision (project owner, 2026-10-07): human-like behaviour and stealth measures are allowed in this project.** The risk is unchanged and is the owner's to accept: an automated session on LinkedIn, Rozee.pk or Indeed can still end in a restricted or banned account, so automation should run on an account that can be lost. The order of preference stays, because each step is cheaper and less fragile than the next:

1. a visible browser window with a person present for every check, sign-in and decision (this alone passed Indeed's Cloudflare check, section 5c);
2. input that behaves like typing (real key presses, natural pacing and pauses);
3. stealth measures, only if 1 and 2 get challenged again.

Unchanged: when a platform challenges the account, the engine hands over to a person instead of retrying, and the per-account limits (section 3) stay.

### Recommended next steps

1. **LinkedIn posts through the official API.** The "Share on LinkedIn" product (OAuth, scope `w_member_social`, Posts API) is the sanctioned way to post as a member and needs no browser. Posting a real LinkedIn *job* needs the Jobs API, which LinkedIn grants to approved partners; check the current LinkedIn developer documentation before building on it.
2. **Rozee.pk:** ask Rozee whether an employer API or bulk-posting feed exists. Until then, hand-off is the reliable path.
2b. **Indeed:** the sanctioned routes are Indeed's partner integrations (an approved ATS or job-feed partner, via Indeed's employer/partner programs); check Indeed's current developer documentation, since access is by approval. Until then Copy and open is the path.
3. **Connect without giving Raasta-AI the password:** OAuth where it exists, or a sign-in the person does themselves in a visible browser window, so only the resulting session is kept.
4. **Encrypt session JSON at rest** (AES-GCM, key from the environment).
5. **Scope accounts per person** or add an explicit "share with team" switch.

## 5b. Indeed

**Connecting.** Indeed signs people in with an emailed code, Google or Apple (often behind a verification check), so there is no email-and-password form to automate and none is offered. Platforms, Indeed, "Add Indeed Account" opens a real Chromium window on Indeed's sign-in page. The person signs in there; when the employer area is reached, only the signed-in session is stored (`indeed_accounts`). No Indeed password or code passes through Raasta-AI. Code: `libs/indeed-connect.js`, `POST/GET/DELETE /api/indeed/connect` (start, poll, cancel), panel `app/dashboard/accounts/components/IndeedAccountsPanel.js`.

- The window opens on the machine that runs the server, so this works when Raasta-AI runs on the person's own computer. On a server without a screen the request answers 501 and says to use Copy and open. `INDEED_CONNECT_WINDOW=off` forces that.
- One window per person at a time; it waits `INDEED_CONNECT_WAIT_MINUTES` (default 5) and can be cancelled from the page.
- Connecting the same Indeed email again refreshes that account in place, so jobs that point at it keep working. The account list is shared by operators like the others, but only the person who connected an account (or an admin) can switch it off, test it or remove it.
- Posting needs an Indeed **employer** account with the company set up (employers.indeed.com).

**Posting.** The same publisher, limits, history and hand-off as the other platforms (`libs/hiring/publishing.js`; adapter `libs/platforms/indeed.js`; session check `libs/indeed-session-validator.js`; form filler `libs/indeed-job-publisher.js`). A verification page or a sign-in page stops the attempt as `needs_login` and nothing is retried. The Sales lead scraper's Indeed search is unchanged and still needs no account: the adapter's `accountsTable` stays `null` on purpose (a non-null table makes the scraper demand a connected account).

**Indeed is not posted in the background. It is posted with the posting engine (section 5f) or with Copy and open.** Indeed's employer area sits behind Cloudflare's bot check: a hidden automated browser is blocked (HTTP 403), but a visible window with a person present passed the check (section 5c). So `autoPostAvailability("indeed")` is `{ available: false }` unless `INDEED_AUTO_POST=true`, and nothing is built behind that flag (`libs/indeed-job-publisher.js` answers `ui_changed`). In the Publish panel Indeed has no Post button and no account picker and is left out of "Post to all"; the agent records its Indeed step as skipped with the reason. What Indeed has instead: the **Post with the posting engine** card, and **Copy and open**, which puts the post on the clipboard and opens `employers.indeed.com/jobs` in the person's own browser (with the Raasta-AI Poster extension, section 5d, it also hands the extension every field). Neither needs an Indeed account connected under Platforms; a connected account feeds Diagnose.

## 5c. Debugging Indeed

Browser automation fails quietly: a page changed, a check appeared, a button moved. Two tools show what it actually saw. Both write to `debug-indeed/<run>/` (gitignored, the newest 20 runs kept, `INDEED_DEBUG_DIR` moves it) and never record field values, cookies, storage or URL query strings.

| Tool | What it does |
|---|---|
| **Diagnose** (bug button on an account, Platforms, Indeed) | A read-only visit: opens the employer area with the saved session, follows "Post a job", and records each page. It never fills in or submits anything. Optional "show the browser window" so a person can watch (only where the server has a screen). One run per account at a time and a 60 second pause between runs, so it looks like a person looking around. A sign-in page or a verification check ends it at once. The result shows the outcome, the screenshots, the steps and any page or network errors. `POST /api/indeed/accounts/debug { sessionId, visible? }`; `GET` lists the recent runs. |
| **Publish debugging** (`INDEED_DEBUG=true`) | Every automatic Indeed post attempt records the same things, and a failed attempt's message ends with `Debug trace: debug-indeed/<run>`. Off by default. |

Each step in a run folder has `NN-name.jpg` (screenshot) and `NN-name.json` (the page's headings, buttons, links and fields, each with a `hint`: the most stable selector for it, such as `[data-testid="..."]`, `#id`, `input[name="..."]` or `button "Continue"`), and `trace.json` ties the steps together with the console errors, page errors and failed requests. Code: `libs/indeed-debug.js` (recorder), `libs/indeed-page-script.js` (the script that describes a page), `libs/indeed-diagnose.js` (the walk).

**Verification checks.** A hidden run stops at the first verification page. With "show the browser window", the diagnostic waits (`INDEED_CHECK_WAIT_SECONDS`, default 180) for the **person** to clear the check in the window and then carries on; it only watches the page and never clicks the check. This is a person confirming, not the system getting past a check.

**What the runs showed (2026-10-06, corrected 2026-10-07).**

- **Hidden browser: blocked.** `employers.indeed.com` answered the very first request with HTTP 403 and a Cloudflare challenge (`challenges.cloudflare.com`), so no employer page loaded, even though the saved session itself was fine. A hidden, automation-driven browser replaying a saved session is treated as automation (the mismatch in finding 3 below).
- **Visible window with a person: the check verified.** The project owner, who was at the window, reports that Cloudflare's check verified. The run's own record is misleading, and the first write-up of it drew the wrong conclusion: its two screenshots, a few seconds apart, both show the widget on "Verifying...", and it was concluded that the check can never complete in an automated window. That was unsupported: the "check cleared" detection only read the page title, reported the check cleared while the verification page was still on screen, and the walk moved on within seconds (and clicked a link in the header of the check page, which is why it ended on Indeed's public employer page, where the account menu and "Go to Dashboard" show the session is signed in). The person was never given the 3 minutes the tool advertised, so the screenshots say nothing about whether the check completes.
- **Fixed since:** detection now reads the page's own words and the check's frame and needs several consecutive clear polls (`pageShowsCheck`, `waitForCheckToClear`), and the walk stops with "challenge" rather than carrying on while a check is showing.
- **Not yet tested:** the rest of the flow under automation in a visible window (typing into the boxes, moving between steps, whether the check comes back on a later page). The employer API host `encserv.indeed.com` answered 403 once during the visible run; whether that was before or after the check verified is not known.

Reading a run: start with `trace.json`'s `outcome`, then the `kind` of each step (`signed_in`, `login`, `challenge`, `other`), then the screenshots. `no_post_entry` means the employer home had no "Post a job" link or button; `no_form_found` means following it showed no form; `session_expired` and `challenge` mean reconnect and confirm on Indeed yourself.

## 5d. Assisted posting: the Raasta-AI Poster extension (Indeed and Rozee.pk)

**The problem it solves.** A hidden browser that Raasta-AI's server controls is blocked by Indeed's bot check, while a person in their own browser passes it as usual (section 5c). A visible automated window with a person present also passed the check once, so the extension is not the only route; it is the one that needs no automation at all and has been verified on the real Indeed flow, and Rozee.pk has no API to automate against. For Indeed and Rozee.pk the human step can therefore happen in the person's own browser, with the software helping *there*.

**How it works.**
1. **Publish, Copy and open** (Indeed or Rozee.pk): the server builds a *posting kit* (`libs/hiring/posting-kit.js`: title, location, workplace, job type, experience, pay, skills, the saved description, the apply link; empty fields left out; expires in 2 hours) and returns it with the hand-off. The page passes it to the extension (`libs/poster-bridge.js`, `window.postMessage`, same window and origin) and opens the platform. Without the extension it falls back to the old behaviour: text on the clipboard, platform opened.
2. On the platform's employer page, the extension (`extensions/raasta-poster`) shows a panel: **Copy** per field, **Fill the form** (best effort, matches boxes by their visible names) and **I posted it**. The person signs in, passes any check, reviews, and presses the platform's own Post button. The panel never clicks or submits, never overwrites typed text and never touches password fields.
3. **I posted it** stores a confirmation in the extension; the Publish panel picks it up (on open and whenever the tab regains focus), calls `POST /api/hiring/jobs/[jobId]/publish/confirm` and marks the job as posted. The link to the live post is only recorded if the person typed one.

**Properties.** No platform credentials, cookies or sessions are involved on either side, so findings 1 and 2 of section 5 do not apply to this path. The extension makes no network requests, reads only Raasta-AI's own address and the platform pages listed in its manifest, writes kit text with `textContent` (never HTML), and treats a kit as untrusted input (`lib/kit.js` copies only known properties, checks the platform and dates, drops links to other hosts, caps the lifetime at 4 hours). Install and use: `extensions/raasta-poster/README.md` (Chrome, Edge, Brave; load unpacked; reload the Raasta-AI tab).

**Verified on the real Indeed flow (2026-10-06, with the person signed in).** In the person's own Chrome the employer dashboard loads without a bot check and the panel appears on every step of Post a job. Step 1 ("Add job basics"): Job title is a labelled text box, so Fill filled it; Job location is an autocomplete box, which Fill typed into (whether Indeed accepts the typed text without picking a suggestion is for the person to check on Continue); "Job location type" is a custom drop-down, so it is Copy only. Step 2 ("Add hiring details"): Job type is a row of tick-box chips, which Fill ticks by name; hiring timeline and number to hire have no counterpart in the kit. Indeed advises against symbols and extra detail in a job title and checks it on Continue, so the Indeed kit carries a cleaned title (`indeedTitle` in `libs/hiring/posting-kit.js`: bracketed asides and symbols removed, 60 characters at most) with the original as a separate "Title as written" row.

**The real Indeed flow, as recorded with Copy page report on a signed-in employer account (2026-10-06).** Post a job starts at `employers.indeed.com/jobs` ("Post a job" goes to `/job-posting/choose-flow`, then `/job-posting/from-scratch/...`). The panel follows every step, because it keys on the host and re-reads the path as the single-page flow changes.

| Step | Path | What is on it | What Fill does |
|---|---|---|---|
| Add job basics | `/from-scratch/getting-started` | Job title (text box with suggestions), Job location type (custom drop-down), Location (autocomplete) | Types title and location. The type is Copy only |
| Add hiring details | `/from-scratch/hiring-details` | Job type as tick-box chips, Hiring timeline (custom drop-down, required), Number of people to hire (required) | Ticks the job type chip. The other two are the recruiter's choice |
| Add pay and benefits | `/from-scratch/compensation-details` | Show pay by (custom), Minimum and Maximum (text, pre-filled with Indeed's own estimate), Rate (custom) | Types minimum and maximum when the job has pay |
| Describe the job | `/from-scratch/job-description` | One rich-text box "Job description *" with Bold, Italic, List | Types the description. **Not yet verified on the real editor**: the person typed this step by hand |
| Review | `/from-scratch/review-job` | A summary with Edit buttons: company, openings, location, job type, pay, description, **Application method (Email by default)**, Require resume, Hiring timeline; Preview; Confirm | Nothing |
| Sponsor job | `/sponsor/sponsor/budget-tiers` | Plan options with the **paid Premium plan pre-selected**; "No thanks" | Nothing |
| Job page | `/jobs/view` | Status **Pending**, "Your job is not posted on Indeed yet." while Indeed reviews it | Nothing: the person clicks I posted it |

Two consequences for Raasta-AI. First, **Application method**: Indeed defaults to Email, so applicants would skip Raasta-AI's apply form and with it the screening; the panel tells the person to send applicants to the Apply link. Second, the **Sponsor** step pre-selects a paid plan; the panel says to choose "No thanks" to post for free, and nothing on that page is ever chosen for the person. A post that Indeed keeps as Pending is "submitted", not yet live: I posted it records that the person submitted it. The panel shows a tip for each of these steps (`TIPS` in `extensions/raasta-poster/panel.js`), matched on the path only.

**What is verified and what is not.** Tested end to end with the real extension loaded in Chromium against stand-in pages (kit in, panel shown, fields filled, nothing clicked or submitted, copy, confirmation out, kits kept per platform, expiry and refusal rules). The employer forms of Indeed and Rozee.pk could not be inspected from outside a sign-in, so *Fill* is untested against them: it may miss boxes, and the panel lists what it missed so the person uses Copy. Run the extension on the real forms once and adjust the name patterns in `lib/fill.js` (`NAMES`) from what the panel reports. **Copy page report** in the panel copies, for the page the person is on, every visible box with the names Fill can read for it, a selector hint, whether it has text (never the text), and which kit field Fill would put in it, plus the buttons, headings and the kit fields with no match; passwords, links and the address's query part are left out. That is the input for tuning `NAMES` against a real form.

## 5e. Sanctioned automatic routes (not built)

Researched on 2026-10-06; none needs browser automation, all depend on someone else's approval or on the app being publicly reachable.

| Route | What it takes | Notes |
|---|---|---|
| Indeed career-site aggregation | A public page per job with its own URL, a description, a location, a title and a way to apply | Free and automatic: Indeed's crawler finds the jobs; there is no request form and no guarantee or timing. Needs Raasta-AI deployed at a public address (not localhost). Raasta-AI already serves a public apply page per job (`/apply/[jobId]`); a public careers list and a crawlable job page would be the work |
| Indeed XML feed | A feed Indeed reviews and approves | For employers and ATS developers; refreshed about every 6 hours. Since 2026-03-31 single-source feeds lose free visibility where an ATS integration exists |
| Indeed Job Sync API | Indeed's partner agreement and approval (Partner Console) | The route for ATS products; access is by approval |
| Rozee.pk | None published | The employer site lists Career Portal, Executive Search and "Contact Sales"; there is no documented API, feed or bulk upload. Ask Rozee.pk sales whether an integration exists |

## 5f. The posting engine (Indeed and Rozee.pk)

**What it is.** A separate program (`npm run poster:engine`; `services/poster-engine/`, code in `libs/poster/`) that opens a visible browser window on the recruiter's own computer, types the saved post into the platform's "Post a job" form like a person (Indeed: section 5d; Rozee.pk: section 5g), reads every field back, and hands over to the recruiter at every check, sign-in and decision. It is the supervised form of "automatic posting" that the evidence supports: a visible window with a person present (section 5c). Decision of the project owner, 2026-10-07: human-like input is allowed (section 5); stealth flags exist but are off (`POSTER_STEALTH`).

**Using it.** Recruiter > Jobs > Publish > Indeed or Rozee.pk > **Post with the posting engine**.

- **Practice (no account)** does the whole run, Confirm included, on a practice site that stands in for the platform (`libs/poster/practice/`, one per platform, marked "PRACTICE SITE" on every page). No account, no network (every other address is refused), nothing recorded, no limits. It shows a practice verification check first, so the hand-over to you can be seen. Use it to see the engine work, to demonstrate it, and to try a change without risking an account.
- **Rehearse (posts nothing)** fills in every step on the real Indeed, checks it, and stops before Indeed's Confirm. Indeed may keep an unfinished draft of the job in the account.
- **Post with the engine** does the same, then waits for **you** to press Confirm in the window.
- If the engine is not running the panel offers to start it (it is an optional program on the Setup guide; it never counts as something missing). One live run per job and platform; **Stop** closes the window and ends the run.

**What a run does** (the steps are in `libs/poster/flow-indeed.js`, taken from the real flow in section 5d):

| Step | The engine |
|---|---|
| Open Post a job, Start from scratch | Clicks them if they are shown |
| Job basics | Job location type, then the title (cleaned the way Indeed asks, section 5d), then the location (picks the suggestion that matches) |
| Hiring details | Ticks the job type, picks the hiring timeline (default "1 to 2 weeks"), sets the number to hire (the panel's "People to hire") |
| Pay and benefits | Range, minimum, maximum, per month, only when the job has pay in PKR; otherwise it stops for you (see below) |
| Job description | Types the saved post |
| Review | Reads the review page back and compares it with the post. **Stops here.** Pressing Confirm is yours |
| Sponsorship | Only after you confirmed: answers "No thanks" (and the "Are you sure?" that follows). It never picks a plan and never touches "Claim credit" or "Save and continue" |
| Job page | Records the job's status on Indeed (usually "Pending": Indeed is still reviewing it) and its link |

Every field ends as **verified** (read back from the page and found right), **unverified** (could not be set or did not read back the same) or **skipped** (nothing to enter). The panel shows them as chips under each step, with a screenshot per step.

**When it stops for you** (the run becomes *Needs you*, the window comes to the front and the panel says why; it carries on by itself when it sees you are done):

| Reason | Meaning |
|---|---|
| `check` | Indeed shows its verification check. Complete it yourself; the engine never clicks it |
| `sign_in` | Indeed asks you to sign in. Sign in yourself; the engine never types a password or a code (if Google refuses to sign in inside the window, use Indeed's emailed code). The window has a browser profile of its own, so this is needed once and passed checks are remembered |
| `field` | A field could not be set or read back (a pay form in rupees when the job lists dollars, no pay at all, a drop-down it could not open), or Indeed did not move on (the panel shows what Indeed said, for example its question about the job title). Fix it in the window and press Continue |
| `page` | A page the flow does not know. Go back to the Post a job form |
| `confirm` | Everything is filled in and read back: review it and press Confirm. If anything differs from the post, the message says what |
| `sponsor` | Only when "No thanks" could not be pressed |
| `account` | Indeed has **paused the employer account** ("We've paused access to your employer account"). Nothing can be posted until Indeed restores it, so the run ends at once, with code `account_paused`. The engine does not fill in Indeed's appeal form: that is the account owner's, in their own browser |

A check that is only a **block page** ("Additional Verification Required", a Ray ID and a Return home button, nothing to complete) is not something a person can pass: the window itself was refused. The run waits 45 seconds, then ends with code `blocked` and the Ray ID in the message.

Going back to a step to edit it is respected: the engine waits for your Continue and does not type over your change. A window closed by you, a Stop, or nobody returning for 10 minutes (`DEFAULT_TIMING.gateWaitMs`) ends the run; the message says whether anything could have been posted.

**How it types** (`libs/poster/human.js`). One key at a time with uneven gaps, longer after words and punctuation, the odd slip on short boxes that it corrects, a long description typed against a time budget (75 seconds) instead of taking minutes, and a mouse that travels along a curve to a spot inside the element. `POSTER_TYPING_SPEED` is `natural` (default), `fast` or `off`. The order of preference stays: a visible window with a person first, human-like input second, stealth only if Indeed challenges those (`POSTER_STEALTH=true` adds launch flags).

**How it fits together.**

- The web app inserts a queued row in `posting_runs` (migration `0015`, `docs/ai-hiring/05-data-model.md` section 7f). The engine claims it (compare-and-set, so two engines never take the same run), opens the window, and writes the status, the gate, the steps with their fields and a heartbeat as it goes. The panel polls every 1.5 seconds while a run is live. A live run with no heartbeat for 60 seconds is ended as failed, and a queued run nobody picked up for 30 minutes is dropped (`reapStale`).
- Screenshots go to `.runtime/poster-runs/<run>/NN-step.jpg` (git-ignored, the newest 15 runs kept), with the signed-in account's name blacked out, and are served only to the person who started the run (or an admin).
- The window uses a persistent browser profile per person, `.runtime/poster-profiles/<user>/indeed`, in the browser the person already has (Chrome, else Edge or Chromium). It is never visible to the web app and holds the sign-in.
- **Cool-off.** After a run ends as `account_paused` the engine leaves that person's Indeed alone for 24 hours (`POSTER_PAUSED_COOLOFF_HOURS`), and after `blocked` for 30 minutes: a new rehearsal or post is refused with the time to wait (HTTP 429). Trying again at once is what turns a refusal into a restriction. Practice runs are never refused. Copy and open is never limited.
- Posting limits: runs that post count against the Indeed limits (section 3, per person; rehearsals, practice runs and stopped runs do not). When the job is on Indeed, a row is written to `job_publications` (mode `engine`) and the job's `indeed_*` columns, exactly like a hand-off that was confirmed.
- API: `POST/GET /api/hiring/jobs/[jobId]/posting-runs` (start, list), `GET /api/hiring/posting-runs/[runId]`, `POST .../cancel`, `GET .../shots/[name]`.

**Where it must run.** The window opens on the machine that runs the engine, with that machine's network address, so it runs on the recruiter's own computer (development and the demo: one machine runs everything). A deployed server has no screen for a person to watch. For a deployment the engine would run on the recruiter's machine and reach the app over HTTPS instead of the database: the run store (`libs/poster/runs.js`) is the one module to put behind an API.

**Two platforms.** The engine runs Indeed (`flow-indeed.js`) and Rozee.pk (`flow-rozee.js`, section 5g). A flow is a plain object: `steps` (a path pattern and a `run` function each), `matchStep`, `blocker` (a check, a sign-in, a paused account), `confirmLabel` (the platform's own final button), and for a platform whose final button leaves the page where it is, `confirmCleared` and `finish`. Adding a platform is a new flow, a practice site and a name in `ENGINE_PLATFORMS`, once its form has been mapped with a person signed in.

**Verified, and not.** Verified in a real Chromium against a stand-in for Indeed's employer area (every step above, a verification check, a sign-in, Indeed refusing to move on, going back, stop, a closed window, nobody returning, typing that looks like typing), and through the real database with the engine process (queue, claim, progress, screenshots, the job's history). **Not yet verified on the real Indeed:** the location suggestion list, the custom drop-downs' options, the rich-text description box, the review page read-back, the "Are you sure?" confirmation on the sponsor page, and whether the verification check comes back on later pages under automation. The first live run is a rehearsal. When a step cannot be done the engine stops for the person instead of guessing, so a wrong guess about the page costs a pause, not a wrong post.

**What the first live runs showed (2026-10-07 and 2026-10-08).** Observed in the owner's Chrome and in the engine's window: (1) the engine's own Chrome window reached Indeed's real sign-in page without a check; (2) a later run's window was refused with a block page ("Additional Verification Required", a Ray ID, nothing to complete) before any sign-in, with Chrome's banner "controlled by automated test software" showing; (3) in the owner's normal Chrome the test employer account was **paused** ("We've paused access to your employer account ... insufficient account information or unusual login activity", an appeal form asking for business verification). The account had worked in the same Chrome on 2026-10-06. **The cause of the pause is not known**: it could be the automation (earlier session replays and sign-in windows), the nonsense test job posted on 2026-10-06, or the account's own details; nothing observed separates them. What it shows is how Indeed enforces. The engine now recognises both pages (above), and the practice site reproduces them for the tests. Use a real business's account for any live run, and do not repeat live attempts against a paused or blocked account.

**Risk.** Indeed's terms restrict automated use of its employer site, and an automated session can still get an account restricted. The owner accepts this (section 5). The panel says so before a post run, and the engine only ever acts on the signed-in account of the person in front of the window.

## 5g. Rozee.pk

**What Rozee.pk's "Post a job" is today.** Recorded on 2026-10-08 on a signed-in employer account. The old `www.rozee.pk/employer/job/post` form is gone. A signed-in employer posts through **RozeeGPT**, an AI wizard on `www.rozeegpt.ai` (`hiring.rozee.pk/login` signs in; its page has Google reCAPTCHA, email and password, and Google sign-in). A signed-out visitor who presses Post a Job is sent to `rozeegpt.ai/employer/signup`, the same wizard behind account creation.

| Step | Address under `www.rozeegpt.ai` | What is on it | What the engine does |
|---|---|---|---|
| Dashboard | `/employer/dashboard` | A sidebar with the account's name, email and phone (blacked out in screenshots) and **Post A New Job** | Presses Post A New Job |
| Job title | `/employer/dashboard/postjob/jobtitle` | `input[name=jobTitle]`, an arrow button, the switch "Use AI to Optimize Job Title" | Types the title as written, leaves the switch off |
| Skills | `.../chooseskills` | Skill chips suggested for the title; a chip opens a small menu with **Required** and **Nice to Have**; Add New Skill; Continue (off until a skill is chosen) | Chooses each of the job's own skills that Rozee suggests, as Required. A skill Rozee does not suggest is not forced in |
| Experience | `.../experience` | `input[name=experience]` (years) | The least of the job's experience range, in years (1 when the job has none) |
| Gender preference | `.../genderpreference` | `input[name=gender_preference]`, options Male, Female, No Preference | Always **No Preference**: a job is never narrowed by gender |
| Managing others | `.../manageemployees` | `input[name=manageEmployees]`, "Yes or No" | "No" |
| Other requirements | `.../otherrequirements` | `textarea[name=otherRequirements]`, Continue (off until there is text) | "No other requirements." |
| City and workplace | `.../cityid` | `input[name=cityId]`, a city list that loads from the network, the chips On-Site, Hybrid and Remote | Types the city, picks the Pakistan match, chooses the chip for the job's workplace |
| Budget | `.../maximumbudget` | A currency drop-down (PKR), `input[name=maximumBudget]` (the **maximum monthly** budget only), "Hide salary" | The job's top pay, only when it is in rupees |
| The draft | `/employer/job/app/<id>/description` | Rozee's AI has written a **Draft** job: description, responsibilities, cities, experience, apply-by date, skills. Every section edits in place (clicking text opens a rich-text box) and **saves by itself**. A dialog opens on arrival. **Publish Job** at the bottom | Answers the dialog "Keep as draft", reads the draft back (title, pay, city and workplace, experience, skills), replaces the description with the recruiter's post, removes Rozee's own Responsibilities text (the post carries them), and **stops** |

**What is never pressed.** Publishing is the recruiter's, because it spends one of the account's free Featured Job credits (the dialog says three a month) or sells an upgrade. The engine never presses **Publish Job**, **Apply Credit**, **Post with free Featured Job credit** or **Upgrade to Top Job**. The dialog that opens by itself when the draft appears is answered with **Keep as draft**, the choice that publishes nothing and uses no credit. The run's final gate says so and waits; it ends as published when the draft notice ("This job is not published yet") is gone from the page, and records the job's public link (`https://www.rozeegpt.ai/<company>-<title>-<id>`; `isAllowedPostUrl` accepts `rozeegpt.ai` for Rozee.pk).

**Side effects to know about.** The wizard creates the draft as soon as the budget is answered, and edits save by themselves, so a **rehearsal and a post both leave a draft job in the Rozee.pk account** (card menu on the dashboard: Pin to top, Edit / Publish, Delete, Copy Job). A practice run leaves nothing anywhere.

**Settings that follow from this.** `autoPostAvailability("rozee")` is `{ available: false }`: Rozee.pk is not posted in the background, because the last step spends a credit and has to be a person's choice. `libs/rozee-job-publisher.js`, which guessed at the dead form and called any address containing "/job/" a success, is now a stub that says so. Sign-in: `hiring.rozee.pk/login` and the `/login`, `/signup` and `/register` pages of both hosts are treated as a sign-in gate; if Google refuses to sign in inside the engine's window, use the Rozee.pk email and password. Rozee.pk's per-person limits (5 posts a day, 5 minutes apart) apply to post runs, and the cool-off (section 5f) applies to a block page or a paused account here too.

**Verified, and not.** Verified in a real Chromium against the Rozee.pk practice site (`libs/poster/practice/rozee-site.js`, a stand-in marked PRACTICE SITE that reproduces the wizard above): a rehearsal, a post that waits for Publish Job and the dialog, a skill Rozee does not suggest, a sign-in, a check, pay in another currency, a city list that does not load, a job with no experience range or pay (`tests/hiring/poster-rozee.test.js`). **Not yet verified on the real Rozee.pk:** the wizard under automation, the city and gender lists' option roles, the arrow button at the end of each box, whether the rich-text boxes take the keystrokes and the whole text, whether Rozee's own Responsibilities can be cleared, what the page shows once a job is published, and Add New Skill (not used: only suggested skills are chosen). Where a step cannot be done the engine stops for the person instead of guessing. The first live run should be a rehearsal on an account that can be lost.

**Recorded during the mapping.** One throwaway draft, "Test Engineer" (id 159237), was created on the owner's Rozee.pk account to see the later steps, and its description was edited to test saving; it was never published and should be deleted from the dashboard.

## 6. Where the agent fits

The hiring agent (`/dashboard/recruiter/agent`, see 13) posts through the same publisher with `initiatedBy: "agent"`, to each platform that has an account selected in the agent's settings (LinkedIn, Rozee.pk, Indeed). It writes one post per platform, asks for approval first in Assisted mode, puts the job live on Raasta-AI before any platform post, and if a platform post is refused or fails, the run records why and carries on with screening. The sales agent is separate (`/dashboard/agents`) and unchanged.

## 7. Tests

- `tests/hiring/platform-content.test.js`: per-platform rules, prompts, empty answers, hand-off link.
- `tests/hiring/publishing.test.js`: limits, gap, brake, sign-in cool-off, failure classification, pasted-link validation.
- `tests/hiring/posting-kit.test.js`, `tests/hiring/poster-extension.test.js`: the kit, and the extension itself (validation, field filling, and the whole round trip with the extension loaded in Chromium).
- `tests/hiring/indeed.test.js`: Indeed URL classification, the sign-in window rules (one at a time, no screen, cancel, failure).
- `tests/hiring/indeed-debug.test.js`: the recorder and the diagnostic walk, run in a real headless Chromium against a local stand-in for the employer area (nothing touches Indeed): structure without values, query strings dropped, console and network errors, pruning, every outcome, the one-at-a-time and pause rules.
- `tests/hiring/poster-core.test.js`: the posting engine's rules without a browser (key timing, typing and corrections against a time budget, the mouse path, the run model, the Indeed flow's page matching and read-back comparison, starting a run and the posting limits, the engine process and its health address).
- `tests/hiring/poster-rozee.test.js`: the same runner against the Rozee.pk practice site (the wizard, the draft, the publish dialog; see section 5g).
- `tests/hiring/poster-runner.test.js`: the runner in a real Chromium against a stand-in for Indeed's employer area (the practice site, `libs/poster/practice/`, through `tests/hiring/helpers/mock-indeed.js`; every request to another address is refused): a rehearsal, a post that waits for Confirm, a verification check cleared with its button, a sign-in, Indeed refusing to move on, an unfillable field, going back, stop, a closed window, a timeout, a paused account, a block page, human-like typing.
- Verified end to end against a development database with a fake platform adapter (nothing was posted anywhere): overview, publish, gap between posts, one at a time, stale attempts, sign-in check handling, hand-off and link validation, all platforms, refusals.
