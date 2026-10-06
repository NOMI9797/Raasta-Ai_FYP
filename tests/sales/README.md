# Sales module tests

Automated tests for the Client Acquisition (Sales) module: lead collection, research, the AI sales
agent, the knowledge base (RAG), replies, follow-ups and meetings. Every check that was first done
by hand during development is also kept here as a repeatable test.

**141 test cases in 21 files. Latest run: 136 passed, 0 failed, 5 live checks skipped by default (they pass when run with `npm run test:sales:live`).**

## How to run

```bash
npm run test:sales               # everything (live checks are skipped)
npm run test:sales:unit          # unit tests only: no database, no network (about 2 s)
npm run test:sales:integration   # against the local Postgres database (needs DATABASE_URL in .env.local)
npm run test:sales:live          # real Gmail, Groq, Indeed and the embedding model (needs .env.local credentials)
```

- **Unit tests** check one piece of logic with fixed inputs.
- **Integration tests** run the real agent code against the real database. They create a throw-away
  user with campaigns and leads, and delete everything afterwards. The AI, the email sender and the
  mailbox are replaced by fakes (`helpers/fixtures.js`), so results are repeatable and **no email is
  ever sent**. The real prompt building, decisions, slot finding and calendar invites all run. If the
  database is not reachable, they skip themselves.
- **Live checks** use the real accounts. Nothing is emailed: SMTP is only verified, and IMAP only
  counts recent messages.

## Summary

| File | Type | Tests | What it covers |
|---|---|---|---|
| `agent-plan.test.js` | Unit | 10 | Agent planner and approval policy |
| `agent-scoring.test.js` | Unit | 3 | AI fit scoring |
| `campaign-overview.test.js` | Unit | 2 | Numbers on each campaign card |
| `companies.test.js` | Unit | 5 | One lead per company, duplicates |
| `company-research.test.js` | Unit | 6 | Website, contacts and decision-makers |
| `conversation.test.js` | Unit | 22 | Reply matching, reading, decisions, writing, threading |
| `csv.test.js` | Unit | 4 | LinkedIn CSV import |
| `email.test.js` | Unit | 4 | Sales email and test-mode redirect |
| `guidance.test.js` | Unit | 4 | Setup guide |
| `lead-stage.test.js` | Unit | 4 | Pipeline stage label of each lead (Find leads table) |
| `knowledge.test.js` | Unit | 18 | Knowledge base chunking, search, grounded answers |
| `meetings.test.js` | Unit | 9 | Time zones, free slots, calendar invites |
| `message-writer.test.js` | Unit | 5 | AI message writing |
| `outreach.test.js` | Unit | 3 | Where each company stands on the Outreach step |
| `results.test.js` | Unit | 7 | Results: KPIs, funnel, activity, intents, outcomes, lead quality |
| `agent-flow.integration.test.js` | Integration | 4 | Agent outreach end to end |
| `conversation-flow.integration.test.js` | Integration | 9 | Replies, answers, meetings, follow-ups end to end |
| `knowledge-search.integration.test.js` | Integration | 13 | Retrieval quality with real embeddings and pgvector |
| `outreach.integration.test.js` | Integration | 3 | Sending company emails by hand: limit, thread, agent hand-off |
| `results.integration.test.js` | Integration | 1 | Results from a campaign's real emails, replies and meetings |
| `live-services.test.js` | Live | 5 | Gmail SMTP/IMAP, Groq, Indeed, embedding model |
| **Total** | | **141** | |

## Every test case

### `agent-flow.integration.test.js` (4)

Integration (database) · The agent works a campaign end to end: research → score → write → ask/send

- Semi-auto: prepares every lead, skips a poor fit, and asks before sending
- Auto: sends on its own, but still asks when there is no email address
- Auto respects the daily email limit: the rest wait for tomorrow
- A company already emailed from another campaign is never emailed again without asking

### `agent-plan.test.js` (10)

Unit · Sales agent planner and policy (what the agent does next for each lead, what it asks about)

- policy: sending is asked about in Semi-auto and automatic in Auto; escalations are always asked
- leads move research → score → skip or write
- Semi-auto asks before sending an email; Auto sends it
- a message approved on the Messages step is not asked about again
- escalations: no address, borderline fit, contacted in another campaign
- Auto respects the daily email cap and defers the rest
- an existing action is not proposed twice, and a rejection stops the lead
- LinkedIn: invite first, wait for acceptance, then message; blocked without an account
- the campaign is finished when every lead is sent, skipped or stopped
- job posts without a company name are skipped; failed research blocks the lead until someone researches it

### `agent-scoring.test.js` (3)

Unit · AI fit scoring of leads (prompt and score handling)

- the prompt for a company carries its roles, size, website text and the offer
- scores are clamped to 0-100 and a missing score is an error
- scoreLead reads the model's JSON

### `campaign-overview.test.js` (2)

Unit · The numbers on each campaign card (step 1)

- each campaign card gets leads by platform, contacted, replied and meetings
- the newest active agent run is the campaign's agent; finished runs are ignored

### `companies.test.js` (5)

Unit · Grouping job posts into one lead per company, duplicate detection

- companyKey ignores case, punctuation and legal suffixes
- groups job posts of the same company and keeps nameless posts apart
- mergeJobs skips job URLs that are already there
- jobsOf falls back to the lead's own job post
- findDuplicateCompanies keeps the oldest lead of each company

### `company-research.test.js` (6)

Unit · Company research: website choice, emails/phones from pages, decision-makers

- dropPartialNumbers keeps the full number when the same one was also read cut short
- pickWebsite skips listing sites and prefers a domain with the company's name
- originOf keeps only the site root and accepts bare domains
- extractContacts finds emails (including Cloudflare-hidden ones), phones, socials and contact pages
- parseLinkedInResult reads name and title and ranks leadership first
- parseLinkedInResult ignores other companies and non-profile links

### `conversation-flow.integration.test.js` (9)

Integration (database) · Reading replies, answering from the knowledge base, booking meetings, follow-ups

- Inbox: replies are matched to our emails; other mail is ignored and never stored
- Inbox: a reply wakes the campaign's agent, re-opening a finished run
- Semi-auto: a question with a time is answered from the knowledge base, and booking waits for approval
- Auto: interest gets three free times; picking one books it without asking
- Auto still asks a person about discounts and about anything the knowledge base doesn't cover
- Unsubscribe: no reply, conversation closed, and no follow-ups ever
- Out of office: no reply; the follow-up waits until they're back
- Follow-ups: two nudges in the same thread, then the lead is closed as no response
- A reply withdraws a follow-up that was waiting for approval

### `conversation.test.js` (22)

Unit · Replies: matching to our emails, reading intent, decision rules, writing, threading

- message ids are pulled out of In-Reply-To / References headers
- subjects compare without Re:/Fwd: chains and the test tag
- a reply is matched by its thread headers first
- without headers, the subject matches only from the address we wrote to
- in test mode, the test recipient's replies match by subject
- old emails and unrelated mail are not matched
- bounces and our own mail are ignored
- only the new text of a reply is kept
- the reading prompt carries today's date, our zone and the times we offered
- a reading is normalised: unknown intents, bad dates and out-of-range slots are dropped
- a question is answered; a time they ask for is booked when free
- interest or a meeting request without a time gets times offered
- a time that isn't free gets other times, and a person is asked
- no, stop and away get no email back
- not now gets a short polite close
- unclear, unhappy or sensitive replies always go to a person
- the time they mean: a picked slot, else their time in their zone or ours
- our answer goes to whoever replied, or the original address while test mode redirects
- times and meeting details are filled in by code, never by the AI
- reply and follow-up prompts are grounded in the knowledge base
- follow-ups are spaced from the first email and stop when used up
- our next email keeps the thread: Re: subject and every Message-ID

### `csv.test.js` (4)

Unit · Importing LinkedIn leads from CSV

- parseCsv keeps commas, quotes and line breaks inside quoted cells
- reads a LinkedIn export with headers, joining first and last name
- reads a plain list of URLs without a header
- skips rows without a LinkedIn profile URL

### `email.test.js` (4)

Unit · Sending sales email, test-mode redirect

- sends to the real recipient when no test address is set
- redirects to the test address, marks the subject and names the intended recipient
- refuses invalid addresses and empty bodies
- renderEmail escapes HTML and keeps paragraphs

### `guidance.test.js` (4)

Unit · Sales setup guide (next step to do)

- a new user is pointed at connecting LinkedIn first
- optional steps never become the next step
- the first unfinished required step is next
- job boards are done only when Indeed is set up and Rozee is connected

### `knowledge-search.integration.test.js` (13)

Integration (database + real embedding model + pgvector) · Knowledge base retrieval quality

- the sample company profile is split, embedded and stored
- finds "Pricing" for: How much would a senior React developer cost per month?
- finds "Frequently asked questions" for: Can you sign an NDA before we talk?
- finds "Case studies" for: Do you have experience with logistics apps?
- finds "Our services" for: Do you build iOS and Android apps?
- finds "How we work" for: How long does it take to build an MVP?
- finds "About us and contact" for: Where is your office and when were you founded?
- finds "Frequently asked questions" for: What happens if a developer isn't a good fit?
- a question the knowledge base doesn't cover only finds weak matches
- keyword search catches exact terms: Flutter
- one user's knowledge base is never searched for another user
- editing an entry re-indexes it; deleting removes its passages
- the answer comes only from the passages found, with the ones it used

### `knowledge.test.js` (18)

Unit · Knowledge base: chunking, hybrid search fusion, web/file extraction, grounded answers

- text is normalised: Windows line ends, no-break spaces, runs of blank lines
- short text is one chunk that carries the title for embedding
- long text is split under the size limit, and sections keep their heading
- a single huge line is hard-split rather than dropped
- empty text gives no chunks
- every sample document chunks into passages the embedding model can read
- rank fusion rewards passages found by both meaning and keywords
- keyword query keeps meaningful words, ORed, without stop words or symbols
- context numbers the passages with their titles
- html becomes readable text without scripts, menus or tags
- only public web pages can be fetched
- uploads must be a supported type and size
- unknown categories fall back to other
- the answer prompt forbids inventing facts and carries the passages
- source numbers are kept only when they point at a real passage
- an answer is covered only when the model says so and cites a passage
- an empty knowledge base answers without calling the AI
- each FAQ answer gets its own focused passage (found by the retrieval test)

### `outreach.test.js` (3)

Unit · Where each company stands on the Outreach step, and the filters

- before sending: not written, needs an address, draft, ready, failed
- after sending, the conversation decides the status
- every status belongs to exactly one filter (besides All)

### `outreach.integration.test.js` (3)

Integration (database) · Sending first emails by hand on the Outreach step

- the board shows where every company stands
- sending by hand: approves drafts, starts the thread, stops at the daily limit
- a failed send is recorded, and an email without an address isn't tried

### `results.test.js` (7)

Unit · Results (step 8): numbers computed from leads, threads and meetings

- KPIs: contacted, reply rate, meetings, follow-ups, time to reply
- company funnel with the share of all leads and of the step before
- only booked meetings count, not offered times
- activity per day covers the window, counting sent emails and replies
- reply intents, outcomes of contacted leads, and lead quality
- LinkedIn people get the person funnel, and platforms are compared
- no leads, no division by zero

### `results.integration.test.js` (1)

Integration (database) · Results from a real campaign

- results add up a campaign's emails, replies and meetings

### `lead-stage.test.js` (4)

Unit · The stage shown for each lead on the Find leads table

- a company lead moves New → Researched → Fit → Contacted → Replied → Meeting booked
- fit colours: strong, possible, poor
- a job post without a company name can't become a lead
- LinkedIn people: profile read or failed

### `live-services.test.js` (5)

Live (opt-in) · Real Gmail SMTP/IMAP, Groq AI, Indeed via JobSpy, embedding model

- Gmail SMTP accepts our login (no email is sent)
- Gmail IMAP: the sales mailbox can be read (counts only)
- Groq AI answers in JSON with the configured fast model
- Indeed search through JobSpy returns job posts with company names
- the local embedding model turns text into 384 numbers

### `meetings.test.js` (9)

Unit · Meeting times across time zones, free slots, offers, calendar invites, settings

- wall-clock times convert to instants in any zone, across DST
- free slots respect working hours, notice and the horizon
- booked meetings and their buffer are kept free
- the offer spreads three times over different days, morning and afternoon
- a specific time is free only inside hours, after the notice, away from bookings
- times read naturally for the client
- working hours are cleaned: bad and backwards windows are dropped
- settings are validated with safe defaults
- the calendar invite is valid iCalendar with the meeting, organiser and attendee

### `message-writer.test.js` (5)

Unit · AI message writing: recipient choice, channel, prompts

- email goes to a named HR contact first, then any named contact, then the company address
- LinkedIn goes to the first decision-maker
- default channel: email if there is an address, LinkedIn if only a person was found
- company prompt mentions the open roles, the offer and the recipient
- person prompt uses posts when there are some and says so when there are none

## Manual end-to-end tests

These were run by hand on the running app (newest at the bottom; every new check is added here) (local Postgres, Redis, the background worker, real Gmail
and Groq). Emails were redirected to the test inbox with `SALES_EMAIL_TEST_RECIPIENT`. The last column names the
automated test that now repeats it.

| # | What was tested | How | Result | Automated in |
|---|---|---|---|---|
| 1 | Indeed lead search (JobSpy) | Searched Indeed for job posts from the Find leads step | Job posts found with company details; grouped into one lead per company | `live-services` (Indeed), `companies` |
| 2 | SMTP sending and test redirect | Sent test emails through Gmail | 2 test emails arrived at the test inbox with "[TEST]" and a banner naming the real recipient | `email`, `live-services` (SMTP) |
| 3 | Sales agent, Semi-auto | Campaign "Agent Test - Indeed Semi-auto": found 4 companies | 2 nameless posts skipped; Zoho scored 60, Ghani 30 (skipped); Zoho email written and held for approval; approved after adding an address; sent | `agent-flow` (Semi-auto) |
| 4 | Sales agent, Auto | "Indeed Test Campaign", 20 companies, email limit 2 | ABS International emailed without asking; 13 companies with no email address held for a person | `agent-flow` (Auto, daily limit) |
| 5 | AI rate limit | Many AI calls in a row on Groq's free tier | Rate-limited work retried after a minute instead of failing | Not automated (needs the real AI's limit) |
| 6 | Knowledge base retrieval | Asked 4 questions about the sample company profile | Senior developer rate ($4,000/month), NDA policy and logistics case study found and answered; "blockchain audits" correctly reported as not covered | `knowledge-search` |
| 7 | Reading the mailbox | Logged in to Gmail over IMAP | Mailbox read in about 3.6 s (counts only) | `live-services` (IMAP), `conversation-flow` (inbox) |
| 8 | Reply → answer → meeting | A reply to the Zoho email: "Price? NDA? Monday 3pm?" | Agent answered from the knowledge base, recognised Monday 3 pm as free, asked for approval (Semi-auto); after approval sent the answer in the same Gmail thread with a calendar invite; meeting booked; lead "Meeting booked"; run finished | `conversation-flow` (Semi-auto booking) |
| 9 | Screens | Opened Conversations, Meetings and Knowledge base in the browser | All render with live data: thread, meeting banner, booked meeting card, knowledge entries and Ask box | (visual check) |
| 10 | Sales agent page redesign | Opened Sales agent in the browser with one paused Auto run and one finished run | Summary strip (1 working, 17 awaiting you, 2 contacted, 1 reply, 1 meeting), approval callout with Review button, step tracker, stat tiles; the earlier run shows as one row and expands on click | (visual check) |
| 11 | Outreach › Indeed (companies) | Opened Outreach for "Indeed Test Campaign" (20 companies) | Stats (0 ready, 0 / 2 sent today, 1 waiting), test-mode and agent notices, filters "Not approved yet 19" and "Waiting for reply 1", 19 rows marked "Needs an address" with "Agent is asking you" | `outreach.integration` (board statuses) + visual check |
| 12 | Conversations page redesign | Opened Conversations (all campaigns: Zoho and ABS threads) in the browser | Stat tiles (2 emailed, 0 needs you, 1 replied · 50%, 1 meeting) that filter the inbox; split pane with avatars, status dots and previews; the first conversation opens by itself; thread header, meeting banner, email-style messages with day separators, newest at the bottom; reply box pinned at the bottom. Found and fixed: faint avatar initials, times shown as "0:02", "checked now ago" | (visual check) |
| 13 | Results page redesign | Opened Results › Indeed for "Agent Test - Indeed Semi-auto" (dark theme) | 6 KPIs (4 companies, 1 contacted, 100% reply rate, 1 meeting, 57 min to reply, 0 follow-ups), funnel Found 4 → Researched 2 → Good fit 1 → … → Meeting 1 with step conversion, 14-day activity chart, reply intents, outcomes, lead quality. Found and fixed: the "Poor" fit bar had no colour (class name defined outside Tailwind's scanned folders) | `results.test`, `results.integration` + visual check |
| 14 | Find leads redesign + live Indeed search | Opened Find leads › Indeed for "Agent Test - Indeed Semi-auto", then ran the "Flutter developer" quick search for real (nothing added to the campaign) | Search card with icon inputs, country, "Posted" chips, results count and quick searches; real results: 25 job posts from 19 companies with logos/initials, role, location, posted date, salary and job type; nameless posts left unticked. Campaign table with stage pills: "Fit 30", "Meeting booked", "No company". Colours checked in the page | `lead-stage.test` + visual check |
| 15 | Knowledge base redesign + real question | Opened Knowledge base (sample data), opened the Add dialog, filtered by topic, and asked "Can you sign an NDA?" for real | Stats (6 entries, 22 passages, 6/6 topics covered, last updated), subtle sample notice, topic list with counts and "missing" flags, searchable entry list, Add dialog with Write / Upload / Web page. The answer came from the knowledge base ("Yes, we can sign an NDA…") using the FAQ passage, which now matches at 0.67 (0.56 before the FAQ chunking fix) | `knowledge-search.integration` + visual check |
| 16 | Campaigns page redesign | Opened Campaigns with the two test campaigns | Totals (2 campaigns · 1 active · 1 with an agent, 26 leads, 2 contacted, 1 replied · 50%, 1 meeting), status filter and search, cards with status, platform chips with lead counts, Leads / Contacted / Replied / Meetings, outreach bar ("1 of 22 contacted") and "Agent Auto · paused". Found and fixed: the Indeed "Id" badge had no colour on every page (its class lives in `libs/platforms/`, not scanned by Tailwind) | `campaign-overview.test` + visual check |
| 17 | Rozee.pk job search (investigation) | Ran the existing Rozee.pk scraper ("react developer", Lahore, 5 results) without an account, then opened the search page in a headless browser to see why | **Not working:** 0 jobs. Rozee.pk answers automated browsers with Cloudflare's bot check (HTTP 403, "Just a moment… Performing security verification"), so the job list is never reached. Rozee needs a different approach from Indeed (see the Rozee.pk plan) | Not automated yet (to be added to `live-services` when Rozee search is rebuilt) |

## Problems the tests found and fixed

- **Pricing questions flagged as "sensitive".** In manual test 8, a simple "how much does it cost?"
  was marked sensitive, which in Auto mode would have made the agent ask about every pricing
  question. The reading prompt now treats only negotiation, discounts and contract terms as sensitive.
- **FAQ answers were hard to find.** The retrieval test showed that "What if a developer isn't a good
  fit?" ranked a general services passage above the FAQ answer, because several FAQ answers were
  packed into one passage. Each FAQ question now starts its own passage, and the test passes.
- **Re-contacting the same company.** While writing `agent-flow`, the agent correctly refused to
  email a company already emailed from another campaign without asking. This is now a test of its own.
- **Bulk sending order.** The outreach test showed that when the daily limit cut a batch short, which
  companies were left for tomorrow depended on database order. Emails now go out in the order chosen.
- **Missing chart colours.** The Results browser check showed an empty "Poor" bar: the colour class
  was written in `libs/`, which Tailwind doesn't scan, so it was never generated. Tailwind now also
  scans `libs/sales/` and `libs/platforms/`; the Campaigns check found the same problem had hidden the
  Indeed badge colour on every page.
- **Reply subjects** could keep the "[TEST]" tag ("Re: [TEST] …"), and a removed placeholder left a
  double space. Both were fixed when the unit tests caught them.
