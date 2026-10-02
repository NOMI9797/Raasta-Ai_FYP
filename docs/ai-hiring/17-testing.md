# 17 · Testing

The repo has no JS test runner yet. Use Node's built-in runner (`node --test`) run through `tsx` so `libs/db.ts` imports work: `npm run test:hiring` (`tsx --test tests/hiring/*.test.js`; Node 21+ no longer expands a directory argument). Python tests use `pytest` in `services/ai-engine/tests/`.

## 1. Fixtures (`tests/fixtures/`)
- `jobs/devops-engineer.json`: a fixture job (title, formal description, required skills `["Docker","Kubernetes","AWS","CI/CD","Terraform","Linux"]`, experience `2-4 years`).
- `resumes/`: 10 synthetic resumes (`.txt` and a few `.pdf`/`.docx`) with **made-up people**:
  - 3 strong matches, 3 partial, 2 unrelated (e.g. graphic designer), 1 empty or unreadable PDF, 1 duplicate email.
- `interview/answers/`: short 16 kHz mono WAV clips (record your own voice or generate with TTS):
  - `greeting-ready.wav` ("Yes, I'm ready")
  - `q1-strong.wav`, `q1-weak.wav` ("I don't know, maybe Docker")
  - `q2-long-with-pause.wav` (includes a 5s pause mid-answer)
- `interview/recording/`: one short `audio.webm` and `video.webm` for ai-engine tests.

Never use real candidates' resumes or recordings in the repo.

## 2. Unit tests (`tests/hiring/`)

| File | Covers |
|---|---|
| `statuses.test.js` | `canTransition` matrix; every status has metadata; Kanban stage mapping |
| `config.test.js` | defaults merge, weight normalisation, validation bounds |
| `fit-postprocess.test.js` | clamping, synonym matching, hallucinated-skill removal, parseError handling (LLM mocked) |
| `shortlist.test.js` | threshold + top-N behaviour, ties by `appliedAt`, already-shortlisted count (DB mocked or test schema) |
| `tokens.test.js` | hash stability, ticket sign/verify/expiry/typ check |
| `answer-analyzer.test.js` | each of the 7 conditions with fixed texts (LLM mocked) |
| `answer-scorer.test.js` | fallback scoring formula; JSON parsing |
| `session-engine.test.js` | **critical** (see below) |
| `final-evaluator.test.js` | communication score formula, missing components → renormalised, final score, `needs_review` guard, autoFinalize on/off |

### `session-engine.test.js` scenarios (fake timers, fake deps)
Fake deps: `llm` returns scripted JSON, `tts` returns a tiny buffer, `repo` records calls in memory, `send` collects messages, `now` is controllable.
1. Greeting → candidate says "yes ready" → Q1 asked, and the buffer is empty when Q1 is asked.
2. Answer + 8s silence → response saved → next question asked.
3. Answer + `answer_done` → immediate processing.
4. **Concurrency:** two STT finals arrive while processing → only one question is spoken.
5. **Pre-speak guard:** the candidate keeps speaking (> 10 characters) during processing → no question is spoken, the follow-up depth is rolled back, and a reschedule happens.
6. Follow-up cap: the analyzer always says follow-up → max 2 follow-ups, then the next base question.
7. Time budget: at < 1.5 min left → closing instead of a new question; `time_warning` messages are sent.
8. Questions exhausted → closing turn, `interview_complete`, `repo.complete` called, `enqueue('analyse-interview')`.
9. Resume: `serializeState()` → new session from that state → re-asks the current question.
10. Scoring: the score is written for a base question even after it left the queue (the regression from the legacy code).
11. Never sends `score` or `idealAnswer` to the candidate channel (inspect all `send` payloads).

## 3. Integration tests (manual or scripted)
- `scripts/interview-test-client.js <interviewToken>`: calls `/session`, connects to the WS, sends `ready`, streams the fixture WAVs as PCM frames in real time, responds `ai_done_speaking` after each `ai_speaking`, and prints all messages. Use it for the Phase 5 acceptance and the Phase 9 load test (run 3 in parallel).
- Worker: enqueue each job type against a dev DB and assert the state changes.
- ai-engine: `pytest` hitting each router with fixture media.

## 4. End-to-end demo script (for evaluation day)
1. Log in as a recruiter → create the job "DevOps Engineer" → generate the post → (skip publishing) → open the Hiring automation card: minFitScore 70, maxShortlist 3, autoInvite on, autoFinalize off.
2. Run `node scripts/seed-hiring-demo.js` (or submit 5 applications through `/apply/[jobId]`).
3. Show screening results: fit scores, matched/missing skills, top 3 shortlisted.
4. Show the generated interview questions; edit one live.
5. Open the invite email (Mailgun sandbox / test inbox) → click **Start my interview** on a second laptop.
6. Take the interview (2–3 questions, `questionCount` 3 for the demo). Meanwhile, the recruiter shows the **Live** tab.
7. After completion: show the analysis progress → Summary tab (final score, recommendation), Q&A with scores, transcript and recording.
8. Decisions queue → accept the suggestion → candidate becomes **Final shortlisted** → mark **Hired**.
9. Optionally show the agent pipeline run with checkpoints.

Have a backup: a pre-recorded completed interview in the seed data in case the network fails.

## 5. Quality gates before merging to `main`
- `npm run lint`, `npm run build`, `npm run check:branding`, `npm run test:hiring`, `pytest services/ai-engine/tests` all pass.
- No new hard-coded status strings; no secrets in the diff (`git diff main --stat` + review).
