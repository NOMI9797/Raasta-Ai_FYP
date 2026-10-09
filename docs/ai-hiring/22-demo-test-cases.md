# 22 · Demo test cases and how they were evaluated

`npm run demo:tests` runs **100 test cases** that walk the hiring pipeline from the first application to the recruiter's final decision, and prints for every case what it checks, what was expected and what actually happened. It is built to be run in front of an audience (supervisor, evaluation day). It does not replace `npm run test:hiring` (the developer suite: 518 tests, about 8 minutes); it is the curated, readable, fast subset that proves the pipeline's promises.

Code: [`tests/demo/`](../../tests/demo/). Inputs: the fixture job and resumes in [`tests/fixtures/`](../../tests/fixtures/) (made-up people only).

## 1. How to run it

| Command | What runs | Needs | Takes |
|---|---|---|---|
| `npm run demo:tests` | Stages 1–5 (72 cases): **real code, fake AI / e-mail / queue / clock** | nothing: no database, no network, no keys | about 5 s |
| `npm run demo:tests -- --db` | + stage 6 (21 cases): one candidate through **real Postgres** with throw-away data | `DATABASE_URL` in `.env.local`, database running | + about 1–4 s |
| `npm run demo:tests -- --live` | + stage 7 (7 cases): the **real language model** | `GROQ_API_KEY`; sends only the synthetic fixtures | + about 3½–4 min on Groq's free tier (it waits out the per-minute limit) |
| `npm run demo:tests -- --all` | stages 1–7 | all of the above | about 4–5 min |
| `npm run demo:tests -- --stage 3,4` | only those stages | | |
| `npm run demo:tests -- --list` | print the catalogue, run nothing | | |
| `--brief` / `--verbose` | one line per case / also show the requirement and input | | |
| `--pace 400` | pause 400 ms between cases, to talk through a demo | | |
| `--json r.json` / `--markdown r.md` | save the results (the Markdown is a ready table for the report) | | |
| `npm run demo:mutations` | "can these tests actually fail?" check, section 4.4 | database (for 7 of its 31 checks) | about 6 min |

The exit code is 0 only if every case passed. A case that cannot run here (no database, no key) is shown as **SKIP**, never as a pass.

A case looks like this on screen:

```
  PASS  S5-04  Communication score with voice, eye contact and composure: the doc 11 worked example 0 ms
        expected: 0.30×100 + 0.30×77.6 + 0.25×80 + 0.15×80 = 30 + 23.28 + 20 + 12 = 85.28 → 85
        observed: score 85, parts {"pace":100,"fluency":78,"eyeContact":80,"composure":80}
```

## 2. The seven stages

| Stage | Pipeline step | Real code under test | Replaced by a fake |
|---|---|---|---|
| 1 | Resume intake and AI screening | file validation; PDF, DOCX and TXT text extraction on the real fixture files; the fit scorer's clean-up and safety checks; retry rules | the language model's answer (scripted JSON) |
| 2 | Shortlist, settings, status machine | `decideShortlist`, settings validation and defaults, the candidate status machine | nothing (pure logic) |
| 3 | Invitation and link security | link creation and hashing, interview tickets (signed, expiring), the candidate e-mails, the access error table | the server secret (a demo value) |
| 4 | The AI interview conversation | the `InterviewSession` loop: turn taking, silence, follow-ups, time budget, English-only rule, echo guard, "end the interview", resume; the answer analyzer and fallback scorer | the clock, speech-to-text (plain strings), text-to-speech (off), storage (writes recorded in memory), the language model (off) |
| 5 | Evaluation and final suggestion | communication, interview and final score formulas, decision rule, recommendation ladder, escalation rules | nothing (pure logic) |
| 6 | Everything above on a real database | the public apply endpoint, resume storage, screening, shortlist with its database lock, invites, link checks, the interview session writing real rows, finalisation, recruiter decisions, automation guard rails | the language model (scripted), e-mail (an array), the job queue (an array), Redis (a counter), the clock inside the interview, and the recording analysis output (inserted as data) |
| 7 | The real AI | the production paths for reading a resume, scoring fit, writing questions and scoring answers | nothing: this is Groq |

## 3. How each case is evaluated (the process)

This is the answer to "how were the tests judged?". Every case goes through the same six steps.

**Step 1: decide what must be true, from the requirements, not from the code.** Each case comes from a rule in the specification (docs 05–11) or a hard rule in `CLAUDE.md`: "the threshold is inclusive", "a human decides rejections unless `autoFinalize` is on", "candidates never see scores", "interview links are stored only as a hash". The rule is written in the case's `requirement` field (shown with `--verbose`).

**Step 2: write the expected result before running anything, and never copy it from the program's output.** The expected values have three independent sources:

1. *Formulas in the documents, calculated by hand.* The arithmetic is in the case and on screen. Example S5-04: pace 135 wpm → 100; fluency `100 − 24×0.6 − 20×0.4` = 77.6; eye contact 80; composure 80; so `0.30×100 + 0.30×77.6 + 0.25×80 + 0.15×80 = 30 + 23.28 + 20 + 12 = 85.28 → 85`. Example S4-07: the keyword fallback score of the strong answer is `0.7 × 5/6 × 100 + 0.3 × 100 = 88.3 → 88`, of the weak one `0.7 × 1/6 × 100 + 0.3 × 5/30 × 100 = 16.7 → 17`.
2. *Reading the fixture files.* For each of the eight readable resumes I read the extracted text and wrote down which of the six required skills it really shows (`EXPECTED_SKILLS` in `tests/demo/fixtures.js`). For example Hamza Sheikh shows Docker, AWS and Linux, and not Kubernetes, CI/CD or Terraform.
3. *Fixed product rules.* 5 MB upload limit, 72-hour invite, 10-minute ticket, threshold 70, cap of 3, at most 2 follow-ups.

**Step 3: run the real code and fake only the edges.** The decision logic is never replaced. Only the things that would make a test slow, random or dangerous are faked (table in section 2). That is why the offline stages are repeatable and need no internet.

**Step 4: compare strictly and show the evidence.** Each case uses strict assertions (`assert.equal`, `assert.deepEqual`; the only tolerance is floating-point rounding). The case returns a sentence built from the values it really observed, printed under the expected line. A failed assertion prints the difference and the exit code becomes 1.

**Step 5: guard rails that make a "pass" trustworthy.**

- *Network tripwire.* In stages 1–5 any call to the language model throws and is counted. The summary prints `Language-model calls attempted by the offline stages: 0`, and the run fails if it is not 0. This proves the offline claim instead of assuming it.
- *Read back from the database.* Stage 6 does not trust return values. After each step it selects the rows again (candidate status, interview status, stored hash, final score) and compares those.
- *Throw-away data and proof of clean-up.* Stage 6 creates one new recruiter (id prefix `demo-hiring-`) and everything hangs under it. S6-21 deletes the recruiter and counts the rows left in seven tables (all must be 0). A start-up sweep removes leftovers of an earlier run that was killed.
- *No secrets printed.* Keys are only checked for presence; nothing from `.env.local` is written to the output or to disk.

**Step 6: an AI is not deterministic, so stage 7 checks properties, not exact scores.** The real model may give 96 today and 100 tomorrow. So the live cases assert things that must hold for any reasonable answer: average(strong) − average(partial) ≥ 15, the weakest strong resume scores above the best unrelated one, no unsuitable candidate is shortlisted, the same resume scored twice differs by at most 10, a strong spoken answer scores ≥ 70 and "I don't know, maybe Docker" ≤ 40. The margins are well inside the gaps seen in the runs (strong about 98, partial about 45, unrelated 0), so a normal run passes comfortably, while a model that cannot tell a DevOps engineer from an accountant would fail.

## 4. How the test cases themselves were checked

A test that always passes proves nothing. These are the checks I ran on the tests, in order, with what happened.

### 4.1 Baseline
The existing developer suite (`tests/hiring/*.test.js`) was run first: **518 tests, 518 passed, 0 failed, 7 min 45 s** (most of the time is the browser-driven posting tests). That is too slow and too noisy to show live, which is why the demo set exists. The demo set reuses the project's own helper for fake timers (`tests/hiring/helpers/fake-clock.js`) and changes no production code.

### 4.2 First run
Stages 1–5 passed on their first run (72 of 72) and so did stage 6 (21 of 21), and the hand-calculated numbers (17, 83, 85, 86, 87, 88 …) matched the program's. That is evidence the program is right, not only that the tests agree with it.

### 4.3 Repeatability
Stages 1–5 were run five times in a row. All five runs passed and every observed value was identical, except the random hash prefix that S3-02 prints (a new random link is created each run, by design).

### 4.4 Mutation check: can the tests fail?
`npm run demo:mutations` copies the code to a temporary folder (the repository is never edited), confirms the copy passes every case, then breaks it with **31 deliberate, realistic bugs**, one at a time, and records which case notices. Examples: `>=` becomes `>` in the shortlist threshold; the SHA-256 link hash becomes MD5; the outcome e-mail gains "Your score was 92%"; a score is added to what is sent to the candidate's screen; the check that stops the system deciding when automation is off is removed. A bug that no case notices is a "survivor": a hole in the tests.

| Run | Result | What it taught |
|---|---|---|
| First | 28 of 31 caught, 2 survivors, 1 bad target | see below |
| Final | **31 of 31 caught, 0 survivors** (about 6 min) | |

What the first run found, and what I changed:

- **M15 survived, a real weakness in my test.** S3-05 checked the interview ticket's lifetime against the module's own constant, so changing the lifetime from 10 minutes to a day changed both sides of the comparison and still passed. Fixed: the limits (9 to 10 minutes) are now written out in the test.
- **M25 survived, an equivalent mutation.** `sendInvite` has two independent safeguards against a second invite, so removing one changes nothing a caller can see. The mutation now removes both (a repeated send-invite then fails instead of being skipped, and S6-10 catches it).
- **M19 had a bad target.** The text to change appeared twice (the line to the candidate and the line to the recruiter). The harness refuses a target that is not unique; the target was made unique.

### 4.5 Problems the live run found in my own test
The first live run passed 6 of 7 and showed two flaws in the test, not in the product: the code that reads a resume (`buildParsedData`) swallows rate-limit errors and returns `parseError`, so my "retry on rate limit" wrapper never fired and six resumes were scored from raw text only; and the answer scorer silently fell back to keyword scoring after the earlier calls used up the per-minute allowance. Fixes: the demo waits and parses again until the model has really parsed all eight resumes, retries rate limits on every model call, and asserts `fallback === false` in S7-07. Second live run: 7 of 7.

### 4.6 Clean-up and side effects
After the database stage: 0 leftover recruiters, jobs or candidates with the demo prefix, no temporary storage folders, and `git status` shows only the files this work added or changed. The mutation check never touches the repository (it works in the system temp folder and removes its link to `node_modules` before deleting the copy).

### 4.7 Project gates
`npm run check:branding` passes. No production file was changed; the only edits outside `tests/demo/` are the two npm scripts in `package.json` and one-line pointers in `CLAUDE.md` and the docs.

## 5. Latest results

Final run of the finished code on 2026-10-09 (`npm run demo:tests -- --all`, Node 24, local Postgres, Groq):

| Stage | Name | Cases | Passed | Failed | Skipped | Time |
|---|---|---|---|---|---|---|
| 1 | Resume intake and AI screening | 14 | 14 | 0 | 0 | 1.9 s |
| 2 | Shortlist rules, settings and status machine | 12 | 12 | 0 | 0 | 2 ms |
| 3 | Invitation and link security | 14 | 14 | 0 | 0 | 55 ms |
| 4 | The AI interview conversation | 18 | 18 | 0 | 0 | 72 ms |
| 5 | Evaluation and final suggestion | 14 | 14 | 0 | 0 | 4 ms |
| 6 | One candidate through the real database | 21 | 21 | 0 | 0 | 920 ms |
| 7 | Live AI check (real language model) | 7 | 7 | 0 | 0 | 4.0 min |
| | **Total** | **100** | **100** | **0** | **0** | |

Language-model calls attempted by the offline stages: 0. The live stage time is mostly waiting for Groq's per-minute limit (S7-01 alone took about 2½ minutes). An earlier live run after the fixes in section 4.5 also passed 7 of 7 (stage time 3.4 min).

## 6. Suggested demo (about 6 minutes)

1. **Offline run (1 min).** `npm run demo:tests -- --pace 250`. Say: "100 cases, no internet, no database: real pipeline code, with the AI, e-mail and clock faked." Point at the expected/observed lines of S1-05 (skills read from a PDF, a DOCX and a TXT), S2-01 (nine applicants, three shortlisted), S5-04 (a score calculated by hand) and finish on `Language-model calls attempted by the offline stages: 0`.
2. **Real database (2 min).** `npm run demo:tests -- --stage 6 --verbose`. Walk one candidate: S6-02 nine applications through the real endpoint, S6-07 the shortlist, S6-09 "only a hash of the link is stored", S6-15 the interview stored in Postgres, S6-17 the final score 86 while the recruiter still decides, S6-19 the guard rails (automation only decides clear cases), S6-21 everything deleted again.
3. **"Can your tests fail?" (1 min).** On a clean copy of the file, change `>=` to `>` in `libs/hiring/shortlist.js` (the `candidate.fitScore >= minFitScore` line), run `npm run demo:tests -- --stage 2 --brief` and show **S2-02 FAIL**. Restore with `git checkout -- libs/hiring/shortlist.js` (this discards uncommitted edits to that one file, so only do it if you have none). Then show the saved output of `npm run demo:mutations` (31 deliberate bugs, which case caught each).
4. **Real AI (optional, run it before the audience arrives).** `npm run demo:tests -- --live`; show the score table of S7-01 and the ranking line of S7-02.

## 7. What this does not cover, and what to say about it

Be upfront about these when asked.

- **Not covered by the demo script:** the candidate's browser room (camera and microphone permission, captions), real speech-to-text (Deepgram) and text-to-speech (Kokoro), the WebSocket connection and reconnect over a real network, recording upload, the ffmpeg join and voice/camera analysis (S6-17 inserts that analysis as data), LinkedIn / Rozee.pk / Indeed publishing, the Python AI engine, and the supervised agent. These are covered by the developer suite (`npm run test:hiring`), by `scripts/interview-test-client.js`, and by the manual end-to-end script in [17-testing.md](17-testing.md) §4.
- **Stage 1–5 numbers test the pipeline, not the AI.** The offline stages use scripted model answers. How good the AI is can only be argued from stage 7, which uses nine synthetic resumes: a smoke test, not an accuracy measurement. Do not quote a percentage.
- **The author wrote the expected values.** They come from the documents and from hand calculation, which is better than copying the output, but a second person should review `EXPECTED_SKILLS` and the arithmetic in stages 4–6.
- **Observed while testing, worth knowing:**
  - S1-12 only proves the *structured* part of the prompt has no name, e-mail or phone. The resume text itself is still sent to the model unredacted (the system prompt tells the model to ignore names and protected traits). If the claim is "the model never sees personal data", that is not what the code does.
  - When the model is rate-limited at apply time the application is kept with `parseError: "Failed to parse resume"` and is still scored from its text (6 of 8 resumes hit this when sent back to back on Groq's free tier).
  - `scoreAnswer` silently falls back to keyword scoring when the model fails; the result carries `fallback: true`, but a recruiter reading only the score would not know.
  - An unknown link answers HTTP 404 and a cancelled link 410 with the same wording; the page text does not reveal which, the status code does (only for someone who already holds a valid token).

## 8. Adding or changing a case

1. Find the rule in docs 05–11 or `CLAUDE.md`. If there is no rule, there is nothing to test yet.
2. Work out the expected result by hand and write the arithmetic next to it. Do not run the code first and paste what it says.
3. Add the case to the stage file in `tests/demo/` (fields: `id`, `title`, `requirement`, `input`, `expect`, and `run` returning a sentence built from observed values).
4. If it guards something that matters, add a mutation to `tests/demo/mutation-check.js` that breaks it, and check the case goes red. A case you have never seen fail is unproven.
5. Run `npm run demo:tests` (and `-- --db` if you touched stage 6), then update the counts in this document.

## 9. Catalogue of all cases

### Stage 1: Resume intake and AI screening

_A candidate applies with a file. Is it accepted, read correctly, and scored without trusting the AI blindly?_

| ID | Case | Input | Expected result |
|---|---|---|---|
| S1-01 | Upload rules: PDF, DOCX, TXT up to 5 MB are accepted; everything else is refused | resume.pdf, CV.DOCX, notes.txt, virus.exe, empty.pdf (0 bytes), huge.pdf (6 MB) | first three accepted (case-insensitive), last three refused with a reason |
| S1-02 | A real PDF resume is read (Ayesha Khan, 2 pages of text) | tests/fixtures/resumes/strong-1-ayesha-khan.pdf | method pdf-parse, text contains Kubernetes, Terraform and her job title |
| S1-03 | A real DOCX resume is read (Sara Ahmed) | tests/fixtures/resumes/strong-3-sara-ahmed.docx | method mammoth, text contains EKS clusters and Terraform |
| S1-04 | A scanned (image-only) PDF is flagged instead of guessed at | tests/fixtures/resumes/unreadable-scanned.pdf | 0 characters extracted; parsedData.parseError set; no AI call made |
| S1-05 | Strong resumes (PDF, TXT, DOCX): all 6 required skills are found | Ayesha Khan (PDF), Bilal Qureshi (TXT), Sara Ahmed (DOCX) against Docker, Kubernetes, AWS, CI/CD, Terraform, Linux | 6 of 6 matched for each, none missing (expected list written by reading the resumes) |
| S1-06 | Partial resumes: exactly the skills they show are found, the gaps are named | Hamza Sheikh, Fatima Noor, Usman Tariq | Hamza and Usman: Docker, AWS, Linux. Fatima: Linux only. All other skills listed as missing |
| S1-07 | Unrelated resumes (designer, accountant): no required skill is found | Zara Malik (graphic designer), Omar Farooq (accountant) | 0 of 6 matched, all six listed as missing |
| S1-08 | Skill names are matched as whole terms, with synonyms | k8s→Kubernetes, Amazon Web Services→AWS, postgres→PostgreSQL, Java vs JavaScript, Go vs Google | synonyms match; look-alike substrings do not |
| S1-09 | A skill the AI claims but the resume does not show is not counted | AI claims the graphic designer Zara Malik has Linux and Ansible; AI claims Bilal Qureshi has Docker and Ansible | Zara: matched none, Linux and Ansible reported as unverified · Bilal: Ansible unverified and not matched, his real Docker kept |
| S1-10 | Nonsense scores from the AI are repaired, never stored as they came | fitScore 140.6, -3, "77.4", missing; experience verdict "excellent" | 100, 0, 77, 0; verdict unknown |
| S1-11 | The candidate's name never appears in the stored AI explanation | AI rationale: "Bilal Qureshi has strong EKS experience. Bilal also writes Terraform." | "The candidate has strong EKS experience. The candidate also writes Terraform."; "Ali" does not damage "Alibaba" |
| S1-12 | The structured part of the AI prompt carries no personal details | parsed resume of Bilal Qureshi with name, email, phone, location | none of the four fields in the prompt's structured block; system prompt forbids judging gender, age, religion, nationality |
| S1-13 | An unreadable resume scores 0 and goes to manual review without calling the AI | candidate whose parsedData.parseError is set and has no text | fitScore 0, manualReview true, concern "Resume could not be read", AI not called |
| S1-14 | AI hiccups are retried twice; a rate limit is not hammered | AI fails twice then answers 70 · AI always down · AI answers 429 (rate limit) | 3 calls then score 70 · 3 calls then error · 1 call then rate_limit error |

### Stage 2: Shortlist rules, settings and status machine

_Who goes forward, who does not, and which moves is a recruiter allowed to make by hand?_

| ID | Case | Input | Expected result |
|---|---|---|---|
| S2-01 | Nine applicants, threshold 70, top 3: the three strong candidates are shortlisted | scores Ayesha 92, Bilal 85, Sara 78, Usman 55, Hamza 52, Fatima 38, Zara 8, Omar 5, scanned 0; minFitScore 70, maxShortlist 3 | shortlisted Ayesha, Bilal, Sara; the other six not shortlisted |
| S2-02 | The threshold is inclusive: 70 goes through, 69 does not | scores 70 and 69, minFitScore 70 | the 70 is shortlisted, the 69 is not |
| S2-03 | The cap wins: five qualify but only the top three go through | scores 82, 90, 84, 88, 86; minFitScore 70, maxShortlist 3 | 90, 88, 86 shortlisted; 84 and 82 are not even though they qualify |
| S2-04 | A tie goes to whoever applied first | two candidates at 80 (applied day 5 and day 2), one slot left | the day-2 applicant is shortlisted |
| S2-05 | People already shortlisted use up the cap | maxShortlist 3, two already shortlisted, new scores 95 and 90 | only the 95 is shortlisted |
| S2-06 | Nobody reaches the threshold: nobody is shortlisted | scores 65, 40, 10; minFitScore 70 | empty shortlist, all three not shortlisted |
| S2-07 | maxShortlist null means no cap | 30 candidates all scoring 80, maxShortlist null | all 30 shortlisted |
| S2-08 | Settings a recruiter types are validated; weights are normalised | minFitScore 150 · maxShortlist 0 · weights 3/5/2 · an unknown key | errors for 150 and 0; weights become 0.3/0.5/0.2; the unknown key is dropped |
| S2-09 | A new job is safe by default: a human decides rejections | a job with no hiring settings | autoFinalize false, minFitScore 70, finalThreshold 70, weights 0.3/0.5/0.2, outcome emails off |
| S2-10 | Recruiter moves are limited: no skipping the interview, no editing a hire | interview_completed→hired, interview_in_progress→rejected, hired→rejected, final_shortlisted→hired, rejected→shortlisted | first three refused; last two allowed |
| S2-11 | Every status has a label, colour and Kanban column; no move leads nowhere | 13 statuses and 6 Kanban stages | all statuses have metadata with a valid stage; every allowed target is a known status |
| S2-12 | The happy path only ever moves forward across the Kanban columns | new → screened → shortlisted → interview_invited → interview_in_progress → interview_completed → final_shortlisted → hired | column order never decreases |

### Stage 3: Invitation and link security

_The shortlisted candidate gets a private link. Can anyone else guess it, reuse it, or read a score in the email?_

| ID | Case | Input | Expected result |
|---|---|---|---|
| S3-01 | Invite links cannot be guessed: 43 random URL-safe characters, never repeated | create 2000 invite tokens | every token matches [A-Za-z0-9_-]{43}, passes the link check, and all 2000 are different |
| S3-02 | Only a SHA-256 hash of the link is stored, never the link itself | one invite token | stored value = sha256(token) (computed independently), 64 hex characters, does not contain the token |
| S3-03 | Junk links are refused before the database is even asked | "", "short", a link with spaces, "../../etc/passwd", 101 characters, null | all six refused |
| S3-04 | Logs show a masked link only | abcdefghijklmnop · "short" · undefined | abc…nop · … · … |
| S3-05 | The live-interview ticket works and lives only about 10 minutes | sign a ticket for interview int-1 / candidate cand-1, then verify it | claims round-trip; expiry between 9 and 10 minutes from now |
| S3-06 | A ticket that was edited, or is blank, is refused | a valid ticket with its last two characters changed · an empty string | TicketError for both |
| S3-07 | An expired ticket is refused with a clear reason | a correctly signed ticket that expired 60 seconds ago | TicketError "Ticket expired" |
| S3-08 | A ticket forged with another secret, or for another purpose, is refused | signed with a different secret · right secret but type "something_else" | TicketError for both |
| S3-09 | A missing server secret is reported as a setup error, not as a bad ticket | INTERVIEW_TICKET_SECRET removed | an error that is not a TicketError |
| S3-10 | A cancelled link and an unknown link show the candidate the same message | access errors for not_found, cancelled, expired | not_found and cancelled share one message; expired tells the candidate to contact the recruiter |
| S3-11 | The invite email has the link, the deadline, the language rule and an honest privacy line | invite for Ayesha Khan, DevOps Engineer, 25 minutes, video and behaviour tracking on | link, English only, 25 minutes, deadline, "recorded (audio and video)", eye movement mention; subject names the job |
| S3-12 | With video switched off, the email promises audio only | invite with recordVideo false | "recorded (audio)", no camera requirement, no eye-movement mention |
| S3-13 | The reminder says when the link ends and that it replaces the earlier one | reminder 24 hours before the deadline | subject "expires in 24 hours"; text says it replaces the earlier link |
| S3-14 | Outcome emails never contain a score, a percentage or the AI's reasoning | outcome emails for final_shortlisted and final_rejected | no "score", "fit", "rating", "rank", "%" and no 2-3 digit numbers anywhere in subject or text |

### Stage 4: The AI interview conversation

_The interviewer greets, asks, listens, probes, keeps time and hands over a clean record. Time is simulated._

| ID | Case | Input | Expected result |
|---|---|---|---|
| S4-01 | The interviewer introduces itself and waits for "ready" before question 1 | start a 3-question, 25-minute interview; candidate first says "hello there", then "yes ready" | greeting says 3 questions / 25 minutes / English / Raasta AI Interviewer; no question until "ready"; then question 1 with an empty answer buffer |
| S4-02 | Eight seconds of silence ends an answer: it is saved and the next question is asked | answer, then 7 s of silence, then 1.1 s more | nothing saved at 7 s; at 8.1 s the answer is saved for q1 and question 2 is asked |
| S4-03 | The "I've finished my answer" button skips the wait | answer then answer_done, no waiting | answer saved and question 2 asked at once |
| S4-04 | Noise and double triggers during thinking never produce two questions | while the AI is analysing: "um", "ok", a second answer_done, then the 8 s timer fires | question 1 + exactly one more; one answer saved |
| S4-05 | The AI never talks over a candidate who keeps going | answer + finished, then the candidate adds more words while the AI is still analysing | no follow-up spoken, follow-up depth rolled back, nothing saved; after the next silence the full answer is saved once |
| S4-06 | Follow-ups are capped at two per question | an analyzer that always asks for a follow-up; four answers in a row | question kinds: follow_up, follow_up, then the next base question; saved as q1 base, q1 depth 1, q1 depth 2 |
| S4-07 | A one-line weak answer earns a follow-up and a low score; a full answer does not | weak: "I don't know, maybe Docker." · strong: the 40-word q1-strong.wav transcript (Docker, Kubernetes, Helm, Terraform, AWS) | weak → follow-up (first reason answer_incomplete), score 17 · strong → no follow-up, score 88 (hand-calculated) |
| S4-08 | "I don't want to answer that" gets no follow-up and a zero, and the interview moves on | "No, I don't want to answer that." with an analyzer that wants a follow-up | next base question asked, the scorer is not called, stored score 0 with reason "The candidate declined to answer." |
| S4-09 | The question echoing back through the speakers is not counted as the answer | microphone hears the question text, then question text + the real answer | saved answer equals only the real answer; captions shown never contain the question |
| S4-10 | Speaking Urdu mid-question: English-only notice, answer dropped, question repeated, recruiter told | candidate says half an answer, then Urdu speech is detected | interviewer says it noticed Urdu and repeats the question; half answer discarded; an integrity event is recorded for the recruiter |
| S4-11 | The interview length decides the question count: 10 minutes asks 3 of 8, 45 minutes asks all 8 | an 8-question bank at 10 minutes and at 45 minutes; the 10-minute run answered to the end | 10 min: greeting says 3 questions, 3 answers end the interview "3 of 3" · 45 min: 8 questions |
| S4-12 | "Please end the interview" by voice: polite goodbye, partial interview kept | one answer given, then "Actually I want to end the interview, so kindly end it right now." | closing line spoken, request not counted as an answer, reason ended_by_candidate, interview kept and queued for analysis |
| S4-13 | A long answer that merely mentions "ending the session" is still an answer | I would model books and members as resources, use HTTP verbs for actions, return proper status codes and paginate large lists because clients need predictable behaviour and when the user logs out we end the session | saved as an answer; question 2 asked |
| S4-14 | Time runs out mid-answer: 60 s grace, the answer is saved, the interview closes | 5-minute interview; the candidate keeps talking past the limit | one warning at 1 minute left; answer saved; closing spoken; reason time_up |
| S4-15 | After a dropped connection the candidate resumes where they were, without losing time | one answer given, 3 minutes offline in the middle of question 2, then reconnect | "Welcome back, let's continue." + question 2; elapsed time unchanged by the 3 offline minutes |
| S4-16 | The candidate's screen never receives scores, reasons or the ideal answers | a whole interview with follow-ups; every message sent to the candidate is searched | none of: score, reasoning, idealAnswer, skill_avoided, keywords, or the ideal-answer text; scores go to the recruiter channel only |
| S4-17 | Finishing hands over cleanly: closing line, one completion, one analysis job | answer all 3 questions | closing "Thank you, Ayesha. That concludes your interview for DevOps Engineer."; reason finished; 1 completion; 1 analyse-interview job |
| S4-18 | Browser integrity events are recorded; made-up event names are ignored | tab_hidden (valid) and "rm -rf" (invalid) | only tab_hidden is stored, and it is relayed to the recruiter |

### Stage 5: Evaluation and final suggestion

_How the interview becomes numbers, and when the system is allowed to suggest a decision. All arithmetic checked by hand._

| ID | Case | Input | Expected result |
|---|---|---|---|
| S5-01 | Speaking pace: full marks at 110-160 words per minute, falling to zero at 70 and 210 | wpm 135, 110, 160, 90, 185, 70, 210, 250 | 100, 100, 100, 50, 50, 0, 0, 0; no wpm → no score |
| S5-02 | Fluency: fillers (um, uh) and long pauses cost points | 2 fillers/min and 10% pauses · 10 fillers/min and 50% pauses · pauses only (10%) | 77.6 · 0 · 80 |
| S5-03 | Composure: the share of calm, neutral or happy voice | neutral 0.5, happy 0.2, anxious 0.3 · calm 0.4, neutral 0.4, angry 0.2 | 70 · 80 |
| S5-04 | Communication score with voice, eye contact and composure: the doc 11 worked example | 135 wpm, 2 fillers/min, 10% pauses, eye contact 80, emotion neutral 0.7 + happy 0.1 + anxious 0.2 | 0.30×100 + 0.30×77.6 + 0.25×80 + 0.15×80 = 30 + 23.28 + 20 + 12 = 85.28 → 85 |
| S5-05 | No camera: the missing part is left out and the others are re-weighted, not scored as zero | same as S5-04 but without eye contact | (30 + 23.28 + 12) / 0.75 = 87.04 → 87; eye contact reported as missing |
| S5-06 | Interview score: follow-ups average into their question, harder questions weigh more | q1 (weight 1): 80 and follow-up 60 · q2 (weight 2): 90 · q3 (weight 1): not scored | q1 = (80+60)/2 = 70; (70×1 + 90×2) / (1+2) = 83.33 → 83 |
| S5-07 | Final score = 30% resume + 50% interview + 20% communication | fit 92, interview 80, communication 85 | 0.3×92 + 0.5×80 + 0.2×85 = 27.6 + 40 + 17 = 84.6 → 85 |
| S5-08 | If the communication part is missing, the other two are re-weighted | fit 80, interview 70, communication missing | (0.3×80 + 0.5×70) / 0.8 = (24 + 35) / 0.8 = 73.75 → 74 |
| S5-09 | The threshold decides the suggestion: 70 is shortlisted, 69 is not | scores 70 and 69, threshold 70, all questions answered | final_shortlisted, final_rejected |
| S5-10 | A high score is not trusted if fewer than half the questions were answered | score 95 with 1 of 3 answered · score 95 with 2 of 4 answered · no score at all | needs_review · final_shortlisted (exactly half is enough) · needs_review |
| S5-11 | Recommendation wording follows the score when the AI gives none | threshold 70: scores 90, 85, 84, 70, 69, 55, 54 | strong_yes, strong_yes, yes, yes, maybe, maybe, no |
| S5-12 | A garbage AI summary is replaced by safe values; the fallback summary states facts only | AI returns recommendation "definitely", summary 42, strengths as a string; AI unavailable | recommendation "yes" (from score 75), no summary, empty lists · fallback text with score, fit, interview, communication, answered count, marked fallback |
| S5-13 | Scores near the threshold, thin interviews and long tab-hiding always need a person | score 72 (threshold 70) · score 75 · suggestion needs_review · tab hidden 3 times | borderline · nothing · needs_review · integrity |
| S5-14 | The AI summary is shown the strongest and weakest answers as evidence | seven scored answers 95, 90, 85, 70, 60, 40, 10; plus a follow-up and a blank answer | top 95, 90, 85 · weakest 10, 40, 60 · 7 base questions answered (follow-up and blank not counted) |

### Stage 6: One candidate through the real database

_Throw-away recruiter, job and nine applicants in real Postgres. The AI, e-mail and queue are scripted; everything else is the real code._

| ID | Case | Input | Expected result |
|---|---|---|---|
| S6-01 | Set-up: a throw-away recruiter, a published DevOps job and a 3-question interview bank exist | insert user, job (min fit 70, top 3, 72 h invites, human decides) and 3 active questions | 1 job with the six required skills, 3 active job-wide questions |
| S6-02 | Nine candidates apply through the real public endpoint with their resume files | PDF, DOCX and TXT resumes of 8 people plus one scanned PDF | 9 × HTTP 200, 9 candidates with status new, 9 files in storage, the AI parser used 8 times (not for the scan), the scan flagged unreadable |
| S6-03 | Applying twice with the same e-mail is refused (HTTP 409) | the duplicate-email fixture (Bilal Qureshi again, with different capitals in the e-mail) | 409 "You have already applied for this position"; still exactly one Bilal row |
| S6-04 | A wrong file type and a broken job link are rejected cleanly | an .exe sent as the resume · an application to a job id that is not a UUID | 400 "Resume must be a PDF, DOCX or TXT file" · 404 "Job not found" · still 9 candidates |
| S6-05 | Screening writes each fit score, moves everyone to "screened", and keeps names out of the explanation | scripted AI scores (Ayesha 92 … Omar 5); the scripted explanation deliberately contains each candidate's own name | 9 rows screened with the scripted scores (scan = 0); no stored explanation contains a candidate's name |
| S6-06 | The stored skill analysis shows exactly which skills each resume proves | stored analysis of Ayesha (strong), Hamza (partial), Zara (unrelated) | Ayesha 6 matched · Hamza Docker, AWS, Linux (missing Kubernetes, CI/CD, Terraform) · Zara none |
| S6-07 | The shortlist picks Ayesha, Bilal and Sara; everyone else is "not shortlisted" | minFitScore 70, maxShortlist 3 on the nine screened candidates | 3 shortlisted in the database, 6 not shortlisted; the queue receives ensure-questions once and send-invite ×3 |
| S6-08 | Running the shortlist again changes nothing and queues nothing | applyShortlist a second time | 0 newly shortlisted, 0 newly rejected, statuses unchanged, queue unchanged |
| S6-09 | Ayesha is invited: one interview row, one e-mail, and only a hash of the link in the database | sendInvite(Ayesha) with a mailbox instead of Mailgun | interview status invited, expiry ≈ 72 h, candidate interview_invited, 1 e-mail to her address, the e-mailed token appears nowhere in the stored rows |
| S6-10 | Pressing "send invite" twice does not send a second e-mail or create a second interview | sendInvite(Ayesha) again | skipped "already invited", still 1 e-mail and 1 interview row |
| S6-11 | A candidate who was not shortlisted cannot be invited | sendInvite(Usman Tariq), status not_shortlisted | InviteError invalid_status (HTTP 409), no e-mail, no interview row |
| S6-12 | The link opens for its owner only: wrong links get 404 and hammering gets 429 | Ayesha's real link, a random valid-looking link, and 21 rapid "consent" requests | real link resolves (invited → opened on first visit) · random link AccessError not_found 404 · the 21st rapid request AccessError rate_limited 429 |
| S6-13 | An invite left unused expires in the database; the recruiter can extend it | invite Bilal, open his link 100 hours later, then extend by 24 hours | 410 expired; interview expired + candidate interview_expired; after extending: interview invited again, candidate interview_invited |
| S6-14 | Cancelling an invite kills the link and puts the candidate back on the shortlist | invite Sara, cancel it, open the old link | interview cancelled, candidate shortlisted, old link refused (HTTP 410) with the same "no longer valid" message an unknown link gets |
| S6-15 | Ayesha takes the interview: answers, scores, transcript and status changes are stored | 3 scripted spoken answers; the scripted scorer gives 90, 70, 80 to questions weighted 2, 1, 2 | interview completed, 3 answers each scored, interview score 82 = (90×2 + 70×1 + 80×2)/5, candidate interview_completed, a transcript saved, one analyse-interview job queued |
| S6-16 | Editing the question bank afterwards does not change an interview that already started | rewrite question 1 in the bank, then read Ayesha's interview snapshot | snapshot still holds the original wording |
| S6-17 | Finalising: final score 86 from fit 92, interview 82, communication 85, and the recruiter still decides | Ayesha: fit 92, interview score 82 (from S6-15), recording analysis inserted as data (the S5-04 example: communication 85); scripted AI summary that contains her name | 0.3×92 + 0.5×82 + 0.2×85 = 27.6 + 41 + 17 = 85.6 → 86; suggestion final_shortlisted; candidate still interview_completed; name removed from the stored summary; notification says it is waiting for the recruiter |
| S6-18 | The recruiter approves Ayesha, then hires her; an illegal move afterwards is refused | final_shortlisted by the recruiter, then hired, then hired → final_rejected | status final_shortlisted (decidedBy = the recruiter), then hired; the last move fails with invalid_transition (409) and the status stays hired; no outcome e-mail is queued (switched off) |
| S6-19 | With automatic decisions ON: clear cases are decided by the system, doubtful ones are not | four finished interviews on a job with autoFinalize true: strong, weak, only 1 of 3 answered, and strong on an agent-managed job | strong → final_shortlisted by "system" · weak → final_rejected by "system" · 1 of 3 answered → stays interview_completed (needs_review) · agent-managed → stays interview_completed |
| S6-20 | "Approve all" applies clear suggestions but never decides the doubtful ones | bulkApprove on the job: one waiting candidate with a clear suggestion (agent-managed seed), one needs_review (1 of 3 answered) | 1 applied (final_shortlisted by the recruiter), 1 left for review, 0 failed; the thin one stays interview_completed |
| S6-21 | Clean-up: deleting the throw-away recruiter removes every row and file this stage created | delete the user; count jobs, candidates, interviews, questions, answers, transcript turns, notifications and stored files | all counts 0, storage folder gone |

### Stage 7: Live AI check (real language model)

_The same resumes and answers, judged by the real model. Properties are checked, not exact numbers._

| ID | Case | Input | Expected result |
|---|---|---|---|
| S7-01 | The real model reads and scores all nine fixture resumes through the production code path | 8 readable resumes + the scanned PDF, against the DevOps Engineer job | 8 integer scores from 0 to 100 and the scanned PDF scored 0 for manual review, without error |
| S7-02 | The ranking makes sense: strong beats partial beats unrelated, with clear gaps | live scores of the 3 strong, 3 partial and 2 unrelated resumes | average(strong) − average(partial) ≥ 15 · average(partial) − average(unrelated) ≥ 15 · the weakest strong resume scores above the best unrelated one |
| S7-03 | With the real scores and the real shortlist rule, nobody unsuitable is shortlisted | minFitScore 70, maxShortlist 3, the live scores (the scanned PDF counts as 0) | no partial, unrelated or unreadable candidate shortlisted; at least 2 of the 3 strong candidates shortlisted |
| S7-04 | The model's explanations are name-free and its skill claims are checked against the resume | the nine live analyses | no stored explanation contains the candidate's first or last name; matched skills equal the hand-written expectations whatever the model claimed |
| S7-05 | Scoring the same resume again gives nearly the same score | Bilal Qureshi scored a second time | the two scores differ by at most 10 points |
| S7-06 | The model writes a usable interview bank for the job | ask for 8 questions for the DevOps Engineer job | 6-8 valid questions, no duplicates, warm-up first, each with an ideal answer and 2-8 keywords, at least 3 mentioning a required skill |
| S7-07 | The model scores a strong spoken answer high and "I don't know, maybe Docker" low | the transcripts of tests/fixtures/interview/answers/q1-strong.wav and q1-weak.wav against one CI/CD question | strong ≥ 70, weak ≤ 40, gap ≥ 30 |

