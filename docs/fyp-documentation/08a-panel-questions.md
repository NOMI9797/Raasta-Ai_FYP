# Part 8A · Panel Questions and Model Answers

[← Index](README.md) · Previous: [Part 7 · Implementation journey](07-implementation-journey.md) · Next: [Part 8B · Weaknesses, demo, cheat sheet](08b-weaknesses-demo-cheatsheet.md)

> **How to use this file.** There are 84 questions in ten groups, ordered from friendly to hostile inside each group. Each has a **model answer** (3–6 sentences you can say in under a minute), the **evidence** you can point to (file, test, document), and a **likely follow-up** with a short reply. Rules for answering: (1) give the direct answer in the first sentence; (2) name the file or test that proves it; (3) when the honest answer is "we did not do that", say so, say why, and say what you would do; (4) never claim an accuracy, cost or load number that this documentation marks as a gap. Questions marked ★ are the ones most likely to be asked.

## Contents

* [A. Problem, scope and originality](#a-problem-scope-and-originality) (Q1–Q10)
* [B. Architecture and design choices](#b-architecture-and-design-choices) (Q11–Q21)
* [C. Resume parsing and screening](#c-resume-parsing-and-screening) (Q22–Q29)
* [D. The AI interview](#d-the-ai-interview) (Q30–Q43)
* [E. Evaluation, decisions and the agent](#e-evaluation-decisions-and-the-agent) (Q44–Q50)
* [F. AI quality, fairness and ethics](#f-ai-quality-fairness-and-ethics) (Q51–Q61)
* [G. Security and privacy](#g-security-and-privacy) (Q62–Q71)
* [H. Platforms and client acquisition](#h-platforms-and-client-acquisition) (Q72–Q77)
* [I. Testing, deployment, performance and cost](#i-testing-deployment-performance-and-cost) (Q78–Q82)
* [J. Process, lessons and future](#j-process-lessons-and-future) (Q83–Q84, with the closing question)

---

## A. Problem, scope and originality

### Q1 ★ What problem does Raasta-AI solve, and for whom?

**Answer.** Recruiters spend hours reading CVs and running first-round interviews, and sales teams spend hours finding and messaging prospects; both are slow and inconsistent. Raasta-AI takes a job from a platform-specific post, through applications, an AI resume score, an emailed AI interview, and a computed final score, to a recruiter's decision, and separately runs a lead-to-outreach pipeline for client acquisition. The aim is to remove repetitive work while keeping a person in charge of every decision that matters.
**Evidence.** [1.1](01-big-picture.md#11-problem-statement), `docs/ai-hiring/01-pipeline-overview.md`.
**Follow-up:** *"Who exactly is the user?"* → Recruiters, sales operators and admins have accounts; candidates need no account and use a link; see [1.1.3](01-big-picture.md#113-who-it-is-for-as-evidenced-by-the-code).

### Q2 Why are recruitment and client acquisition in one product?

**Answer.** They share real infrastructure: one authentication and role system, one platform-account layer (LinkedIn, Rozee.pk, Indeed behind a common adapter interface), the same Redis and Playwright tooling, and the same LLM client. There is also a genuine link: a company advertising a vacancy on a job board is a buying signal for hiring-related services, so the lead scraper reads the same boards the recruiter posts to. We do not claim the two modules are tightly coupled; they were built at different times and meet at the shared layers.
**Evidence.** `libs/platforms/index.js`, [1.3](01-big-picture.md#13-what-multi-platform-actually-means-here), [M15–M17](02b2-conceptual-modules-cont.md).
**Follow-up:** *"So it's two projects glued together?"* → Two modules on one platform layer; the hiring pipeline is the deeper one (all 436 automated tests are for it) and the sales half is older and has no automated tests, which we say openly.

### Q3 ★ What does "multi-platform" mean in your title?

**Answer.** Two things. First, multiple external platforms: LinkedIn, Rozee.pk and Indeed plus our own apply page, each behind an adapter with the same operations (account, session test, publish, scrape, search, rate limits). Second, multiple client surfaces: the dashboard, the public apply form, the public interview room, a browser extension, a local posting engine, and email. It does not mean a native mobile app or ATS integrations; the interview room is desktop-only by design.
**Evidence.** `libs/platforms/*`, [1.3.1–1.3.3](01-big-picture.md#13-what-multi-platform-actually-means-here).
**Follow-up:** *"Which platform is most complete?"* → LinkedIn for automation; Rozee.pk and Indeed posting is partial because neither offers a posting API and Indeed paused our test account.

### Q4 ★ How is this different from LinkedIn Recruiter, HireVue or an ATS?

**Answer.** Those products each cover part of the loop: sourcing and posting, or video interviews, or pipeline tracking. Raasta-AI closes the loop in one open system: it posts to several boards, receives applications on its own page, scores CVs against the job with a visible rubric, runs an AI interview, and shows the recruiter an explainable score breakdown. We do not claim to be a better ATS: we lack team permissions, reporting, integrations and compliance, and we have no validation study like the commercial vendors publish.
**Evidence.** [1.1.4](01-big-picture.md#114-why-existing-tools-are-insufficient-and-the-honest-limits-of-that-claim) (marked as general market knowledge to be re-verified).
**Follow-up:** *"Did you check the competitors?"* → The comparison is general knowledge and should be re-checked against vendor pages before the viva [GAP].

### Q5 ★ Is this your own work? Where did the interview agent come from?

**Answer.** The architecture, requirements, specification and the Raasta-AI implementation are ours. The interview idea existed first in a separate earlier prototype that joined a video meeting as a bot, stored data in MongoDB and used GPT-4o. We did not merge that code: we wrote a file-by-file port map, kept the conversation rules that had been tuned on real interviews, and re-implemented everything on our stack (browser room, WebSocket, PostgreSQL, Groq). I can show the ledger of what was reused, adapted, integrated and newly built, and a measurement that across the nine ported files only 0 to 11 percent of substantive lines are identical.
**Evidence.** [7.3](07-implementation-journey.md#73-the-interview-module-integration), `docs/ai-hiring/04-source-port-map.md`, `npm run check:branding`.
**Follow-up:** *"Who wrote the original prototype, and under what licence?"* → **[Team must prepare this answer: the repository cannot show authorship or licence of the earlier project; see 7.3.8.]**

### Q6 ★ Did you write this yourselves, or did an AI write it?

**Answer.** We used an AI coding assistant to implement the hiring pipeline, and our own repository says so: `CLAUDE.md` and `docs/ai-hiring/README.md` describe the workflow of one phase per session, plan first, human approval, human-run acceptance checks. The requirements, decisions, specification, acceptance criteria and review were ours, and the process left evidence: a 21-document specification written before the code, a reverted first attempt, 436 tests, and a progress log of defects we found that the tooling did not. Each of us must be able to walk through the modules we present at code level, and this documentation set exists to make that possible.
**Evidence.** [2E §E.9](02e-development-process.md#e9-ai-assisted-development-what-the-repository-says), `docs/ai-hiring/16`.
**Follow-up:** *"Then what did you actually do?"* → Decided what to build and how it must behave (the port map and the phase prompts), reviewed plans, ran and debugged the system on real interviews (for example the recording failure and the reasoning-token bug), and own the design trade-offs in this document. **[Each member adds their own concrete contribution.]**

### Q7 What did each team member contribute?

**Answer.** From git: Malik built the foundation and the client-acquisition module, the first recruiter mode, and the Rozee.pk and Indeed integration (99 commits, March to May 2026). Zain built the AI hiring pipeline: screening, question bank, interview engine and room, analysis, evaluation, supervised agent, publishing, posting engine, setup guide, and the test suite (22 commits plus uncommitted work, October 2026). Nawal's committed work is the admin analytics fix; git shows only code, so **Nawal and everyone else must add design, QA, report and diagram work that the history cannot show**.
**Evidence.** [2E §E.4](02e-development-process.md#e4-division-of-work-among-the-team).
**Follow-up:** *"Can each of you explain every module?"* → That is the purpose of Parts 2B and 4; rehearse with the cheat sheet in 8B.

### Q8 What is out of scope?

**Answer.** Native mobile apps, integrations with HR systems or calendars, non-English interviews, offer management and payroll, validated predictive accuracy, multi-tenant team permissions, and production deployment with compliance review. Stripe billing exists only as template code and its webhook handlers are inert. The interview is a first-round screen, not a replacement for a human final interview.
**Evidence.** [1.3.3](01-big-picture.md#13-what-multi-platform-actually-means-here), [00-inventory §12](00-inventory.md#12-things-the-repository-does-not-contain).
**Follow-up:** *"Why not multilingual?"* → Speech recognition is locked to English (`STT_LANGUAGE`) because auto-detection invented foreign words from noise; supporting other languages needs per-language validation.

### Q9 Why Pakistan, and is there a market study?

**Answer.** The focus is evident from the integrations rather than a stated requirement: Rozee.pk is a Pakistani job board with first-class support, Indeed defaults to its Pakistan site, and the Rozee.pk flow types rupee budgets. There is no market study in the repository, so we describe the market as an inference from the product, not a validated claim.
**Evidence.** [1.1.3](01-big-picture.md#113-who-it-is-for-as-evidenced-by-the-code), `INDEED_JOBS_COUNTRY`.
**Follow-up:** *"Would it work elsewhere?"* → The adapter design allows other boards; accents and language are the larger issue.

### Q10 Your repository has no commits from May to September. Why?

**Answer.** **[Team must answer truthfully; the repository is silent.]** What the history shows is two clearly different phases: the sales product and first recruiter mode in March to May (`main` ends at `fa594fe`, 14 May), then the AI hiring pipeline built specification-first in October. Be ready to state the real reason (exams, report writing, supervisor feedback, a change of plan) and how the October restart was organised, which is documented.
**Evidence.** [2E §E.8](02e-development-process.md#e8-evolution-from-prototype-to-now), `git log`.
**Follow-up:** *"Why did the October work start with a revert?"* → An initial unspecified attempt was reverted within about 30 minutes in favour of writing a specification first (`08899de`, `4426509`).

---

## B. Architecture and design choices

### Q11 ★ Why a modular monolith with satellites instead of microservices?

**Answer.** One deployable web app keeps routes, UI and shared libraries in one repository with shared types and a single database, which suits a small team. We split out only what needs a different runtime: a WebSocket interview engine with in-memory sessions, a Python service for audio models, a worker for slow jobs, and an optional posting engine that needs a visible browser. Shared code under `libs/` uses relative imports so those processes can import it. The trade-off is that the monolith's blast radius is large and the satellites are not independently versioned.
**Evidence.** [3.1](03-architecture-and-data.md#1-architectural-style-and-justification), CLAUDE.md "Conventions".
**Follow-up:** *"What would you split next?"* → The sales automation worker and the posting engine behind a queue, once there is a second team.

### Q12 ★ Why is the interview engine a separate process from Next.js?

**Answer.** A live interview needs a long-lived WebSocket and in-memory state for each session; Next.js route handlers are short-lived and the project's Vercel configuration caps functions at 300 seconds. A separate Node process can hold sessions, restart independently, and be sized on its own. It verifies a short-lived ticket on every connection and persists a snapshot every 15 seconds, so a crash costs at most a few seconds of conversation.
**Evidence.** `services/interview-engine/index.js`, `vercel.json`, [M8](02b-conceptual-modules.md).
**Follow-up:** *"What if the engine dies mid-interview?"* → The candidate reconnects within 15 minutes and the same question is asked again; a worker sweep closes orphaned sessions.

### Q13 ★ Why an in-browser room with a WebSocket instead of a meeting bot or WebRTC?

**Answer.** The decision is recorded (in-browser room, no meeting bot); the reasons are our argument. A meeting bot adds a paid third party and gives us less control over consent and audio, and the earlier prototype's dependence on one was a cost we chose not to carry. A browser room lets us control consent, capture clean microphone audio, and record locally. WebRTC would need a media server for what is a one-way audio stream to the server, so a plain WebSocket carrying 16-bit PCM was simpler. The costs are desktop-only support, microphone and camera permission prompts, and a secure context (HTTPS) outside localhost.
**Evidence.** `docs/ai-hiring/README.md` decisions table, `app/interview/[token]/lib/audio.js`.
**Follow-up:** *"Can candidates use phones?"* → Not supported; the email says Chrome or Edge on a laptop.

### Q14 Why Redis Streams for the job queue rather than BullMQ, Kafka or a database table?

**Answer.** Redis was already in the stack for locks and rate limits. Streams with a consumer group give at-least-once delivery, acknowledgement, multiple workers, and a dead-letter stream with little code; handlers are idempotent so a repeat is harmless. Kafka and a managed queue would be heavier than a prototype needs. The trade-off is that retries, timeouts and visibility are our own code (about 400 lines in the worker plus an admin card).
**Evidence.** `workers/hiring-worker.js`, `libs/hiring/queue.js`, [D.12](02d-foundational-concepts.md#d12-background-jobs-and-queues).
**Follow-up:** *"What if Redis loses data?"* → Queued work could be lost; durable state (candidates, interviews) is in Postgres and sweeps re-queue missing steps.

### Q15 Why PostgreSQL with Drizzle, and why two schema files?

**Answer.** The data is relational (jobs, candidates, interviews, turns, responses) with constraints and transactions, and the project rule is Postgres only. Drizzle gives typed queries without a heavy ORM. Two schema files exist for a historical reason: `libs/schema.js` is resolved first at runtime and `libs/schema.ts` is what drizzle-kit reads, so every change must be made in both, which is rule 3 in CLAUDE.md. We hand-write the SQL migrations because the Drizzle journal is out of sync.
**Evidence.** `libs/schema.ts`, `drizzle/0009`–`0015`, [3.2](03-architecture-and-data.md#3-complete-data-model).
**Follow-up:** *"Can your migrations rebuild the database?"* → Not alone: five older tables have no `CREATE TABLE`; a fresh database is built with `npm run db:push` [GAP].

### Q16 Why JavaScript and not TypeScript?

**Answer.** The project started from a JavaScript template and the existing code was JavaScript; some shared libraries are TypeScript. We accepted weaker static typing and compensated with 436 unit tests, runtime validation of inputs (for example `validateHiringConfig`), and JSON-shape checks on model output. Migrating to TypeScript is listed as future work.
**Evidence.** `package.json`, `jsconfig.json`, [Part 9](09-future-work.md).
**Follow-up:** *"Has it caused bugs?"* → We did not track typing bugs; the known risk is drift between the two schema files, which rule 3 in CLAUDE.md exists to prevent.

### Q17 What are the single points of failure?

**Answer.** PostgreSQL, Redis, the interview engine process, the Groq API, and the owner's machine for the posting engine. The design response is graceful degradation: an LLM outage triggers fallbacks (keyword score, canned follow-up, deterministic summary), speech-to-text falls back from Deepgram to Whisper, the voice falls back to the browser, and queued work retries. Redis or Postgres failing stops progress but does not corrupt data.
**Evidence.** [2C](02c-module-interaction.md), [6.5.2](06-cross-cutting.md#652-where-the-limits-come-from-component-by-component).
**Follow-up:** *"Is there redundancy?"* → No; it is a prototype and we say so.

### Q18 Sessions are in memory. What happens if the engine crashes?

**Answer.** The engine saves a snapshot of each session to Postgres every 15 seconds. The candidate's browser reconnects with a new ticket, the engine rebuilds the session from the snapshot, and the interviewer asks the current question again, excluding the time the candidate was away. If nobody returns within the resume window (15 minutes), the session is closed as completed or abandoned depending on whether at least half the questions were answered, and a worker sweep does the same if the engine itself never comes back.
**Evidence.** `session-manager.js`, `tests/hiring/session-manager.test.js`, [04b H17](04b-functionality-interview.md).
**Follow-up:** *"Why not store sessions in Redis?"* → It would allow several engines; we chose memory for simplicity and declared horizontal scaling out of scope.

### Q19 How do the programs talk to each other?

**Answer.** Browser to web app over HTTPS and server-sent events; browser to engine over a WebSocket with a ticket; web app and engine to worker through Redis Streams jobs; engine to the recruiter's live view through Redis pub/sub; worker and engine to the Python service over HTTP with a bearer token; and all of them share Postgres and object storage. Only storage keys cross the boundary to the Python service, never file paths.
**Evidence.** [2C](02c-module-interaction.md), [3.5](03-architecture-and-data.md#5-external-integrations).
**Follow-up:** *"Which call is synchronous?"* → Apply (including the resume parse), the token routes, and the live loop; everything else is queued.

### Q20 ★ How would this scale to ten or a hundred times the load?

**Answer.** Overload becomes delay because of the queue and fallbacks. At ten times, add worker processes (the consumer group supports it), a higher provider plan, and a second interview engine behind sticky routing. At a hundred times the live interviewer must be redesigned because its sessions live in one process's memory, and parsing should move out of the apply request. The system has never been load-tested, so these are reasoned limits, not measurements.
**Evidence.** [6.5.4](06-cross-cutting.md#654-what-breaks-at-10-and-at-100-scenario-reasoning).
**Follow-up:** *"What breaks first?"* → The provider limits (Groq and Deepgram), then the engine's 20-session cap.

### Q21 Why analyse the camera in the browser?

**Answer.** Privacy and cost: the browser computes face landmarks locally with MediaPipe and uploads only aggregated numbers (eye contact against the candidate's own baseline, head movement, blinks, expressions), not frames. It also avoids streaming video to our server for analysis. The recording itself, if the job enables it, is stored separately and can be deleted by the recruiter.
**Evidence.** `app/interview/[token]/lib/behavior-tracker.js`, `libs/interview/behavior.js`, [04b](04b-functionality-interview.md).
**Follow-up:** *"Is that accurate across skin tones and lighting?"* → Not tested; it is a listed gap and a proposed test in [5.5](05-ai-components.md#55-fairness-explainability-and-human-oversight).

---

## C. Resume parsing and screening

### Q22 ★ How does resume parsing work?

**Answer.** The apply route accepts a PDF, DOCX or TXT up to 5 MB, stores it under a random key, extracts text in memory (pdf-parse or mammoth), and sends the first 8,000 characters to the language model with a prompt that returns a fixed JSON structure (name, skills, experience, projects, education and so on). If the text is under 30 readable characters we record a parse error without calling the model; if the model fails we keep the text so the recruiter can re-parse later. The application is always saved.
**Evidence.** `libs/hiring/resume-text.js`, `libs/ai/prompts/resume.js`, `tests/hiring/resume-text.test.js`.
**Follow-up:** *"What about scanned PDFs?"* → There is no OCR [GAP]; they are flagged unreadable and score 0 with an explanation.

### Q23 The report says spaCy. Why do you use an LLM?

**Answer.** The code uses an LLM because it handles any layout and field without per-format rules, whereas a rule or NER pipeline needs tuning for each CV style. The report text predates the implementation and `docs/ai-hiring/18` lists the correction needed. The trade-offs are non-determinism, hallucination risk, a vendor dependency and per-call cost, which is why scoring is verified by code afterwards.
**Evidence.** `docs/ai-hiring/18-report-updates.md`, [5.1](05-ai-components.md#51-resume-parsing).
**Follow-up:** *"Is that change in the report yet?"* → **[Team: update the report before the viva.]**

### Q24 ★ How is the fit score computed?

**Answer.** The model receives the job and the candidate's structured profile with name, email, phone and location removed, plus up to 6,000 characters of CV text, and returns a score with matched and missing skills, experience and education verdicts, strengths, concerns and a rationale. The rubric in the prompt weights required skills 45, experience 30, projects 15 and education 10. Code then clamps the score, recomputes matched and missing skills from the CV text using synonyms, flags unsupported claims, removes the name from the text, and an unreadable CV gets 0 without a model call.
**Evidence.** `libs/hiring/fit-scorer.js`, `libs/ai/prompts/fit.js`, `tests/hiring/fit-postprocess.test.js`, [5.2](05-ai-components.md#52-resumejd-fit-scoring).
**Follow-up:** *"Is the 45/30/15/10 weighting computed in code?"* → No, it is guidance to the model; a stricter design would ask for four sub-scores and compute the sum ourselves (listed as future work).

### Q25 What if the model invents a skill?

**Answer.** The skill lists it reports are not trusted. Code searches the CV text, skills, titles, experience and projects for each required skill using whole-term, synonym-aware matching and replaces the model's matched and missing lists with its own result; a claim the text does not support is flagged `unverified`. The score itself remains the model's judgement, so a convincingly worded but wrong rationale is still possible.
**Evidence.** `postProcessFit`, `tests/hiring/fit-postprocess.test.js` (hallucinated skills).
**Follow-up:** *"Can a candidate game it with keyword stuffing?"* → Yes; the verifier matches presence, not depth, which is why the interview follows.

### Q26 Why not embeddings and cosine similarity?

**Answer.** Embeddings give a decent ranking but no explanation, no notion of "required", and no guard against a skill merely being mentioned. We needed reasons the recruiter can read and a rubric that matches the job. Embeddings could be added as a cheap pre-filter for large volumes, and are noted as a possible improvement, but they are not used anywhere today.
**Evidence.** [D.7](02d-foundational-concepts.md#d7-embeddings-and-similarity-scoring-not-used), [5.2 table](05-ai-components.md#52-resumejd-fit-scoring).
**Follow-up:** *"Why not train a ranker?"* → That needs thousands of labelled hiring outcomes, which we do not have.

### Q27 How do you choose the shortlist threshold, and what about ties?

**Answer.** The default is a minimum fit of 70 and a cap of 20 per job, both editable per job with validated ranges. The rule sorts by score descending, breaks ties by earliest application, keeps those at or above the threshold up to the cap, and counts people already shortlisted against the cap. The numbers 70 and 20 are defaults, not tuned values; no data exists to calibrate them [GAP].
**Evidence.** `libs/hiring/shortlist.js`, `tests/hiring/shortlist.test.js`, `libs/hiring/config.js`.
**Follow-up:** *"Can a recruiter shortlist someone below 70?"* → Yes, manually; the status machine allows it.

### Q28 Is the score reproducible?

**Answer.** Mostly but not exactly: temperature is 0.1 and the prompt and model are fixed, but language models are not deterministic, and the acceptance target is within 5 points on repeats. We record the model name and a version in the analysis, and the recruiter can re-screen. We have not measured the real run-to-run spread with the production model [GAP].
**Evidence.** `fit_analysis` fields, `docs/ai-hiring/06`, [5.6](05-ai-components.md#56-how-quality-was-measured-and-how-it-should-be).
**Follow-up:** *"How would you measure it?"* → Score the same ten CVs five times and report standard deviation.

### Q29 What happens if the same person applies twice at once?

**Answer.** The route checks for an existing application before doing any work, then takes a Postgres advisory lock on the job and email inside a transaction and checks again, so two simultaneous submissions produce one candidate and a 409 for the other. If the second one had already stored a file, it deletes it. Email comparison is case-insensitive.
**Evidence.** `app/api/hiring/apply/[jobId]/route.js`, [04a](04a-functionality-intake-screening.md).
**Follow-up:** *"Is there a database constraint?"* → Not a unique index on job and lower-cased email; uniqueness is enforced in code [PARTIAL].


---

## D. The AI interview

### Q30 ★ Walk us through one question-and-answer turn.

**Answer.** The interviewer speaks a question (synthetic voice, or the browser's voice if the voice server is down) and the candidate's microphone is closed while it speaks. When the voice finishes, the browser reports it, the microphone reopens, and streaming speech-to-text sends partial and final text. The answer ends when the candidate presses "I've finished my answer" or after about 8 seconds of silence. The engine then takes a lock, saves the answer, scores it in the background, runs the follow-up analysis, and either asks a follow-up or the next question, unless the candidate started talking again in the meantime.
**Evidence.** `libs/interview/session-engine.js`, [4B H17](04b-functionality-interview.md), `tests/hiring/session-engine.test.js`.
**Follow-up:** *"Where is the state?"* → In the session object in memory, with a snapshot to `interviews.state` every 15 seconds.

### Q31 How do you know the candidate has finished?

**Answer.** Two signals: an explicit "answer done" from the browser, or silence for `INTERVIEW_SILENCE_MS` (default 8,000 ms) measured from the last voice activity, re-checked when the timer fires. We count voice activity as well as transcript text because Whisper's final transcripts lag behind speech and ended answers too early in our first end-to-end run. A very short pause never ends an answer.
**Evidence.** Phase 5 log (`docs/ai-hiring/16`), `libs/interview/session-engine.js`.
**Follow-up:** *"What if they pause to think for 10 seconds?"* → The answer is processed; the follow-up logic may ask them to continue, and the button lets them control it.

### Q32 ★ What if the candidate starts talking while the system is deciding what to say?

**Answer.** That is the pre-speak guard. The engine takes a single-flight lock before its first `await`, notes how long the answer buffer was, and after the slow work checks whether the buffer grew by more than 10 characters. If it did, it abandons the planned question, rolls back the follow-up counters, merges the new words into the same answer, and re-schedules. A test with two speech results arriving during processing proves only one question is ever spoken.
**Evidence.** `session-engine.js`, `tests/hiring/session-engine.test.js` scenarios 4 and 5.
**Follow-up:** *"Why take the lock before the first await?"* → In JavaScript another event can run at any `await`; acquiring it first removes the window where two handlers both start.

### Q33 ★ How does the interviewer decide whether to ask a follow-up?

**Answer.** An analyzer checks seven conditions and the first one that fires is the reason: the answer is incomplete, opens a new topic, avoids an expected skill, contains a contradiction, shows deep experience, contains a natural cue to continue, or belongs to a multi-step question type. Three of them (new topic, contradiction, deep experience) are one call to a fast model; the other four are rules. A follow-up is asked only if the answer is not a refusal, fewer than two follow-ups have been asked on this question, and at least 3 minutes remain. If generation fails, a fixed sentence for that reason is used.
**Evidence.** `libs/interview/answer-analyzer.js`, `follow-up.js`, `tests/hiring/interview-modules.test.js`, [5.3.3](05-ai-components.md#53-interview-conducting-and-answer-evaluation).
**Follow-up:** *"Why do behavioural questions almost always get a follow-up?"* → That is inherited behaviour and intended, capped by the follow-up limit and the time budget.

### Q34 How are the questions generated, and how do you know the "ideal answer" is right?

**Answer.** One model call per job produces eight questions, each under 30 words, answerable aloud, with a 3–6 sentence ideal answer, 3–8 keywords and a weight; code validates and removes duplicates, and up to three attempts are made. We cannot guarantee the ideal answer is correct, which is why the recruiter can edit every question and why an interview takes a frozen copy. A wrong ideal answer would mis-score every candidate consistently, so this is the main quality risk of the interview score.
**Evidence.** `libs/interview/question-generator.js`, `libs/ai/prompts/questions.js`, `tests/hiring/question-generator.test.js`.
**Follow-up:** *"Did you evaluate the questions?"* → Not with a real model and a rater; the protocol is written in [5.6](05-ai-components.md#56-how-quality-was-measured-and-how-it-should-be).

### Q35 How is an answer scored, and what if the model fails?

**Answer.** The model compares the answer with the ideal answer and keywords using fixed bands (90–100 excellent down to 0–29 poor) and returns a score, reasoning and which keywords were covered or missed. The score is clamped to 0–100. If the call fails, a fallback score is computed as 0.7 times keyword coverage plus 0.3 times answer length (capped), so an outage never leaves a gap. The scoring runs in the background so it never delays the next question, and the candidate never sees it.
**Evidence.** `libs/interview/answer-scorer.js`, [5.3.4](05-ai-components.md#53-interview-conducting-and-answer-evaluation), `tests/hiring/interview-modules.test.js`.
**Follow-up:** *"Why is the scoring budget 1,500 tokens?"* → The model's hidden reasoning uses part of the budget; 500 produced empty replies.

### Q36 ★ How do you stop the interviewer hearing itself through the speakers?

**Answer.** Three layers: the microphone is closed while the interviewer speaks, with a short tail after the voice ends; an echo guard removes text that matches the question just spoken; and cleaning rules drop typical junk the speech model invents on silence. This came from a real interview whose transcript contained the question text repeated back and phantom sentences. Unit tests use lines from that real transcript.
**Evidence.** `libs/interview/echo-guard.js`, `libs/interview/stt/clean.js`, `tests/hiring/interview-conversation.test.js`.
**Follow-up:** *"Is it solved?"* → The rules are proven by tests on real lines; a full spoken interview after those fixes was not re-run live.

### Q37 How long does an interview last and how does it end?

**Answer.** The recruiter sets the length per job (5 to 120 minutes, default 25) and the interviewer plans around it: it asks as many of the question pool as fit and adds follow-ups only while the remaining questions keep their minimum time. The candidate gets warnings at a quarter of the length (at most 5 minutes) and at 1 minute, a new question is only started if at least 1.5 minutes remain, and at zero a partial answer gets a 60-second grace before the interview closes. It also ends when the questions run out or the candidate says or clicks "end the interview". Completion is recorded as completed if at least half the base questions were answered, otherwise abandoned.
**Evidence.** `session-engine.js`, [4B H17](04b-functionality-interview.md), `tests/hiring/session-engine.test.js` scenario 7.
**Follow-up:** *"Can the candidate pause?"* → Not deliberately; a dropped connection pauses the clock for up to 15 minutes.

### Q38 ★ What is the response time, and did you measure it?

**Answer.** The target is at most 4 seconds from the end of an answer to the start of the next question's audio. With a stub model the loop itself adds under 50 milliseconds, which shows the engine adds no meaningful delay. We have **not** recorded latency with the real model and speech providers, so we do not quote a real figure.
**Evidence.** Phase 5 log, `docs/ai-hiring/09`.
**Follow-up:** *"What dominates the latency?"* → The model calls and text-to-speech; the analyzer uses the fast model with low reasoning effort for exactly that reason.

### Q39 ★ How does it treat accents and non-native English?

**Answer.** By design, not by test. The prompts instruct the model to ignore transcription errors and never penalise accent; speech recognition is locked to English; communication metrics are a secondary 20 percent of the final score and are re-weighted if absent. But speech recognition errors lower keyword coverage for some speakers, and pace and filler measures may differ by language background. We have not measured word error rate by accent, and we list that test in the fairness protocol.
**Evidence.** `libs/ai/prompts/interview.js`, `finalWeights`, [5.4](05-ai-components.md#54-failure-modes-and-guards).
**Follow-up:** *"So can it be unfair?"* → Yes, and the recruiter sees the transcript and recording beside every score to catch it.

### Q40 What stops a candidate from cheating?

**Answer.** Nothing stops it; the system makes some cheating visible. It records tab-hidden and offline events, camera signals such as face absent or more than one face, and keeps the recording; three tab-hidden events or 30 seconds hidden raise an escalation so the item cannot be bulk-approved. We make no proctoring claim: a second device, an assistant off-screen or a whispered hint is undetectable.
**Evidence.** `interviews.integrity_events`, Integrity tab, `libs/agent/policy.js`.
**Follow-up:** *"Is it a proctoring product?"* → No; it is a screening interview with a human decision after it.

### Q41 Why Deepgram with a Whisper fallback, and Kokoro for the voice?

**Answer.** Deepgram `nova-3` streams interim results with end-of-speech detection, which gives live captions and a short delay; Whisper through Groq works in chunks and is the fallback when no Deepgram key is set. Kokoro-82M is a small open text-to-speech model we run ourselves, so there is no per-character cost, and the browser's own voice is the final fallback. The choice trades some quality for cost and independence.
**Evidence.** `libs/interview/stt/index.js`, `services/ai-engine/routers/tts.py`.
**Follow-up:** *"Was Kokoro tested for real?"* → With stand-in models only in the container; verify real audio on the demo machine before the viva.

### Q42 What does the candidate see, and what are they told?

**Answer.** They see the greeting, live captions, the interviewer's questions, a timer, and an End interview button. They never see scores, ideal answers or analysis (the engine's messages are checked in a test). Before anything is captured they must tick a consent statement that says the interview will be recorded (audio or audio and video), evaluated with the help of AI, and, if enabled, include analysis of eye and head movement and expressions.
**Evidence.** `app/interview/[token]/components/WelcomeStep.js`, `tests/hiring/session-engine.test.js` scenario 11, `libs/hiring/interview-views.js`.
**Follow-up:** *"Can a candidate refuse the camera?"* → The job setting controls it; a candidate who declines consent cannot start.

### Q43 What if the speech model hears words that were never said?

**Answer.** Speech models hallucinate on silence and noise ("Thank you", foreign words). We lock Whisper to English, filter text in other scripts for English interviews, drop known junk phrases and very low-confidence segments. Remaining errors lower an answer's keyword coverage, which is why the transcript and recording sit beside each score.
**Evidence.** `libs/interview/stt/clean.js`, `libs/ai/llm.js` (segment confidence), `STT_LANGUAGE`.
**Follow-up:** *"Does the cleaning ever delete real speech?"* → Possibly short genuine phrases; it errs towards removal of known junk only.

---

## E. Evaluation, decisions and the agent

### Q44 ★ How is the final score computed, and why those weights?

**Answer.** Final = 0.3 × resume fit + 0.5 × interview score + 0.2 × communication, compared with a threshold of 70, all editable per job. Missing parts are dropped and the remaining weights renormalised, so an interview without video does not fail the candidate. The weights are defaults chosen to put substance first and delivery last; they are not calibrated against hiring outcomes, and we say so.
**Evidence.** `libs/hiring/final-evaluator.js`, `libs/hiring/config.js`, `tests/hiring/final-evaluator.test.js`.
**Follow-up:** *"Why is communication only 20 percent?"* → Fairness: delivery signals depend on language, culture and equipment; they are secondary evidence.

### Q45 How is the communication score built, and is it valid?

**Answer.** It combines pace (full marks between 110 and 160 words per minute, falling to zero below 70 or above 210), fluency (pauses and filler words), eye contact against the candidate's own baseline, and composure from the speech emotion model, with weights 0.30, 0.30, 0.25 and 0.15, re-weighted over whatever exists, and the recruiter sees where each part came from. Pace and fluency are computed in Node from the audio and transcript, so the score does not depend on the Python service. The formulas are unit tested, but validity against human raters is unmeasured; on the one real recording we analysed it gave 59.
**Evidence.** `communicationScore` in `final-evaluator.js`, `libs/interview/voice-metrics.js`, [4C](04c-functionality-evaluation-decisions.md).
**Follow-up:** *"What is composure?"* → The share of neutral, calm or happy speech from an emotion model; it is a rough signal and is labelled as such.

### Q46 What does "needs review" mean?

**Answer.** It is the system saying "do not trust the number". It is suggested when fewer than half the questions were answered or there is no score, and the supervised agent also escalates scores within 5 points of the threshold, unreadable CVs and integrity flags. A needs-review item is never applied automatically and is skipped by bulk approval.
**Evidence.** `suggestDecision`, `finalEscalations`, [4C](04c-functionality-evaluation-decisions.md).
**Follow-up:** *"Who decides then?"* → The recruiter, by hand.

### Q47 ★ Can the system reject a candidate without a human?

**Answer.** Not by default. Each job has `autoFinalize`, which is off; with it off every final decision waits for the recruiter. If a recruiter turns it on, the system applies the suggestion only when it is not needs-review, the candidate is still in the right state and no supervised agent manages the job, and it records "system" as the decider. Even then the supervised agent's own policy asks about every adverse action in both modes.
**Evidence.** `libs/hiring/config.js`, `libs/hiring/finalize.js`, CLAUDE.md rule 6.
**Follow-up:** *"Is that a legal safeguard?"* → It is a design safeguard; no legal review was done.

### Q48 ★ What does the supervised agent do, and why isn't it a free-roaming LLM agent?

**Answer.** It is a rule-driven workflow that wakes on events and, for each action (write post, publish, screen, shortlist, hold back, invite, final decision, hire), consults a policy table that says automatic, ask the recruiter, or human only. In Assisted mode publishing, shortlisting, inviting and final decisions ask; in Autopilot publishing, shortlisting and invites run automatically up to a daily cap, but holding anyone back and every final decision still ask, and hiring is always human. An LLM that chose its own actions would be unauditable, so AI is used inside fixed steps, and every request has evidence and a `dedupe_key`.
**Evidence.** `libs/agent/policy.js`, `tests/hiring/agent-policy.test.js`, [M11](02b2-conceptual-modules-cont.md).
**Follow-up:** *"What if the recruiter acts manually?"* → Their action wins and the agent's queued requests for that candidate are withdrawn.

### Q49 How would you explain a decision to a recruiter, or to a rejected candidate?

**Answer.** To the recruiter: the score breakdown with weights, matched and missing skills with reasons, each answer's score with the model's reasoning and keyword coverage, the transcript linked to the recording, and the communication components with their sources. To the candidate: today only a generic outcome email if enabled; we implement no right-to-explanation or human-review request, which is a gap we would close first.
**Evidence.** `libs/hiring/interview-views.js`, [5.5](05-ai-components.md#55-fairness-explainability-and-human-oversight).
**Follow-up:** *"Is that compliant?"* → We make no compliance claim.

### Q50 Why is the final decision a formula and not the LLM's recommendation?

**Answer.** A formula is deterministic, testable and explainable, whereas a model's recommendation changes between runs and cannot be audited. The model still writes a short summary and a recommendation label for the recruiter, but the decision threshold uses numbers we can unit test. This is the same principle everywhere: the model judges text, code decides outcomes.
**Evidence.** `suggestDecision`, `FINAL_SYSTEM` prompt, [5.7](05-ai-components.md#57-other-ai-uses).
**Follow-up:** *"Doesn't the formula inherit the model's errors?"* → Yes, through the scores it uses; that is why humans approve.

---

## F. AI quality, fairness and ethics

### Q51 ★ Which parts are real machine learning, which are API calls, and which are rules?

**Answer.** We trained no model. Pre-trained models we use through APIs or open weights are the language models (Groq), Deepgram or Whisper for speech recognition, Kokoro for voice, Wav2Vec2 for speech emotion and MediaPipe for face landmarks. Everything that decides an outcome is rule-based code: threshold and shortlist, final score, escalations, status transitions, rate limits, and the agent's policy. The table in 5.0 classifies every component.
**Evidence.** [5.0](05-ai-components.md#50-classification-ml-llm-call-or-rule-based).
**Follow-up:** *"So what is your AI contribution?"* → The system around the models: rubrics, verification, fallbacks, a real-time conversation loop, signal processing and human-in-the-loop controls.

### Q52 ★ Isn't this just a ChatGPT wrapper?

**Answer.** A wrapper forwards text to a model and prints the answer. Here the model is called at about a dozen defined points, and each call is surrounded by our logic: personal fields removed before scoring, outputs validated and re-derived, fixed rules for decisions, and fallbacks if the model is absent. The prompts are about 350 lines against tens of thousands of lines for the queue, the real-time loop with locks and recovery, the recording pipeline, signal processing, the agent policy and the tests. Without the model the platform still runs on its fallbacks; without our code the model has nothing to talk to.
**Evidence.** [5.8](05-ai-components.md#58-isnt-this-just-a-chatgpt-wrapper).
**Follow-up:** *"But the judgement is the model's."* → Of text quality, yes; the structure that makes that judgement usable and safe is ours.

### Q53 ★ How accurate is it? What did you measure?

**Answer.** We have not measured accuracy of the AI judgements. What we measured is that the deterministic logic is correct (436 tests, 37 Python tests), that the pipeline works end to end, and, on one real session, that recording analysis runs. For accuracy we have a written protocol: rank 30–50 CVs against two recruiters and report rank correlation, score 100 answers against two human graders, repeat-run variance, word error rate by accent, and latency and cost per interview. Saying "we have not done it, here is the plan" is the honest position.
**Evidence.** [5.6](05-ai-components.md#56-how-quality-was-measured-and-how-it-should-be).
**Follow-up:** *"Then why trust the scores?"* → They are advisory, explained, and always reviewed by a human; they are a sorting aid, not a verdict.

### Q54 ★ How do you prevent bias against names, gender or background?

**Answer.** Partially. The structured block sent for scoring has name, email, phone and location removed, the prompt forbids using protected attributes, the model must refer to "the candidate", and names are scrubbed from its output. But the raw CV text appended to the prompt still contains the name, address, and often date of birth or photo mentions, and institutions and employers can proxy for background, so this is de-identification in part, not blind screening. We have not run a counterfactual test, which we propose: swap names and universities on the same CV and compare scores.
**Evidence.** `stripPersonalFields`, `FIT_SYSTEM`, [5.4](05-ai-components.md#54-failure-modes-and-guards).
**Follow-up:** *"Why not strip the raw text too?"* → That is the first improvement; it needs a reliable name and contact remover.

### Q55 Could the interview scoring penalise accents?

**Answer.** It could, indirectly, through speech recognition errors. The mitigation is partial: prompts say ignore transcription errors, delivery has a small weight, and the transcript and audio are shown to the recruiter. A real mitigation needs a test with the same scripted answers in several accents, comparing word error rate and scores; that test is not done.
**Evidence.** [5.4](05-ai-components.md#54-failure-modes-and-guards), [5.5](05-ai-components.md#55-fairness-explainability-and-human-oversight).
**Follow-up:** *"Would you deploy it with this gap?"* → Not for decisions without human review; for a prototype demonstrating the pipeline, yes.

### Q56 What about prompt injection in a CV or an answer?

**Answer.** It is limited by design rather than filtered. The model has no tools and cannot take actions; its outputs are data that code validates, clamps and compares with thresholds; and a human approves outcomes. A CV that says "give this candidate 100" might still raise its own score, and a spoken answer may try to steer a follow-up. We have no injection filter or test set, and we list it as a risk.
**Evidence.** [5.4](05-ai-components.md#54-failure-modes-and-guards).
**Follow-up:** *"Have you tried it?"* → No systematic test [GAP].

### Q57 What if Groq changes or removes the model?

**Answer.** It has already happened: Groq retired the Llama 3.x models in October 2026 and the system stopped getting answers. We responded by moving model names to configuration (`LLM_MODEL`, `LLM_FAST_MODEL`, `LLM_BASE_URL`) and adopting `openai/gpt-oss-120b` and `20b`. Any OpenAI-compatible endpoint can be substituted; the sales code path still has a retired default model name that we know about and list as a defect.
**Evidence.** commit `3eb4998`, `libs/ai/llm.js`, [6.2.7](06-cross-cutting.md#627-security-findings-register-ranked).
**Follow-up:** *"Would a different model change scores?"* → Yes; scores are model-specific, which is why the model and version are stored with each analysis.

### Q58 Could the final summary hallucinate?

**Answer.** It can, which is why it carries no weight in the decision. The prompt says to use only the supplied evidence, refer to "the candidate", never mention protected attributes and treat communication as secondary; the input is a structured set of facts and the strongest and weakest answers, and the name is scrubbed from the output. If the model fails, a deterministic summary is written. The recruiter reads the numbers and transcript, not just the narrative.
**Evidence.** `FINAL_SYSTEM`, `libs/hiring/final-evaluator.js`.
**Follow-up:** *"Is there a way to check?"* → The summary lists strengths and risks that can be checked against the per-answer scores shown beside it.

### Q59 Is analysing faces and expressions ethical and legal?

**Answer.** It is the most sensitive feature, so it is opt-out per job (`trackBehavior`), requires explicit consent that names it, is computed on the candidate's own device, and uploads numbers only. The score treats it as a small signal relative to the candidate's own baseline and labels it "signals, not verdicts". We did not do a legal review of face-related processing, and landmark accuracy across skin tones, lighting and cameras is untested; with those gaps a cautious deployment would leave it off.
**Evidence.** `app/interview/[token]/lib/behavior-*.js`, `WelcomeStep.js`, [6.3](06-cross-cutting.md#63-privacy-and-data-protection).
**Follow-up:** *"Does it identify people?"* → No; there is no recognition or matching.

### Q60 How much does the AI cost per candidate?

**Answer.** We can state the maximum number of model calls but not dollars. An application costs two calls (parse and fit score). An interview with eight questions and two follow-ups each can reach 57 calls and about 69 thousand output tokens as an absolute ceiling set by the token caps; the 25-minute budget makes real use far lower. We did not log token usage and no provider prices are recorded, so we propose logging usage and measuring ten interviews.
**Evidence.** [6.5.6](06-cross-cutting.md#656-ai-cost).
**Follow-up:** *"How do you control cost?"* → The funnel (screen first, interview only shortlisted), a fast model for frequent calls, input truncation, follow-up and time caps, local voice and analysis.

### Q61 ★ Should an AI be allowed to influence hiring decisions at all?

**Answer.** As a decision aid with a human accountable, yes; as an unsupervised judge, no, and the system is built around that. Rejections need approval by default, the supervised agent asks about every adverse action, scores come with reasons, delivery signals are minority evidence, and the recruiter can override anything. Our remaining obligations are an accuracy and fairness evaluation, candidate transparency and a way to ask for human review, none of which are done yet.
**Evidence.** CLAUDE.md rule 6, [5.5](05-ai-components.md#55-fairness-explainability-and-human-oversight).
**Follow-up:** *"What is the worst thing that could happen?"* → A recruiter over-trusting a score; the interface shows evidence before the number to counter that.


---

## G. Security and privacy

### Q62 ★ How is a candidate's interview link secured?

**Answer.** The link carries a 256-bit random token. We store only its SHA-256 hash, so a database leak does not yield working links. Each access checks the token's shape, the hash, the status and the expiry (72 hours by default), applies a per-token rate limit, and returns identical 404 pages for unknown or replaced tokens. A reminder email mints a new token and the old link stops working; the live connection uses a separate 10-minute signed ticket so the long-lived link never reaches the engine.
**Evidence.** `libs/interview/tokens.js`, `libs/interview/public-access.js`, `tests/hiring/tokens.test.js`, [6.1.3](06-cross-cutting.md#613-credential-catalogue).
**Follow-up:** *"What if the email is forwarded?"* → Whoever holds the link can use it until it expires or is replaced; that is the nature of a capability link, and only one session can be active at a time.

### Q63 How are passwords and sessions stored?

**Answer.** Passwords are hashed with bcrypt at cost 12; the database never holds a plain password. Sessions are signed JSON Web Tokens issued by NextAuth, and on every request the user's role and modes are re-read from the database so changes take effect immediately even though a JWT cannot be revoked. There is no login throttling, email verification, password reset by email or multi-factor sign-in yet.
**Evidence.** `app/api/auth/register/route.js`, `libs/next-auth.js`, [6.1](06-cross-cutting.md#61-authentication-and-authorization).
**Follow-up:** *"Session lifetime?"* → The NextAuth default (30 days); we did not tune it.

### Q64 ★ What security weaknesses do you know about?

**Answer.** We audited all 167 API handlers and found nine, all in the older sales half or in developer tools, with no login check: editing a message (with mass assignment), generating messages, reading a campaign's lead names, a paid scraper, two LinkedIn invite routes whose "internal call" header is only logged, and three database development utilities. We also found a published default cron secret, no HTTP security headers, no rate limiting on sign-up, sign-in and apply, platform cookies stored unencrypted, and an incomplete example environment file. None touches hiring data; all are ranked with small fixes in the register, and we would not expose the system to the internet before closing the first six.
**Evidence.** [6.2.7](06-cross-cutting.md#627-security-findings-register-ranked).
**Follow-up:** *"Why did you leave them?"* → They sit in the older module, were found by our own scan late, and the fix list was written before fixing; we want the route-protection test first so it cannot recur.

### Q65 How do you protect file uploads?

**Answer.** For resumes: an allow-list of extensions (PDF, DOCX, TXT), a 5 MB limit, a random storage name (the user's filename is never a path), path-traversal checks on storage keys, and downloads only through five-minute signed links served as attachments with `nosniff`. For recordings: only after consent, only for a valid token, 10 MB parts, WebM only, and camera data validated and normalised. We do not sniff file content, scan for malware, or sandbox the PDF and DOCX parsers.
**Evidence.** `libs/hiring/resume-text.js`, `app/api/interview/[token]/upload/route.js`, [6.2.3](06-cross-cutting.md#623-the-upload-path-step-by-step).
**Follow-up:** *"What if someone uploads a malicious PDF?"* → It could crash or stall the parser for that request; moving parsing into the worker with a timeout is on the fix list.

### Q66 What about SQL injection, XSS and CSRF?

**Answer.** Queries use Drizzle's parameterised builders or its `sql` tag, which binds values, and there is no raw SQL on user input outside a fixed development migration route. React escapes output, the two `dangerouslySetInnerHTML` uses are static content, and emails escape every interpolated value. NextAuth protects its own endpoints against cross-site requests; our JSON API routes rely on the session cookie's same-site default and have no separate CSRF token, and no security headers such as CSP are set yet.
**Evidence.** [6.2.2](06-cross-cutting.md#622-input-validation-and-sanitisation-by-entry-point), [6.2.6](06-cross-cutting.md#626-owasp-top-10-2021-mapped-to-raasta-ai).
**Follow-up:** *"Is that enough?"* → For the hiring routes' threat model, mostly; headers and a global route guard are the next steps.

### Q67 ★ How do you handle candidates' personal data?

**Answer.** We collect only what the application and interview need, take consent before recording, strip identifying fields before the scoring call, show candidates no scores, keep links hashed, and serve files through short-lived signed links. We do not yet delete anything automatically, offer a candidate access or deletion request, or encrypt stored CV text and transcripts at application level, and we have not assessed ourselves against a specific data-protection law. We would present those as the privacy work required before any real deployment.
**Evidence.** [Part 3 §4](03-architecture-and-data.md#4-data-lifecycle-and-protection-of-personal-data), [6.3](06-cross-cutting.md#63-privacy-and-data-protection).
**Follow-up:** *"Is the interview recording biometric data?"* → Face video may be treated that way in some jurisdictions; no legal review was done.

### Q68 Which third parties receive candidate data?

**Answer.** Groq receives CV text (up to 8,000 characters for parsing, 6,000 for scoring, without identifying fields in the structured part) and interview answers; Deepgram receives live audio (or Groq Whisper receives audio chunks); Mailgun receives the candidate's email address, first name and job title; storage holds files. Provider data-processing terms are not recorded in the repository. Self-hosted models are an alternative for sensitive deployments.
**Evidence.** [Part 3 §5](03-architecture-and-data.md#5-external-integrations).
**Follow-up:** *"Do those providers train on the data?"* → We have not reviewed their terms [GAP].

### Q69 How do you prevent abuse such as spam applications?

**Answer.** Today we mainly do not: the public apply route has no rate limit or CAPTCHA and each application triggers a model parse and a fit call, so spam costs money. What exists is duplicate detection, size and type checks, per-token limits on candidate routes, and per-account quotas for platform actions. A Redis limiter already exists in the code base and can be applied to apply, register and sign-in in a few hours.
**Evidence.** `libs/hiring/rate-limit.js`, [6.2.4](06-cross-cutting.md#624-rate-limiting-and-abuse-control-consolidated).
**Follow-up:** *"Priority?"* → Third in the risk register, after closing the open routes and the default cron secret.

### Q70 Where are secrets kept?

**Answer.** In environment variables only; `.env*.local` files are git-ignored and only `.env.example` is tracked. Secrets that the code needs fail closed when missing or too short: the interview ticket and storage signing secrets must be 32 characters or more, and the Python service returns 503 without its token. Logs never contain tokens, tickets, resume text or keys, by rule and by masking. The cron secret's published default and the incomplete example file are known exceptions.
**Evidence.** `.gitignore`, `libs/interview/tokens.js`, `services/ai-engine/main.py`, [6.2.5](06-cross-cutting.md#625-secrets-management).
**Follow-up:** *"Has a key ever leaked?"* → The team's working notes record one development incident where a debugging command printed a Deepgram key to a terminal; the rule since is to print only "set/empty and length". **[Team: confirm that key was rotated.]**

### Q71 If the database leaked tomorrow, what would the attacker get?

**Answer.** Candidates' names, emails, CV text and structured data, interview transcripts, scores, and the recruiter accounts' bcrypt hashes. They would not get working interview links (hashes only) or plaintext passwords. They would get the stored LinkedIn, Rozee.pk and Indeed session cookies in readable form, which is the worst item and number 6 in our register. Recordings are in object storage, not the database.
**Evidence.** [4.4 of Part 3](03-architecture-and-data.md#4-data-lifecycle-and-protection-of-personal-data), SEC-07.
**Follow-up:** *"How would you fix that?"* → Encrypt the session columns with an authenticated cipher and a key from the environment.

---

## H. Platforms and client acquisition

### Q72 ★ How does the LinkedIn automation work, and is it allowed?

**Answer.** The user connects an account once; the system stores the logged-in browser session and later replays it in Playwright to send connection invites and messages, with daily quotas (30 invites and 10 messages by default), random human-like delays, and acceptance checks. LinkedIn's terms restrict automated access, so account restriction is a real risk that the project owner has accepted in writing, and automation should use an account that can be lost. No legal opinion was obtained.
**Evidence.** `libs/linkedin-*.js`, `libs/rate-limit-manager.js`, CLAUDE.md conventions, [6.4](06-cross-cutting.md#64-third-party-platform-automation-legal-and-ethical-position).
**Follow-up:** *"Why not the official API?"* → Posting and messaging APIs require partner approval; for a student project that was not available.

### Q73 How do Rozee.pk and Indeed postings work, and why not an API?

**Answer.** Neither offers an open posting API. Rozee.pk's post-a-job page is now an AI wizard that spends a credit at the last step, so we automate up to the draft in a visible browser window and leave publishing to the recruiter; Indeed blocks background automation behind a bot check. The posting engine opens a visible browser on the recruiter's machine, types the post like a person, reads each field back and hands over at every check; the browser extension or "copy and open" give a no-automation route.
**Evidence.** `docs/ai-hiring/19 §5d–5g`, `libs/poster/**`, `extensions/raasta-poster/`.
**Follow-up:** *"Is it verified on the real sites?"* → Against practice sites in a real browser; the first live Indeed runs hit a block page and then a paused account, so live verification is incomplete.

### Q74 What happened to the Indeed account?

**Answer.** During the first live runs on 7–8 October the engine's window was shown a verification block page, and the owner's test employer account was then paused by Indeed with a message about unusual login activity. The cause is unknown: it could have been the automation, a nonsense test job posted on 6 October, or the account details. We stopped live runs against that account, recognise both pages in the engine, and use the practice site for demonstrations.
**Evidence.** `docs/ai-hiring/19 §5f`, project memory.
**Follow-up:** *"So it doesn't work on Indeed?"* → The assisted path (extension and copy-and-open) works because a person does the posting; the automatic path is unproven live.

### Q75 Is the lead scoring machine learning?

**Answer.** No. For Rozee.pk job leads `scoreRozeeJobLead` starts at 28 and adds points for evidence of a real, specific vacancy (company name, title, location, a long description, several skills, salary), capped at 100, with tier A at 72 and above, B at 52 and above, otherwise C. It decides how personalised the message is. It is a transparent heuristic for prioritising, not a prediction of conversion, and no data exists to validate it.
**Evidence.** `libs/lead-conversion.js`, [M15](02b2-conceptual-modules-cont.md).
**Follow-up:** *"Why those numbers?"* → Chosen by judgement; unvalidated.

### Q76 How do you avoid being banned by the platforms?

**Answer.** Quotas per account with a rolling 24-hour reset, minimum gaps and daily caps on posting, random delays between actions, stopping at any check or checkpoint, cool-offs after a block or pause, and visible-window hand-over for sensitive steps. These reduce the risk but cannot remove it, and the owner accepts the remainder. A paused Indeed account shows it is real.
**Evidence.** `libs/rate-limit-manager.js`, `PUBLISH_DAILY_CAP_*`, `POSTER_PAUSED_COOLOFF_HOURS`.
**Follow-up:** *"Do you use stealth tools?"* → Allowed by the owner's decision of 7 October but off by default in the posting engine; a visible window with a person comes first.

### Q77 Why both a posting engine and a browser extension?

**Answer.** They trade automation for safety differently. The engine fills the form itself in its own visible window with human-like typing and hands over at every decision; the extension runs in the recruiter's normal signed-in browser, shows the job's fields beside the platform's form with Copy and Fill buttons, and automates nothing the person does not click. The extension is the lower-risk fallback when the engine's window is blocked.
**Evidence.** `libs/poster/engine.js`, `extensions/raasta-poster/`, `tests/hiring/poster-*.test.js`.
**Follow-up:** *"Which one would you demo?"* → The practice site with the engine, and the extension on a stand-in page.

---

## I. Testing, deployment, performance and cost

### Q78 ★ How did you test the system?

**Answer.** There are 436 JavaScript tests in 42 files and 37 Python tests, all passing on 8 October. They test the logic that decides things: scoring post-processing, shortlist, status transitions, tokens, the final-score formulas, the agent policy, and the live interview loop with fake clocks and a fake language model, plus real-browser tests for the extension and posting engine against stand-in pages. Each phase also had an end-to-end acceptance run on a local database with throw-away users, recorded in the progress log.
**Evidence.** [6.7](06-cross-cutting.md#67-testing-and-coverage), `docs/ai-hiring/16`.
**Follow-up:** *"What is the coverage percentage?"* → Not measured; the Node runner can report it with one flag.

### Q79 What is not tested?

**Answer.** React components, the HTTP route layer as a whole (which is how the open routes slipped through), the quality of the model's judgement, the live LinkedIn, Rozee.pk and Indeed sites, and load or soak behaviour. The sales module has no automated tests. A single test asserting that every API route is either wrapped in the login check or on an allow-list would have caught the security findings.
**Evidence.** [6.7.4](06-cross-cutting.md#674-what-is-not-tested-say-this-before-the-panel-asks).
**Follow-up:** *"Why not write them?"* → Priority went to the hiring pipeline; they are in the future work list.

### Q80 ★ How is it deployed? Is there CI/CD?

**Answer.** It is not deployed. It runs on a developer machine with `npm run serve` (a production build on port 8085) with the worker started by the web server and the engines started from the Setup guide. Only the Python service has a Dockerfile; a Compose and nginx deployment is specified in `docs/ai-hiring/15` but is the unstarted Phase 9, and there is no CI, so the quality gates are commands run by hand. A minimal pipeline of lint, branding check and both test suites is drafted in Part 6.
**Evidence.** [6.8](06-cross-cutting.md#68-deployment-pipeline).
**Follow-up:** *"Could you deploy tomorrow?"* → To a single VM with Compose after the security fixes, TLS and the secrets; our estimate is about a day for the files plus a rehearsal.

### Q81 What performance numbers do you have?

**Answer.** Measured: visiting the main screens took about 51 seconds in development mode against about 2.5 seconds in production mode on a dual-core laptop; the interview loop adds under 50 ms with a stub model; and one real 14-minute recording was analysed. Not measured: API latency percentiles, real-model response time, memory per interview, how many simultaneous interviews one engine carries (the configured cap is 20), and anything under load.
**Evidence.** [6.5.1](06-cross-cutting.md#651-what-was-actually-measured), `docs/ai-hiring/21`.
**Follow-up:** *"So you can't say it scales?"* → Correct; we can say where it will break first and why.

### Q82 What do you need to configure to run it?

**Answer.** PostgreSQL and Redis, a Groq key, an interview ticket secret, a storage signing secret, an AI-engine token shared by the engine, worker and Python service, plus the public URLs; Deepgram and Mailgun keys are optional because Whisper and a local outbox take over. Missing keys degrade rather than crash: no model key means fallbacks, no Redis means no background progress but the application is still saved. The example environment file lists only the hiring names, so it is not a complete checklist.
**Evidence.** [6.9](06-cross-cutting.md#69-environment-configuration), `docs/ai-hiring/15`.
**Follow-up:** *"How do you start everything?"* → `npm run serve` starts the web app and worker; the Setup guide starts the engine and AI engine.

---

## J. Process, lessons and future

### Q83 ★ What was the hardest problem, and what did you learn?

**Answer.** Making a live conversation reliable. A spoken interview has concurrent events: speech results arriving while a model call is running, the candidate talking over the system, echo, dropped connections, and models that think silently. We solved it with a lock taken before any await, a pre-speak guard with rollback, half-duplex microphone control, snapshots and resume, and fallbacks for every model call, each proven by a test. The lessons: specify before coding, test with fakes and then confirm with real runs (which found the recording-join failure and the reasoning-token bug), and make failures visible instead of silent.
**Evidence.** [7.4](07-implementation-journey.md#74-real-world-incidents-that-changed-the-design), [7.5](07-implementation-journey.md#75-lessons-learned).
**Follow-up:** *"Biggest mistake?"* → Starting the hiring work without a specification on 2 October; we reverted it within about 30 minutes and wrote one.

### Q84 ★ What is the project's biggest weakness, and what would you do next?

**Answer.** The biggest weakness is that the AI's judgement is unvalidated: we can show the pipeline works and the logic is correct, but not that the scores agree with human raters or are fair across names and accents. Next: close the open routes and add the route-protection test (hours), add rate limiting and CI (a day), run the rank-correlation and counterfactual studies, add retention and candidate data rights, then the Compose deployment and a load test. A longer list with priorities is in Part 9.
**Evidence.** [6.10](06-cross-cutting.md#610-consolidated-risk-register-what-to-fix-first), [Part 9](09-future-work.md), [8B](08b-weaknesses-demo-cheatsheet.md).
**Follow-up:** *"If you had only one week?"* → Security fixes, the evaluation study on 30 CVs and 50 answers, and a recorded demo as backup.

---

## Appendix: where the honest answer is "not done"

Use this as a revision list. If a question lands on one of these, say so first, then give the plan.

| Topic | Questions | What is missing |
|---|---|---|
| Authorship of the earlier prototype | Q5 | one truthful sentence on who wrote it and its licence |
| Gap in commits, supervisor dates, individual contributions | Q7, Q10 | facts outside the repository |
| Report still says spaCy | Q23 | update the report |
| Run-to-run variance, threshold calibration | Q27, Q28 | measurements |
| Question and answer-scorer quality | Q34, Q35 | rater study |
| Real-model latency | Q38 | measurement |
| Accent, name and camera fairness | Q39, Q54, Q55, Q59 | counterfactual and accent tests |
| Prompt-injection testing | Q56 | adversarial test set |
| Accuracy | Q53 | evaluation protocol in 5.6 |
| Cost in money | Q60 | usage logging and a 10-interview run |
| Security fixes | Q64, Q65, Q66, Q69 | register items SEC-01 to SEC-12 |
| Data rights and retention | Q67, Q68, Q71 | purge job, subject-access path, encryption |
| Live platform verification | Q73, Q74, Q76 | Indeed account paused; Rozee.pk wizard not yet verified live |
| Deployment, CI, load | Q80, Q81 | Phase 9 |
| Tests of UI, routes, sales | Q79 | not written |
