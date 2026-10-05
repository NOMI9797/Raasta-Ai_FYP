# 19. Publishing a job to LinkedIn and Rozee.pk

How a job gets from Raasta-AI onto the platforms, what each post looks like, which rules protect the connected accounts, and a review of how the platform connection works today.

## 1. The flow

```
Job  ->  one post per platform (written to that platform's format)
     ->  Publish panel (Recruiter > Jobs > Publish)
            |-- Post to all connected          (one request, each platform stands alone)
            |-- Post to LinkedIn / Rozee.pk    (one platform)
            |-- Copy and open <platform>       (hand-off: you press Post yourself)
     ->  job_publications row per attempt  ->  chips on the job card, state in the panel
```

- The job goes live on Raasta-AI (status `published`) as soon as **any** platform post succeeds or is confirmed, because candidates apply through Raasta-AI.
- Every attempt is a row in `job_publications` (migration `0012`). It is the audit trail, the limit counter and the "one at a time" guard.
- Code: `libs/hiring/platform-content.js` (what to write), `libs/hiring/publishing.js` (how to publish), UI `app/dashboard/recruiter/components/PublishPanel.js`.

## 2. One post per platform

`PLATFORM_SPECS` holds the rules; `finalizePost()` enforces them on whatever the model returns, so a bad answer cannot reach a platform.

| | LinkedIn | Rozee.pk |
|---|---|---|
| Shape | Feed post: a hook in the first two lines (the part before "see more"), short paragraphs or dash lines | Job ad with plain sections: About the role, Responsibilities, Requirements, What we offer, How to apply |
| Length | 130-220 words, 3000 characters at most | 180-350 words, 4000 characters at most |
| Emojis | Up to three | None (removed if the model adds them) |
| Hashtags | 3-5 on the last line (extras removed) | None (removed) |
| Apply link | Added before the hashtags if the model forgot it | Added under "How to apply" if missing |
| Markdown | Stripped (neither platform renders it) | Stripped |

The apply link is built on the server (`jobApplyUrl`) and never taken from the browser. The prompt forbids inventing a company, salary, perks or a pay period. If the model returns (almost) nothing, it is asked once more, and then the request fails with a clear message. A post that is only the apply link is never saved.

Generate with `POST /api/hiring/jobs/[jobId]/generate-post { platform: "linkedin" | "rozee" | "all", tone? }`. Edits are saved with `PATCH /api/hiring/jobs/[jobId]` (`linkedinPost`, `rozeePost`).

## 3. Publishing rules

**Auto** (through the connected account) and **hand-off** (copy the text, open the platform's own composer, press Post yourself) both start from a person clicking a button. The agent uses the same publisher with stricter rules.

| Rule | Value | Why |
|---|---|---|
| Automatic posts per account | LinkedIn 3, Rozee.pk 5 in any 24 hours | A person posts a few jobs a day, not dozens |
| Gap between automatic posts | LinkedIn 10 min, Rozee.pk 5 min | No bursts |
| Brake after a failed attempt | 2 min | A double click must not hammer a platform |
| One attempt at a time per job and platform | Partial unique index on `job_publications` | No duplicate public posts |
| Sign-in or security check | The attempt stops, is recorded as `needs_login`, nothing is retried | A person has to confirm it, never a script |
| Agent after a sign-in check | Leaves that account alone for 12 hours | Unattended runs must not keep trying |
| Hand-off | Never limited, never touches the platform from the server | It is the person posting |

Limits can be changed per platform with `PUBLISH_DAILY_CAP_LINKEDIN`, `PUBLISH_DAILY_CAP_ROZEE`, `PUBLISH_MIN_GAP_MINUTES_LINKEDIN` and `PUBLISH_MIN_GAP_MINUTES_ROZEE`.

Accounts are shared by operators (admins, sales operators and recruiters see every connected account on the Platforms page), so the panel offers an account picker when there is more than one. Without a choice the job owner's own active account is used, then the team's only active account.

## 4. API

| Route | Purpose |
|---|---|
| `GET /api/hiring/jobs/[jobId]/platforms` | Per platform: connection, saved post, last result, limits, hand-off link. Optional `?linkedin=<accountId>&rozee=<accountId>` |
| `POST /api/hiring/jobs/[jobId]/publish` | `{ platforms: "all" or [..], mode: "auto" or "handoff", accountIds? }` returns one result per platform |
| `POST /api/hiring/jobs/[jobId]/publish/confirm` | `{ platform, postUrl? }` after posting by hand; the link must be https on the platform's own domain |
| `POST /api/rozee/jobs/[jobId]/publish` | Older route, now a thin wrapper over the same publisher |

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

### What was deliberately not done

No stealth plugins, fingerprint or user-agent spoofing, proxy rotation, CAPTCHA solving or randomised behaviour meant to pass as a human. Both platforms forbid automation in their terms, and detection evasion turns a small risk (a challenge screen) into a large one (a restricted or banned account that the whole team relies on). When a platform challenges the account, the system stops and asks a person.

### Recommended next steps

1. **LinkedIn posts through the official API.** The "Share on LinkedIn" product (OAuth, scope `w_member_social`, Posts API) is the sanctioned way to post as a member and needs no browser. Posting a real LinkedIn *job* needs the Jobs API, which LinkedIn grants to approved partners; check the current LinkedIn developer documentation before building on it.
2. **Rozee.pk:** ask Rozee whether an employer API or bulk-posting feed exists. Until then, hand-off is the reliable path.
3. **Connect without giving Raasta-AI the password:** OAuth where it exists, or a sign-in the person does themselves in a visible browser window, so only the resulting session is kept.
4. **Encrypt session JSON at rest** (AES-GCM, key from the environment).
5. **Scope accounts per person** or add an explicit "share with team" switch.

## 6. Where the agent fits

The hiring agent (`/dashboard/recruiter/agent`, see 13) posts through the same publisher with `initiatedBy: "agent"`. It writes one post per platform, asks for approval first in Assisted mode, puts the job live on Raasta-AI before any platform post, and if a platform post is refused or fails, the run records why and carries on with screening. The sales agent is separate (`/dashboard/agents`) and unchanged.

## 7. Tests

- `tests/hiring/platform-content.test.js`: per-platform rules, prompts, empty answers, hand-off link.
- `tests/hiring/publishing.test.js`: limits, gap, brake, sign-in cool-off, failure classification, pasted-link validation.
- Verified end to end against a development database with a fake platform adapter (nothing was posted anywhere): overview, publish, gap between posts, one at a time, stale attempts, sign-in check handling, hand-off and link validation, all platforms, refusals.
