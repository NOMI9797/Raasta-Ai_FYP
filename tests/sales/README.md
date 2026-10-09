# Sales module tests

Automated tests for the Client Acquisition (Sales) module, **one file per step of the sales
pipeline**: campaigns, finding leads, research, messages, outreach, conversations, meetings and
results, plus the knowledge base (RAG) and the sales agent. Every check first done by hand during
development is also kept here as a repeatable test.

**189 test cases in 11 files. Latest run (9 Oct 2026): 183 passed, 0 failed, 6 live checks skipped by default. With `npm run test:sales:live` all 6 live checks pass (9 Oct 2026, with `SERPER_API_KEY`).**

## How to run

```bash
npm run test:sales                 # everything, every module (live checks are skipped)

npm run test:sales:campaigns       # 1. Campaigns
npm run test:sales:find-leads      # 2. Find leads (Rozee.pk, companies, CSV import)
npm run test:sales:research        # 3. Research
npm run test:sales:messages        # 4. Messages
npm run test:sales:outreach        # 5. Outreach
npm run test:sales:conversations   # 6. Conversations (email and LinkedIn replies)
npm run test:sales:meetings        # 7. Meetings
npm run test:sales:results         # 8. Results
npm run test:sales:knowledge       # Knowledge base (RAG)
npm run test:sales:agent           # Sales agent

npm run test:sales:live            # real Gmail, Groq, Indeed, Serper and the embedding model (needs .env.local credentials)
```

Any file can also be run directly, e.g. `npx tsx --test tests/sales/3-research.test.js`. Run from the
project folder; the database tests need Postgres running and `DATABASE_URL` in `.env.local`.

Inside each file, every part keeps its own set-up in a `describe` block (its test user, its fake AI),
so the parts don't affect each other; the database connection is closed once, at the end of the file.

- **Unit tests** check one piece of logic with fixed inputs.
- **Database tests** (sections marked "(database)") run the real agent code against the real local
  database. They create a throw-away user with campaigns and leads, and delete everything afterwards.
  The AI, the email sender, LinkedIn and the mailbox are replaced by fakes (`helpers/fixtures.js`), so
  results are repeatable and **no email or LinkedIn message is ever sent**. If the database is not
  reachable, they skip themselves.
- **Live checks** use the real accounts. Nothing is emailed: SMTP is only verified, and IMAP only
  counts recent messages.

## Summary

| File | Command | Tests | What it covers |
|---|---|---|---|
| `1-campaigns.test.js` | `npm run test:sales:campaigns` | 10 | Campaign cards, lead stages, setup guide |
| `2-find-leads.test.js` | `npm run test:sales:find-leads` | 27 | Rozee.pk search and import, one lead per company and duplicates, LinkedIn CSV import |
| `3-research.test.js` | `npm run test:sales:research` | 19 | Company websites, emails and decision-makers; LinkedIn profiles; sorting into Email / LinkedIn / No contact |
| `4-messages.test.js` | `npm run test:sales:messages` | 10 | The AI message writer; moving a company to Email or LinkedIn |
| `5-outreach.test.js` | `npm run test:sales:outreach` | 10 | Outreach status, sending within the daily limit, the email transport and test mode |
| `6-conversations.test.js` | `npm run test:sales:conversations` | 36 | Replies matched, read and answered from the knowledge base, follow-ups, meetings from replies, LinkedIn replies |
| `7-meetings.test.js` | `npm run test:sales:meetings` | 9 | Free times, calendar invites, meeting settings |
| `8-results.test.js` | `npm run test:sales:results` | 8 | The funnel and the numbers |
| `knowledge-base.test.js` | `npm run test:sales:knowledge` | 31 | Chunking, local embeddings and pgvector hybrid search, grounded answers |
| `sales-agent.test.js` | `npm run test:sales:agent` | 23 | Planner and approval policy, lead scoring, whole agent runs |
| `live-services.test.js` | `npm run test:sales:live` | 6 | Real services: Gmail SMTP/IMAP, Groq, Indeed, Serper, Rozee.pk search, embeddings (opt-in) |

## Every test case

### `1-campaigns.test.js`: Campaigns (step 1) (10)

`npm run test:sales:campaigns`. Campaign cards, lead stages, setup guide.

#### Campaign cards

Unit · The numbers on each campaign card (step 1)

- each campaign card gets leads by platform, contacted, replied and meetings
- the newest active agent run is the campaign's agent; finished runs are ignored

#### Lead stages

Unit · The stage shown for each lead on the Find leads table

- a company lead moves New → Researched → Fit → Contacted → Replied → Meeting booked
- fit colours: strong, possible, poor
- a job post without a company name can't become a lead
- LinkedIn people: profile read or failed

#### Setup guide

Unit · Sales setup guide (next step to do)

- a new user is pointed at connecting LinkedIn first
- optional steps never become the next step
- the first unfinished required step is next
- job boards are done when Indeed is set up and Rozee.pk can be searched reliably (Serper)

### `2-find-leads.test.js`: Find leads (step 2) (27)

`npm run test:sales:find-leads`. Rozee.pk search and import, one lead per company and duplicates, LinkedIn CSV import.

#### Rozee.pk search results

Unit · Rozee.pk job posts read from search-engine results (fixtures: real results captured live, DuckDuckGo on 7 Oct 2026 in `tests/fixtures/sales/rozee-search-results.json`, Google through Serper on 9 Oct 2026 in `rozee-serper-results.json`)

- only real job post URLs count: not search pages, company pages, portals or the home page
- title, cities and company are read from a full title
- a cut-off title takes the company from the URL
- a post with no company stays without one (it can't become a lead)
- pages that aren't job posts are dropped
- queries and the city filter
- search: deduplicated across queries, filtered by city, limited, in the import shape
- a job post inside a listing-page URL is found
- company, role and city from a slug, using the words searched for
- listing snippets name jobs and companies; noise is dropped
- company and role checks
- real Google results: job posts first, then one lead per company named in snippets
- searching stops at the page budget and asks for 10 results at a time
- relevance: the specific word searched for decides, generic words don't

#### Rozee.pk import (database)

Integration (database) · A Rozee.pk campaign end to end

- the agent finds companies on Rozee.pk, adds them and emails the good fits
- a Rozee.pk search needs a campaign that takes Rozee.pk leads

#### Companies: one lead per company, duplicates

Unit · Grouping job posts into one lead per company, duplicate detection

- companyKey ignores case, punctuation and legal suffixes
- groups job posts of the same company and keeps nameless posts apart
- mergeJobs skips job URLs that are already there
- jobsOf falls back to the lead's own job post
- findDuplicateCompanies keeps the oldest lead of each company

#### LinkedIn CSV import

Unit · Importing LinkedIn leads from CSV

- parseCsv keeps commas, quotes and line breaks inside quoted cells
- reads a LinkedIn export with headers, joining first and last name
- reads a plain list of URLs without a header
- skips rows without a LinkedIn profile URL

### `3-research.test.js`: Research (step 3) (19)

`npm run test:sales:research`. Company websites, emails and decision-makers; LinkedIn profiles; sorting into Email / LinkedIn / No contact.

#### Company research

Unit · Company research: website choice, emails/phones from pages, decision-makers

- dropPartialNumbers keeps the full number when the same one was also read cut short
- pickWebsite skips listing sites and prefers a domain with the company's name
- originOf keeps only the site root and accepts bare domains
- extractContacts finds emails (including Cloudflare-hidden ones), phones, socials and contact pages
- parseLinkedInResult reads name and title and ranks leadership first
- parseLinkedInResult ignores other companies and non-profile links

#### LinkedIn profile reading

Reading LinkedIn profiles with the connected account: the parts that don't need a browser.

- Profile links are cleaned (the pasted lead had `?isSelfProfile=true`)
- Reaction and comment counts as LinkedIn shows them ("58", "1,234", "1.2K")
- Post dates: "Jun 19", "Dec 21, 2025", relative "2w", ISO; unknown is now
- Scraped posts become post rows; empty ones are dropped

#### Sorting: Email, LinkedIn or No contact

How a researched company is contacted (the sorting step after research).

- An address goes to Email, a decision-maker only to LinkedIn, nothing to No contact
- A message that already has somewhere to go keeps its channel; an unaddressed email follows the research
- Recipients: named HR or leadership contacts first, a profile only with a link, junk addresses ignored

### `4-messages.test.js`: Messages (step 4) (10)

`npm run test:sales:messages`. The AI message writer; moving a company to Email or LinkedIn.

#### Message writer

Unit · AI message writing: recipient choice, channel, prompts

- email goes to a named HR contact first, then any named contact, then the company address
- LinkedIn goes to the first decision-maker
- default channel: email if there is an address, LinkedIn if only a person was found
- company prompt mentions the open roles, the offer and the recipient
- person prompt uses posts when there are some and says so when there are none

#### Move to Email / LinkedIn (database)

Moving a company out of "No contact" on the Messages step (real database, fake AI).

- A company with no contact gets no message written
- Move to Email: the address is saved and an email to it is written
- Move to LinkedIn: the profile is saved as a decision-maker and a LinkedIn message is written
- Bad contacts are refused and nothing changes

### `5-outreach.test.js`: Outreach (step 5) (10)

`npm run test:sales:outreach`. Outreach status, sending within the daily limit, the email transport and test mode.

#### Outreach status

Unit · Where each company stands on the Outreach step, and the filters

- before sending: not written, needs an address, draft, ready, failed
- after sending, the conversation decides the status
- every status belongs to exactly one filter (besides All)

#### Sending (database)

Integration (database) · Sending first emails by hand on the Outreach step

- the board shows where every company stands
- sending by hand: approves drafts, starts the thread, stops at the daily limit
- a failed send is recorded, and an email without an address isn't tried

#### Email transport and test mode

Unit · Sending sales email, test-mode redirect

- sends to the real recipient when no test address is set
- redirects to the test address, marks the subject and names the intended recipient
- refuses invalid addresses and empty bodies
- renderEmail escapes HTML and keeps paragraphs

### `6-conversations.test.js`: Conversations (step 6) (36)

`npm run test:sales:conversations`. Replies matched, read and answered from the knowledge base, follow-ups, meetings from replies, LinkedIn replies.

#### Replies: matching, reading, planning, writing

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

#### Conversations end to end (database)

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

#### Replies on LinkedIn

- A meeting confirmed on LinkedIn never claims a calendar invite is attached

#### LinkedIn replies

LinkedIn replies: the parts that don't need a browser.

- The conversation is found by the person's name; a "You:" preview means nothing new
- Only the person's messages after our first message count as replies

#### A LinkedIn conversation (database)

- A LinkedIn reply is read once (the same message id is never recorded twice), and the agent answers it
  from the knowledge base **on LinkedIn**, not by email: thread outreach → reply → answer, all LinkedIn

### `7-meetings.test.js`: Meetings (step 7) (9)

`npm run test:sales:meetings`. Free times, calendar invites, meeting settings.

#### Meetings

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

### `8-results.test.js`: Results (step 8) (8)

`npm run test:sales:results`. The funnel and the numbers.

#### Results

Unit · Results (step 8): numbers computed from leads, threads and meetings

- KPIs: contacted, reply rate, meetings, follow-ups, time to reply
- company funnel with the share of all leads and of the step before
- only booked meetings count, not offered times
- activity per day covers the window, counting sent emails and replies
- reply intents, outcomes of contacted leads, and lead quality
- LinkedIn people get the person funnel, and platforms are compared
- no leads, no division by zero

#### Results from the database

Integration (database) · Results from a real campaign

- results add up a campaign's emails, replies and meetings

### `knowledge-base.test.js`: Knowledge base (RAG) (31)

`npm run test:sales:knowledge`. Chunking, local embeddings and pgvector hybrid search, grounded answers.

#### Knowledge base

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

#### Search with the real embedding model and pgvector

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

### `sales-agent.test.js`: Sales agent (23)

`npm run test:sales:agent`. Planner and approval policy, lead scoring, whole agent runs.

#### Planner and policy

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

#### Lead scoring

Unit · AI fit scoring of leads (prompt and score handling)

- the prompt for a company carries its roles, size, website text and the offer
- scores are clamped to 0-100 and a missing score is an error
- scoreLead reads the model's JSON

#### Agent runs end to end (database)

Integration (database) · The agent works a campaign end to end: research → score → write → ask/send

- Semi-auto: prepares every lead, skips a poor fit, and asks before sending
- Auto: sends on its own, but still asks when there is no email address
- Auto respects the daily email limit: the rest wait for tomorrow
- A company already emailed from another campaign is never emailed again without asking

### `live-services.test.js`: real services (opt-in)

`npm run test:sales:live`.

Live (opt-in) · Real Gmail SMTP/IMAP, Groq AI, Indeed via JobSpy, embedding model

- Gmail SMTP accepts our login (no email is sent)
- Gmail IMAP: the sales mailbox can be read (counts only)
- Groq AI answers in JSON with the configured fast model
- Indeed search through JobSpy returns job posts with company names
- the local embedding model turns text into 384 numbers
- Rozee.pk job posts through the configured web search (reliable with SERPER_API_KEY)

### Screenshots

`screenshots/e2e-01…e2e-11`: the browser end-to-end run (manual tests 25-31, 37): starting the agent, the
run working, Approvals (missing address, Regenerate, approving Dextrologix), Messages (No contact and
LinkedIn sections) and Research (missing emails, Alphabet Global researched again).

## Manual end-to-end tests

These were run by hand on the running app (newest at the bottom; every new check is added here) (local Postgres, Redis, the background worker, real Gmail
and Groq). Emails were redirected to the test inbox with `SALES_EMAIL_TEST_RECIPIENT`. The last column names the
automated test that now repeats it.

| # | What was tested | How | Result | Automated in |
|---|---|---|---|---|
| 1 | Indeed lead search (JobSpy) | Searched Indeed for job posts from the Find leads step | Job posts found with company details; grouped into one lead per company | `live-services` (Indeed), `2-find-leads` (companies) |
| 2 | SMTP sending and test redirect | Sent test emails through Gmail | 2 test emails arrived at the test inbox with "[TEST]" and a banner naming the real recipient | `5-outreach` (email), `live-services` (SMTP) |
| 3 | Sales agent, Semi-auto | Campaign "Agent Test - Indeed Semi-auto": found 4 companies | 2 nameless posts skipped; Zoho scored 60, Ghani 30 (skipped); Zoho email written and held for approval; approved after adding an address; sent | `sales-agent` (agent-flow) (Semi-auto) |
| 4 | Sales agent, Auto | "Indeed Test Campaign", 20 companies, email limit 2 | ABS International emailed without asking; 13 companies with no email address held for a person | `sales-agent` (agent-flow) (Auto, daily limit) |
| 5 | AI rate limit | Many AI calls in a row on Groq's free tier | Rate-limited work retried after a minute instead of failing | Not automated (needs the real AI's limit) |
| 6 | Knowledge base retrieval | Asked 4 questions about the sample company profile | Senior developer rate ($4,000/month), NDA policy and logistics case study found and answered; "blockchain audits" correctly reported as not covered | `knowledge-base` (knowledge-search) |
| 7 | Reading the mailbox | Logged in to Gmail over IMAP | Mailbox read in about 3.6 s (counts only) | `live-services` (IMAP), `6-conversations` (conversation-flow) (inbox) |
| 8 | Reply → answer → meeting | A reply to the Zoho email: "Price? NDA? Monday 3pm?" | Agent answered from the knowledge base, recognised Monday 3 pm as free, asked for approval (Semi-auto); after approval sent the answer in the same Gmail thread with a calendar invite; meeting booked; lead "Meeting booked"; run finished | `6-conversations` (conversation-flow) (Semi-auto booking) |
| 9 | Screens | Opened Conversations, Meetings and Knowledge base in the browser | All render with live data: thread, meeting banner, booked meeting card, knowledge entries and Ask box | (visual check) |
| 10 | Sales agent page redesign | Opened Sales agent in the browser with one paused Auto run and one finished run | Summary strip (1 working, 17 awaiting you, 2 contacted, 1 reply, 1 meeting), approval callout with Review button, step tracker, stat tiles; the earlier run shows as one row and expands on click | (visual check) |
| 11 | Outreach › Indeed (companies) | Opened Outreach for "Indeed Test Campaign" (20 companies) | Stats (0 ready, 0 / 2 sent today, 1 waiting), test-mode and agent notices, filters "Not approved yet 19" and "Waiting for reply 1", 19 rows marked "Needs an address" with "Agent is asking you" | `5-outreach` (outreach) (board statuses) + visual check |
| 12 | Conversations page redesign | Opened Conversations (all campaigns: Zoho and ABS threads) in the browser | Stat tiles (2 emailed, 0 needs you, 1 replied · 50%, 1 meeting) that filter the inbox; split pane with avatars, status dots and previews; the first conversation opens by itself; thread header, meeting banner, email-style messages with day separators, newest at the bottom; reply box pinned at the bottom. Found and fixed: faint avatar initials, times shown as "0:02", "checked now ago" | (visual check) |
| 13 | Results page redesign | Opened Results › Indeed for "Agent Test - Indeed Semi-auto" (dark theme) | 6 KPIs (4 companies, 1 contacted, 100% reply rate, 1 meeting, 57 min to reply, 0 follow-ups), funnel Found 4 → Researched 2 → Good fit 1 → … → Meeting 1 with step conversion, 14-day activity chart, reply intents, outcomes, lead quality. Found and fixed: the "Poor" fit bar had no colour (class name defined outside Tailwind's scanned folders) | `8-results` (results), `8-results` (results) + visual check |
| 14 | Find leads redesign + live Indeed search | Opened Find leads › Indeed for "Agent Test - Indeed Semi-auto", then ran the "Flutter developer" quick search for real (nothing added to the campaign) | Search card with icon inputs, country, "Posted" chips, results count and quick searches; real results: 25 job posts from 19 companies with logos/initials, role, location, posted date, salary and job type; nameless posts left unticked. Campaign table with stage pills: "Fit 30", "Meeting booked", "No company". Colours checked in the page | `1-campaigns` (lead-stage) + visual check |
| 15 | Knowledge base redesign + real question | Opened Knowledge base (sample data), opened the Add dialog, filtered by topic, and asked "Can you sign an NDA?" for real | Stats (6 entries, 22 passages, 6/6 topics covered, last updated), subtle sample notice, topic list with counts and "missing" flags, searchable entry list, Add dialog with Write / Upload / Web page. The answer came from the knowledge base ("Yes, we can sign an NDA…") using the FAQ passage, which now matches at 0.67 (0.56 before the FAQ chunking fix) | `knowledge-base` (knowledge-search) + visual check |
| 16 | Campaigns page redesign | Opened Campaigns with the two test campaigns | Totals (2 campaigns · 1 active · 1 with an agent, 26 leads, 2 contacted, 1 replied · 50%, 1 meeting), status filter and search, cards with status, platform chips with lead counts, Leads / Contacted / Replied / Meetings, outreach bar ("1 of 22 contacted") and "Agent Auto · paused". Found and fixed: the Indeed "Id" badge had no colour on every page (its class lives in `libs/platforms/`, not scanned by Tailwind) | `1-campaigns` (campaign-overview) + visual check |
| 17 | Rozee.pk job search (investigation) | Ran the existing Rozee.pk scraper ("react developer", Lahore, 5 results) without an account, then opened the search page in a headless browser to see why | **Not working:** 0 jobs. Rozee.pk answers automated browsers with Cloudflare's bot check (HTTP 403, "Just a moment… Performing security verification"), so the job list is never reached. Rozee needs a different approach from Indeed: it is now searched through a search engine (rows 18-19) | `live-services` (Rozee.pk search) |
| 18 | Rozee.pk search results (probe) | Searched `site:rozee.pk "react developer" lahore` and a Flutter search through the free search engine | 18 results with a consistent title "<Role> Job, <Cities>, <Company> - ROZEE.PK" and URL "rozee.pk/<company>-<role>-<city>-jobs-<id>"; saved as the test fixture | `2-find-leads` (rozee-search) |
| 19 | Rozee.pk search in the app | Called the app's search API for Rozee.pk (no Rozee account), and opened Find leads › Rozee.pk on a temporary campaign (deleted after) | No account needed any more. The free search engine refused after earlier searches ("limiting searches… Add SERPER_API_KEY"), so live results need the Serper key. The Rozee.pk tab shows the explanation and the Serper notice; the RZ badge has its colour | `2-find-leads` (rozee) + visual check; live results pending SERPER_API_KEY |
| 20 | Rozee.pk campaign in the UI | Created "Rozee.pk - Software houses hiring in Lahore" (Rozee.pk only). The live search was still refused by the free search engine, so the 6 Lahore companies from the real search results captured earlier (row 18) were added through the app's normal import | Campaigns: card with the green "RZ Rozee 6" chip and 6 leads. Find leads › Rozee.pk: Tecaudex, Veysel Enterprises, Alphabet Global, Systems Ltd, Terasols, Dextrologix with roles, cities and "New" stage. Research › Rozee.pk: "0 of 6 companies researched" with Research buttons and the Serper notice. Results was loading when the user took over the browser | `2-find-leads` (rozee) + visual check |
| 21 | Merge of hiring and sales into `main` | Merged `feature/ai-hiring-pipeline` (fast-forward) and `sales-pipeline` into `main`, resolved 7 conflicts, renumbered the sales migrations to 0016-0020, applied the hiring migrations 0014-0015 locally, then ran everything | Hiring tests 436/436, sales tests 145 passed / 0 failed (6 live skipped), branding check passed, production build succeeded (222 routes), no new lint errors. The app started on the merged code with the worker; Home, Recruiter jobs, Recruiter agent, Sales campaigns, Conversations, Sales agent and the sales/notification APIs all answered 200 | `npm run test:hiring`, `npm run test:sales`, build + smoke check |
| 22 | Serper key and Google results (probe) | Added `SERPER_API_KEY`, searched `site:rozee.pk` for React developers in Lahore through Serper directly, and tried several query shapes | The key works (10 results, 1 credit). Found: **the free plan refuses more than 10 results per search** ("Query pattern not allowed for free accounts"), page 2 is allowed; **Google returns mostly Rozee search-listing pages**, not individual job posts, whose snippets name jobs and companies. Saved as the Google fixture | `2-find-leads` (rozee-search) (Google fixture) |
| 23 | Live Rozee.pk search in the app (with Serper) | Searched Rozee.pk for "flutter developer" in Lahore through the app, before and after fixing what the first run showed (search only, nothing added) | First run: 22 results in 13 s, but slug-based posts split badly ("Innovative Software Solution Angularjs \| Developer") and listing pages added off-topic jobs ("Business Development Manager"). After the fix: 8 results, all real Lahore companies hiring Flutter developers (4xp Tech, IR-Tech Solutions, Nexsoll, BrightBench Labs, InventorX, Naseeb Enterprise, Joblogic, RFZ Digital) | `2-find-leads` (rozee-search) (relevance, slug split) + `live-services` |
| 24 | Live company research (with Serper) | Researched Systems Ltd (Rozee.pk campaign) through the app | Done in about 7 s: website systemsltd.com, 2 email addresses, 4 decision-makers including Talent Acquisition staff | `live-services` (search) |
| 25 | Sales agent run from the browser (Rozee.pk, first try) | Started the agent from Sales agent › New agent run: Rozee.pk campaign, Semi-auto, "Find new companies" on (React developer, Lahore, 10 posts), then watched the run card and the activity log | The agent searched, researched, scored and wrote emails on its own and asked before sending. It also showed six problems: (1) "Nessovo", "Nessovo solutions" and "Nessovo Technologies" added as 3 companies; (2) names like "Jma Resources Javascript" and "Technodevs Senior Reactjs Front End"; (3) Java jobs on a React search, because **the background worker was still running code from before the last change** (it doesn't reload; the web pages do); (4) the activity log never refreshed; (5) "11 need approval" next to "16 waiting" after a pause; (6) "LLM rate limit reached" for one company (retried after a minute by design). Run paused, then stopped from the UI | `2-find-leads` (companies), `2-find-leads` (rozee-search) (slug split), visual check |
| 26 | Research quality of the agent's run | Read every researched company on Research › Rozee.pk and compared it with live Serper results (saved as `tests/fixtures/sales/website-search-results.json`) | 7 of 21 had the wrong website or bad emails: Alphabet Global (Lahore) → alphabet.com, a German leasing firm, with **bewerber.hotline@bmw.de**; Computer House → asifcomputers.com (the first result, no name match); InventorX and Veysel → UK Companies House; Nessovo → bebee.com; placeholder emails `youremail@mail.com`, `neuros@mail.co`. Fixed (see below) and checked against the saved results | `3-research` (company-research) (4 new), `sales-agent` (agent-plan) (unconfirmed website) |
| 27 | Combine duplicates from the UI | Research › Rozee.pk after the company-key fix | The page offered "2 job posts belong to companies already in this list. Combine"; one click → "Combined 2 job posts into their companies", Nessovo became one company with 3 jobs (21 companies) | `2-find-leads` (companies) (Nessovo) |
| 28 | Sales agent run from the browser (clean re-run) | Reset the Rozee campaign's research and the 15 unsent drafts, corrected the 3 bad names, restarted the server (so the worker runs the new code), started a new Semi-auto run with the same search | Search: "Added 3 companies, 1 job post added to companies already in the campaign, skipped 6 duplicates" (no duplicates this time; new: WorkForge, Miletap, MTBC CareCloud). The activity log updated by itself. Research: Dextrologix now found (dextrologix.com, was "not found"), Computer House and BrightBench left without a website instead of a wrong one, Alphabet Global flagged "check the website". Within 2 minutes: 18 researched, 12 scored, 8 emails written and waiting for approval | visual check + database check |
| 29 | Approvals: approve one email, regenerate | Sales agent › Approvals: pressed Approve on an email with no address, then Regenerate | Approve used to be greyed out with no explanation when the address was missing. Now it can be pressed: "Add the email address to send it to, then approve", the To field turns red and gets the cursor. Regenerate (new) rewrote the email ("Supporting your Junior Kafka Engineer hires", new body) and showed "Rewritten: check it, then approve". Screenshots `screenshots/e2e-04…`, `e2e-05…` | visual check |
| 30 | How many companies have an email | Counted the researched companies in the database | Rozee.pk campaign: 10 of 24 with an email (42%); of the 14 without, 9 had a decision-maker on LinkedIn and 4 a website. Without a LinkedIn account the agent wrote **email** to all of them, so ~60% were emails with no address | `3-research` (contact-route), `sales-agent` (agent-plan) |
| 31 | Sorting after research: Email, LinkedIn, No contact | Restarted the server, woke the running agent, then opened Messages from the run card's "Move them to Email or LinkedIn" link | The agent sorted the 24 companies: 10 Email (waiting for approval), 9 LinkedIn (a message to the decision-maker, e.g. IR-Tech Solutions → their LinkedIn profile, waiting for a LinkedIn account), 5 No contact (Alphabet Global, BrightBench Labs, Veysel Enterprises, WorkForge…: "moved to No contact (nothing written)", their old address-less drafts withdrawn from Approvals). Messages shows three sections with counts; a No contact company shows what research found, links to search the web / LinkedIn, and **Move to Email / Move to LinkedIn** (add the address or profile, the message is written). Screenshots `e2e-06…`, `e2e-07…` | `sales-agent` (agent-flow), `4-messages` (contact) (4) |
| 32 | Second reply in Auto (user's own test from the UI) | Started an Auto run on the Rozee campaign, replied twice from Gmail to the EcoEdge AI email | The agent answered both within 5 s of each reply (the second with three meeting times), but the open conversation still showed "The agent answers this on its next run": **the open thread loaded once and never refreshed**. It now refreshes every 15 s. Also asked for: a run used to finish on its own once every lead was dealt with, after which a new reply waited; **a run now stays active until stopped by hand** (one notification when every lead is contacted) | `6-conversations` (conversation-flow) (updated) |
| 33 | LinkedIn flow with the connected test account | Connected the LinkedIn account on Platforms (the user), pasted one profile into a LinkedIn campaign, started an Auto agent with the account. The agent used to stop with "Read this lead's profile in Research › LinkedIn (the agent doesn't read profiles yet)"; no Apify token was set, so the manual Scrape button couldn't work either. Built profile reading with the connected account and ran it | Dry run first (nothing saved): session valid, but **LinkedIn's 2026 layout broke the old selectors** (random class names, no `<h1>`, no post markers), and page code failed under the worker (`__name is not defined`). After the fix: name, headline and 5 posts with dates and reactions (58, 2, 11, 9) in 24 s. Then the agent, live: read the profile → scored 70/100 → wrote a LinkedIn message → **sent the connection invite (sent 1, failed 0)**. The first message read as if *we* needed help (the campaign had no offer); messages now write as the seller and use our services from the knowledge base. | `3-research` (linkedin-research) (4), `sales-agent` (agent-flow) (LinkedIn people), `4-messages` (message-writer) (offer) |
| 34 | LinkedIn: acceptance → message (the user accepted the invite) | The agent checks acceptances every 4 hours; the last-check time was cleared and the agent woken | "Checked LinkedIn: 1 new connection", lead *accepted*. Sending the message then failed three times, each fixed and retried: (1) the compose page waited for `networkidle`, which LinkedIn never reaches → timeout; (2) the Send button wasn't found: only the first match of each selector was checked; (3) Send was checked before LinkedIn enabled it. A dry run that stopped before Send showed the typed message and an active Send button in the form. After the fixes: **"Message sent successfully to Nouman Ahmed!"**, message *sent*. Line breaks are now typed with Shift+Enter, so an account with "Press Enter to send" can't send half a message | worker log, database check |
| 35 | LinkedIn replies and "Check LinkedIn now" (built and checked live, read-only) | Looked at the live messaging page of the test account; started Nouman's LinkedIn thread (his message went out before LinkedIn was in threads); ran the reply reader against the real inbox | Messaging keeps LinkedIn's stable `msg-*` markup: conversation list (name, preview) and messages with a unique `data-event-urn` and "X sent the following messages" headings. Our message to Nouman appears **once** (no partial duplicate from the earlier retries). The reader found his conversation, saw the "You:" preview and correctly reported nothing new, in 13 s. Thread: *awaiting reply*, first follow-up 12 Oct | `6-conversations` (linkedin-inbox) (2), `linkedin-conversation.integration` (1) |
| 36 | LinkedIn reply answered live | The user replied from Nouman's LinkedIn ("Happy to connect with you..We can discuss on this and can make a fruitful collaboration") after the agent's last check; pressed **Check LinkedIn now** (its API) | 03:38:45 the reply was read into the thread (channel linkedin); 03:39:00 the agent answered **on LinkedIn** from the knowledge base (free 30-minute discovery call, three times, NDA and code ownership); conversation *meeting proposed*. The answer greeted him "**Hi QA**": with no sign-off in his message the reply-reader took *our* sign-off from the thread. Our own name is now never used, and on LinkedIn the profile name is | `6-conversations` (conversation) (greeting) |
| 37 | LinkedIn meeting booked + source tags on Conversations | The user picked a time from Nouman's LinkedIn; then Conversations was checked after adding a source tag to each conversation | The agent confirmed the meeting **on LinkedIn** ("Hi Nouman, …", Mon 12 Oct 11:30, 30 min), conversation *meeting booked*: the greeting fix works. Each conversation now shows where the lead came from (in LinkedIn / RZ Rozee.pk / Id Indeed chip) and how we talk to them (mail or LinkedIn icon); the header shows the same. The check found: the list didn't load the channel (Nouman showed as email), the LinkedIn confirmation said "A calendar invite is attached" (LinkedIn can't carry one), and the counter said "Emailed" while counting LinkedIn messages: all fixed ("Contacted"). Screenshot `e2e-11…` | `6-conversations` (replies on LinkedIn) |

## Problems the tests found and fixed

- **Pricing questions flagged as "sensitive".** In manual test 8, a simple "how much does it cost?"
  was marked sensitive, which in Auto mode would have made the agent ask about every pricing
  question. The reading prompt now treats only negotiation, discounts and contract terms as sensitive.
- **FAQ answers were hard to find.** The retrieval test showed that "What if a developer isn't a good
  fit?" ranked a general services passage above the FAQ answer, because several FAQ answers were
  packed into one passage. Each FAQ question now starts its own passage, and the test passes.
- **Re-contacting the same company.** While writing `sales-agent` (agent-flow), the agent correctly refused to
  email a company already emailed from another campaign without asking. This is now a test of its own.
- **Bulk sending order.** The outreach test showed that when the daily limit cut a batch short, which
  companies were left for tomorrow depended on database order. Emails now go out in the order chosen.
- **Missing chart colours.** The Results browser check showed an empty "Poor" bar: the colour class
  was written in `libs/`, which Tailwind doesn't scan, so it was never generated. Tailwind now also
  scans `libs/sales/` and `libs/platforms/`; the Campaigns check found the same problem had hidden the
  Indeed badge colour on every page.
- **Rozee.pk company names from URLs.** The parser test showed that "Senior React.js Developer" didn't
  line up with the URL "senior-reactjs-developer" (Rozee drops the dot), so the company was lost when the
  title was cut short. Titles and URLs are now compared without punctuation.
- **Serper's free plan and Google's results.** Live checks showed the free plan refuses more than 10
  results per search, and that Google returns Rozee search-listing pages rather than job posts. Searches
  now ask for 10 at a time (with a second page), read companies from listing snippets, and only keep
  slug and snippet results that mention the specific word searched for (so "developer" alone no longer
  splits "...-angularjs-developer" into a company "...Angularjs" and the role "Developer").
- **Reply subjects** could keep the "[TEST]" tag ("Re: [TEST] …"), and a removed placeholder left a
  double space. Both were fixed when the unit tests caught them.
- **The background worker ran old code** (manual test 25). The worker that runs the agent starts with
  the server and doesn't reload when code changes, so the agent searched Rozee.pk with code from before
  the relevance fix. After changing agent code, restart the server (`npm run dev`) before testing.
- **One company added three times.** "Nessovo", "Nessovo solutions" and "Nessovo Technologies" had
  different company keys. Keys now drop trailing words like Solutions, Technologies or Systems (never the
  whole name, never down to under 4 letters), and leads are compared by a key worked out from the name
  now, not one stored by an older version.
- **Job titles inside company names.** For a URL like `jma-resources-javascript-developer-react-js-lahore`
  the split was at "react", giving "Jma Resources Javascript". The role now starts at its first role word
  (seniority, technology or role), so the company is "Jma Resources"; "reactjs" counts as React, and
  Rozee's own posts are named "Rozee.pk".
- **Wrong company websites** (manual test 26). Research took the first search result when no domain
  matched, and matched on the first word only. Now the domain must carry the company's name (the whole
  name, all its words, or its distinctive word with a sign it's in Pakistan); registries and job sites
  are never taken; another country's domain ranks lower. A wrong website is worse than none, because its
  emails get written to. When nothing ties the website to Pakistan, the Research page says "Check this is
  the company's website" and **the agent asks before emailing it, even in Auto**.
- **Junk emails.** Placeholder addresses and addresses of other companies shown on a site (BMW's on
  alphabet.com) are dropped; the company's own domain and free mailboxes are kept.
- **Activity log and approval count.** The log was read once when opened; it now refreshes every 5
  seconds while the run works. A run paused mid-step kept its old approval count; it now stays current.
- **Approve was disabled without saying why** (manual test 29), and there was no way to get a new
  version of an email. Approve now explains what's missing, and first emails have a Regenerate button.
- **Most companies had no email, and got an email anyway** (manual tests 30-31). Without a LinkedIn
  account the agent forced every company to email, so ~60% were emails with no address. After research
  each company is now sorted (`libs/sales/contact-route.js`): an address → an email; no address but a
  decision-maker on LinkedIn → a LinkedIn message; neither → **No contact**, where nothing is written until
  a person adds an address or a profile (Messages › No contact › Move to Email / LinkedIn). Research also
  looks harder for an address first: more website pages (careers, privacy) and a web search for
  "@theirdomain". Contacts a person adds survive a new research run.
- **LinkedIn people were never read by the agent** (manual test 33). Profiles are now read with the
  connected account (`libs/sales/linkedin-research.js`): one browser session from the saved cookies, the
  name and headline from the page title and text, posts from the activity page's "Feed post" blocks
  (LinkedIn's 2026 layout has random class names), 6-14 s between profiles, at most 15 a day. Page code is
  passed as text because the worker runs under tsx. The older scraper stays as a fallback.
- **Messages with no offer wrote as the buyer.** With an empty campaign offer the AI wrote "I'm building a
  small AI tool and wrestling with…". Messages now always write as the seller and use the company's
  services from the knowledge base when the campaign doesn't say what we sell.
- **LinkedIn messages couldn't be sent in the 2026 layout** (manual test 34). The compose page never
  reaches network idle (live connections), so navigation now waits for the page and the message box; the
  Send button is chosen among all matches (visible, active, labelled "Send", inside the form) and looked for
  again for a few seconds, because LinkedIn enables it just after the last keystroke.
- **LinkedIn replies were never read** (manual test 35). LinkedIn messages are now part of the lead's
  thread (channel `linkedin`): the agent reads replies with the connected account every 15 minutes while a
  LinkedIn conversation is open (or at once with **Check LinkedIn now** on the run card, which also checks
  accepted invites), answers them from the knowledge base and sends the answer on LinkedIn; follow-ups and
  replies written by hand on the Conversations page go on LinkedIn too. A meeting confirmed on LinkedIn
  has its time and link in the message (LinkedIn can't carry a calendar invite).
- **Greeting the client with our own name** (manual test 36). A reply without a sign-off made the AI take
  the name from our own message ("Hi QA" to Nouman). The sender's own first name is never used as theirs;
  on LinkedIn, or for a person lead, the profile name is used instead.
- **LinkedIn confirmations promised a calendar invite** (manual test 37). The reply prompt always said
  "a calendar invite is attached"; on LinkedIn it now writes a LinkedIn message and never mentions an
  attachment (the time and link are in the text).

