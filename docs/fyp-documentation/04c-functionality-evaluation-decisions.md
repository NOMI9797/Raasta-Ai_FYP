# Part 4C · Functionality Deep Dive: Evaluation, Decisions, Agent, Recruiter Views

[← Index](README.md) · Previous: [Part 4B](04b-functionality-interview.md) · Next: [Part 4D · Publishing](04d-functionality-publishing.md)

**Features in this file:** H24 Voice metrics and communication score · H25 Final evaluation and the second shortlist · H26 Decisions · H27 Recruiter interview views · H28 Supervised recruiter agent · H29 Hiring analytics and Home overview · H30 Notifications · P15 Python AI-engine endpoints.

---

## H24 · Analysis of the recording and the communication score

**Purpose.** Measure *how* the candidate spoke and behaved, without needing the Python service to be up.

**Trigger.** Worker job `analyse-interview {interviewId, force?}` (queued by the engine at the end of the interview; re-queued every 30 s while uploads finish; also by *Re-analyse* with `force: true`).

**Flow (`libs/interview/analysis.js` `analyseInterview`).**
1. Guards: interview exists and is `completed`; recording not `deleted`; skip if already `complete` unless forced. If `recording_status` is not `complete`/`failed` and the interview ended less than **10 minutes** ago → `{waiting:true}` and the handler re-queues (30 s). Otherwise `assembleRecording` (see H21) and continue with what exists.
2. Set `analysis_status = processing`. Load `interview_turns`; `buildSegments(turns)`: for each candidate turn with `offset_ms`, `{id: "turn-<seq>", startMs: offset, endMs: offset + (endedAt − startedAt), text}` (segments with zero length dropped).
3. **Voice** (Node, `voice-metrics.js`): decode audio with ffmpeg to mono 16 kHz samples; for each segment compute the spoken span and pauses (see M9), `wpm = words ÷ speaking seconds × 60`, filler count from the **transcript text** (whole-word regexes for um/uh/ah/hmm/like/you know/well/so/actually/er/erm). Overall: `pauseRatio`, `pauseCount`, `longPauses` (≥ 2 s), `longestPauseSec`, `fillerPerMin`, `fillerTop`. If decoding fails → ask the AI engine `/analyze/voice`; if there is no audio at all → `analyseTranscriptOnly` (fillers per 100 words × an assumed 130 wpm, flagged `estimated: true`; pace and pauses stay `null`).
4. **Behaviour** (`behavior.js`) from the uploaded camera batches (H22); if none → `errors.behavior = "no camera tracking data"` (or the reason tracking could not start). When there is **no camera track but a video exists**, the AI engine's `/analyze/gaze` provides eye contact (`gaze.source = "video"`).
5. **Emotion**: `/analyze/emotion` (Wav2Vec2) per segment — optional; failure recorded.
6. **Face** (`/analyze/face`) only if `FACE_ANALYSIS_ENABLED=true` (TensorFlow weights).
7. **Integrity** summary from `integrity_events`.
8. Store `analysis` (version 2) with `errors{}` listing every measurement that failed and why; `analysis_status = complete`; return so the handler queues `finalize-candidate`. On the third failed attempt `markAnalysisFailed` sets `analysis_status = failed`.

**Communication score** (`communicationScore(analysis)` in `final-evaluator.js`): pace, fluency, eye contact, composure, weights **0.30 / 0.30 / 0.25 / 0.15**, renormalised over what exists; `sources` records where composure and eye contact came from (voice model vs face expressions; camera vs video) and whether fluency was estimated, and the recruiter sees these labels. Formulas: Part 2B M9.

**Edge cases.** No video → eye contact dropped, others renormalised. No AI engine → no tone of voice; everything else still computed (acceptance criterion). Reload mid-interview → several recorder streams handled in assembly; segment offsets exclude disconnected time. Pace of a very short answer is noisy (flagged by few words). Quiet recording (RMS below the absolute floor) → no speech detected, `wpm = null`.

**Security.** Recording content is read only by the worker and (fallback) the AI engine (bearer token, storage keys not paths).

**Design decision.** Do pace/fluency in Node so the score doesn't depend on Python (lesson from the failed-recording incident); keep the Python service for what truly needs models (TTS, speech emotion). *Limits:* heuristics are simple (energy VAD, not a trained model); accuracy is not validated against human raters [GAP].

**30 seconds.** "After the interview the worker joins the recording, finds the candidate's answers on the timeline, measures speaking pace, pauses and filler words from the audio and transcript, summarises the camera numbers, and combines pace, fluency, eye contact and composure into a communication score. Each measure is independent; if one fails the others still count."

---

## H25 · Final evaluation and the second shortlist  *(special depth)*

**Purpose.** Compute one comparable score, a suggested decision, and an evidence-only summary for the recruiter.

**Trigger.** Worker job `finalize-candidate {candidateId, interviewId}` (after analysis); re-run by *Re-analyse*.

**Flow (`libs/hiring/finalize.js` `finalizeCandidate`).**
1. Load candidate, interview (must be `completed` and belong to the candidate), job, `getHiringConfig`.
2. `interviewScore = interview.interviewScore ?? computeInterviewScore(responses, questionSnapshot)`; `communication = communicationScore(interview.analysis)`.
3. `finalScore({fitScore, interviewScore, communicationScore}, config.finalWeights)` — **weighted average of the parts that exist**, weights renormalised.
4. `answered` = number of base questions with a non-empty answer; `suggestDecision({score, threshold: finalThreshold, totalAnswers, totalQuestions})`:
   * `needs_review` if fewer than **50%** of questions were answered, or no score;
   * `final_shortlisted` if `score ≥ finalThreshold` (default 70);
   * else `final_rejected`.
5. Evidence for the LLM: the strongest 3 and weakest 3 scored answers (answers truncated to 400 chars). `chatJSON(FINAL_SYSTEM, buildFinalUser)` (temperature 0.2, 900 tokens) → `normaliseSummary` (recommendation from `strong_yes|yes|maybe|no`, else derived from the score: `strong_yes ≥ max(threshold+15, 85)`, `yes ≥ threshold`, `maybe ≥ threshold−15`, else `no`; lists capped at 5 items of ≤ 300 chars; summary ≤ 1,500 chars) → `scrubAll` removes the candidate's name (form name and parsed name). **On any LLM error:** `fallbackSummary` is built from computed facts only and flagged `fallback: true`.
6. Persist: `interviews.communication_score`, `candidates.final_score`, `candidates.final_analysis` (shape in Part 3 §3.3). A previous `decision` and `outcomeEmail` are preserved on re-analysis.
7. **Apply only if** `autoFinalize` **and** the suggestion is not `needs_review` **and** the candidate is still `interview_completed` **and** no supervised agent manages the job → `applyDecision({decision: suggestion, decidedBy: "system"})`.
8. Notify the recruiter ("Interview evaluated: … Suggested: …/ Automatically moved to …").

**Worked example** (weights .3/.5/.2, threshold 70): fit 82, interview 74, communication 66 → `0.3×82 + 0.5×74 + 0.2×66 = 24.6 + 37 + 13.2 = 74.8` → **75 → final_shortlisted**. Without video, communication is still from voice (suppose 66); if *communication were missing entirely*: `(0.3×82 + 0.5×74)/(0.8) = (24.6+37)/0.8 = 77` — the missing part does not drag the score down.

**Borderline handling.** The agent treats scores within **5 points** of the threshold as escalations (always asked, never bulk-approved); the recruiter UI shows the breakdown so the decision is theirs.

**Inputs → outputs → side effects.** In: DB rows. Out: scores and JSON. Side effects: one LLM call, DB updates, one notification, optionally a status change.

**Edge cases.** Interview `abandoned` (not completed) → skipped; analysis missing → communication `null`, still computes; no scored answers → interview score `null` and (with < 50% answered) `needs_review`; candidate decision already made → `decision` kept; LLM down → deterministic summary; rejection without recruiter approval → impossible unless `autoFinalize` (CLAUDE.md rule 6).

**Security & fairness.** The summary prompt: use only provided evidence, refer to "the candidate", never mention or infer protected attributes (list includes accent and disability), treat communication metrics as secondary, never penalise non-native speakers. Scores are never emailed to candidates. No fairness audit [GAP].

**Design decision.** *Deterministic formula + LLM narrative* rather than "ask the LLM for a hire/no-hire verdict": the numbers are reproducible and auditable; the LLM only summarises. *Rejected:* single LLM verdict (opaque), ML model trained on outcomes (no data). *Limits:* weights and the 70 threshold are defaults, not validated; resume fit is from the same candidate pool the interview questions are tailored to, so the components are correlated.

**30 seconds.** "Final score is resume fit, interview score and communication score combined with the job's weights — dropping any missing part and rescaling. Above the threshold we suggest shortlisting; if the candidate answered under half the questions we refuse to suggest anything. The LLM only writes the explanation from the evidence; a human approves unless the job opted into auto-finalize."

---

## H26 · Decisions: apply, bulk approve, outcome emails

**Purpose.** The only code path that sets final statuses, with audit and conflict protection.

**Trigger.** `POST /api/hiring/candidates/[id]/decision {decision, note}`; `PATCH …/candidates/[id] {status}` (decision statuses); `POST /api/hiring/jobs/[jobId]/decisions/bulk-approve`; `autoFinalize`; the agent's approved `final_decision`.

**Flow (`libs/hiring/decisions.js`).**
* `applyDecision({candidateId, decision, decidedBy, note})`: `decision ∈ {final_shortlisted, final_rejected, hired, rejected}` (400 otherwise); `canTransition(current, decision)` (409 `invalid_transition`); update `status`, `final_decided_at`, `decided_by` and `final_analysis.decision = {decision, by, at, note≤1000}` **with `WHERE status = <the status just validated>`** → 0 rows → 409 "changed in the meantime"; if `sendOutcomeEmails` and the status has an outcome mapping (`final_shortlisted`, `final_rejected`, `rejected`) enqueue `send-outcome-email`.
* `bulkApprove(jobId, decidedBy)`: for each `interview_completed` candidate whose suggestion is `final_shortlisted|final_rejected`, skip if `finalEscalations` is non-empty (needs-review, no score, borderline), else `applyDecision`; returns `{applied, needsReview, escalated, failed}`. (The agent additionally passes interview integrity flags to `finalEscalations`; the bulk endpoint does not.)
* `sendOutcomeEmail`: idempotent (recorded in `final_analysis.outcomeEmail`), only if enabled; **never contains scores**; positive text: "you've moved to the next round"; negative text is polite and non-specific.

**Edge cases.** Two recruiters deciding at once → one wins, the other gets 409; deciding on a candidate whose status moved (e.g. rejected manually) → 409; `hired` is terminal; `rejected → shortlisted` allowed to reopen.

**Accountability trail.** Who/when/why for every final decision is on the candidate record; the recruiter's override of an AI suggestion is distinguishable because `decided_by` is a user id (vs `system`).

**30 seconds.** "Every final decision goes through one function that checks the move is legal, records who made it and why, and refuses if someone else changed the candidate first. Bulk approve skips anything borderline or unclear."

---

## H27 · Recruiter interview views

**Purpose.** Show the recruiter everything needed to trust or override the AI.

**Pages and APIs.** List `/dashboard/recruiter/interviews` (`GET /api/hiring/interviews?jobId&status&from&to&page&pageSize`; 25 per page, max 100; `to` as a date includes that day; refreshes every 15 s while any row is in progress). Detail `/dashboard/recruiter/interviews/[id]` (`GET …/[id]`) with tabs:

| Tab | Shows | Source |
|---|---|---|
| **Live** (only while `in_progress`) | current question, rolling transcript, answer scores as they arrive | SSE `…/stream` ← Redis `interview:{id}` |
| **Summary** | score ring, breakdown with weights, recommendation, AI summary, strengths, risks, next steps, **Approve / Override / Mark hired** | `candidates.final_analysis` |
| **Q&A** | per base question: the question, the answer, score bar, reasoning, keywords covered (green) and missed (red), nested follow-ups | `interview_responses` |
| **Transcript** | chat-style turns; clicking a time seeks the player | `interview_turns.offset_ms` |
| **Recording** | HTML5 audio/video with question markers; downloads; part counts when joining failed | signed links (15 min), Range support |
| **Communication** | wpm, fillers/min, pause ratio, eye contact, emotion; labels that say if estimated | `analysis.voice/gaze/emotion` |
| **Integrity** | tab-hidden events with "not proof of misconduct" | `analysis.integrity` |
| **Behaviour** | eye contact, head movement, expressions, per-answer view, timeline | `analysis.behavior` |

Header actions: **Re-analyse**, **Extend link**, **Re-invite**, **Delete recording**.

**Rules.** Ownership through the job (`loadOwned` joins `jobs`); `getInterviewDetail` omits `token_hash` and `state`; the page polls every 10 s while the interview runs or analysis is pending and **keeps existing recording links** so a playing video isn't restarted; *Delete recording* refused while `invited|opened|in_progress` (409) or while analysis is `processing`, removes every key under `recordings/{id}/`, sets `recording_status = deleted`, keeps scores/transcript, and makes re-analysis refuse.

**Edge cases.** Recording join failed → the tab shows the reason (`recording_failed:`) and how many parts arrived; storage not configured → recording shown as unavailable (signing errors swallowed); Redis down → "Live updates are unavailable".

**Security.** All routes `withAuth`; the SSE route re-checks ownership before subscribing; links expire; `X-Accel-Buffering: no` so proxies don't buffer the stream.

**Design decision.** The recruiter sees *evidence* (transcript, per-answer reasoning, recording) not just a number — the answer to "can a recruiter see why?". *Limit:* no UI to correct a score or annotate an answer [GAP].

**30 seconds.** "The recruiter can watch an interview live, then see the summary, every question with the answer, score and reasoning, the full transcript linked to the recording, and the delivery metrics, and can approve, override, re-run or delete the recording."

---

## H28 · Supervised recruiter agent  *(special depth)*

**Purpose.** Run the hiring pipeline for one job on the recruiter's behalf *within approval rules*.

**Trigger.** *Recruiter › Hiring agent* → start (`POST /api/agents/runs`, pipeline `recruiter`) → `startRecruiterRun`; events wake it; a 15-minute sweep ticks all active runs.

**Launch (`libs/agent/launch.js`).** Config whitelist `jobId, accountId, rozeeAccountId, indeedAccountId, postTone, dailyInviteCap (1–200), rozeeApplicantLimit, appBaseUrl`; job must be the user's (admin: any); **one active agent per job** (409); inserts `agent_runs` (`queued`, `mode` normalised, config snapshot) and queues the first tick.

**Run steps** (13 rows in `agent_steps`): load_job, generate_post, approve_post*, post_to_linkedin, publish_to_rozee, publish_to_indeed, scrape_rozee_applicants, screen_candidates, review_shortlist, prepare_questions, send_interview_invites, await_interviews, final_decisions (*blocking approval in Assisted mode).

**Tick logic (`advanceRun`).** (1) Skip finished/paused runs; (2) ensure the 13 step rows; (3) load the job (closed → run `completed`); (4) **setup** (once): write posts for each configured platform with the LLM; `publish_post` proposed (blocking, route per mode) → if pending, status `paused_at_checkpoint` and a notification; on approval publish (job goes live on Raasta-AI first; LinkedIn via `publishToPlatform` with `initiatedBy: agent`; Rozee.pk/Indeed steps are *skipped with the reason* because they are not posted in the background; Rozee applicants may be imported); (5) **operate** every tick: carry out approved actions, retire requests whose candidate moved on (`STALE_WHEN`), `loadJobState`, `buildPlan` (pure) → queue screening for `new` candidates, propose shortlist/hold-back **only once the batch is screened** so the cap compares everybody, ensure the question bank, propose invites (auto up to the daily cap in Autopilot, asked in Assisted), propose final decisions (always asked); (6) update step statuses and `agent_runs.results`; (7) status `waiting` and notify if new approvals arrived.

**Policy and escalations.** See the table in M11. `decide(action, mode, {escalations})` returns `auto|ask|human`; any escalation turns `auto` into `ask`; `hire` is `human` in both modes; `proposeAction` refuses `human` routes outright. In Assisted mode, **approving a shortlist also approves the invite** (the agent proposes an invite action as `auto` and executes it).

**Approvals (`decideAction`).** Only from `pending` (so two recruiters can't both decide); the recruiter may override the proposal with a `choice` (`shortlisted`/`not_shortlisted` for shortlist/hold-back; `final_shortlisted`/`final_rejected` for decisions); `needs_review` decisions **require** a choice; bulk approval refuses escalated items; notes (≤ 1000 chars) are stored. `executeAction` re-validates the move with `canTransition` and a compare-and-set on status; if the candidate moved meanwhile, the action is `superseded` ("the candidate moved on").

**Preview (`GET /api/agents/preview`).** `previewAgent` runs `buildPlan` without writing anything and returns counts by route, so the recruiter sees what Assisted vs Autopilot would do.

**Idempotency and safety.** `dedupe_key` per subject (`shortlist:<id>`, `send_invites:<id>`, `final_decision:<id>`, `publish_post:<run>`, `prepare_questions:<job>`); `lock:agent:{runId}` single tick; `agent:tick:{runId}` coalesces wake-ups (default 2 s; screening wake-ups wait 8 s so applicants screened together share a tick); a failed tick marks the run `failed`, supersedes open actions, notifies; **stopping** a run supersedes all open requests.

**Edge cases.** Worker down → agent idle, UI says so; recruiter acts manually while a request is pending → request retired; re-analysis creates a new final suggestion → the old pending request is superseded and re-proposed; daily invite cap reached → remaining invites deferred to the next day (the sweep starts each day's allowance).

**Security.** Owner-only runs/actions (admin override); the agent cannot send a rejection or hire; every action stores `evidence` (scores, matched/missing skills, strengths/concerns, rationale) so approvals are informed ("evidence before score").

**Design decision.** *Workflow + policy*, not a free-roaming LLM agent (recorded). *Rejected:* an LLM that decides actions (unauditable); no automation (tedious). *Limit:* Autopilot is still bounded by "ask" for every adverse action, so it never fully automates rejection.

**30 seconds.** "The agent is a rule-based workflow that wakes on events. A table says for each action — publish, shortlist, invite, reject, hire — whether it may act, must ask, or must leave it to a human. Anything adverse or borderline is always asked; every action is recorded with evidence, so the inbox doubles as the audit trail."

---

## H29 · Hiring analytics and Home overview

* **Analytics** (`GET /api/hiring/analytics` → `buildHiringAnalytics`): totals (jobs, published, applied, screened, shortlisted, interviewed, final, hired, average fit score, shortlist/interview/hire rates), stage counts from `KANBAN_STAGES`, sources (`source` counts), a 14-day application timeline (UTC, zero-filled) and per-job funnels. Pure function, 2 tests.
* **Home overview** (`GET /api/dashboard/overview` → `libs/dashboard/overview.js`): for recruiter mode, counts that need attention (unscreened, waiting for shortlist, interviewing, awaiting decision, expired invites, hired, pending agent approvals) and funnel; recent jobs (5) and campaigns (4) with `campaignStatus()` derived the same way as the campaigns API; admins see everything.
* **Limits.** Data volumes small; no export; `source` is `linkedin` for public applications (the apply route doesn't set it) so the *Sources* chart is misleading for direct applicants [PARTIAL].

**30 seconds.** "Two pure aggregation functions turn candidate and job rows into the funnel and the Home numbers."

---

## H30 · Notifications

`notify({userId,type,title,body,link})` (never throws; title ≤ 200, body ≤ 500 chars). Types: `new_application`, `screening_complete`, `interview_completed`, `agent_run_finished`, `agent_run_failed`, `agent_needs_approval`. Emitted by the apply route, the shortlist hook (one per run), `finalizeCandidate`, the agent (needs approval / finished / failed) and `AgentRunner`. `GET /api/notifications?limit&offset&unread=1` returns a page (+1 row to compute `hasMore`) and the global unread count; `PATCH` marks `{ids}` or all as read. The bell polls every 30 s and updates optimistically.

---

## P15 · Python AI engine endpoints (`services/ai-engine`)

| Endpoint | Input (validated by pydantic) | Does | Notes |
|---|---|---|---|
| `GET /health` | – | `{ok, models{tts,emotion,whisper,gaze,face}}` states `loaded|lazy|disabled` | no auth |
| `GET /auth/check` | – | confirms the bearer token | |
| `POST /tts` | `text` 1–600 chars, `voice?` | Kokoro-82M → 24 kHz mono 16-bit WAV, header `X-Audio-Duration-Ms` | 400 for unknown voice; 503 if the model can't load |
| `POST /media/concat` | `prefix` (ends with `/`), `outKey` | joins parts (ffmpeg) into `outKey`; returns `{outKey, durationMs, parts}` | handles several recorder streams; 404 if no parts |
| `POST /analyze/voice` | `audioKey`, `segments[{id,startMs,endMs>startMs,text≤20000}]?`, `transcript≤200000?` | pauses (energy), long pauses, filler words (whole words), speaking rate from text, pitch jitter/shimmer if librosa works | transcribes with Whisper-base only if no text supplied and the model is available |
| `POST /analyze/emotion` | `audioKey`, `segments?` | Wav2Vec2 (`r-f/wav2vec-english-speech-emotion-recognition`): 12 s windows, ≥ 0.4 s, averaged, duration-weighted per segment and overall; labels angry, disgust, fear, happy, neutral, sad, surprise | |
| `POST /analyze/gaze` | `videoKey`, `sampleFps` (0–30], `maxFrames` | MediaPipe Face Landmarker per sampled frame → centre/left/right/up/down/no_face; `eyeContactScore` = centre share ×100 | fallback when there is no camera track |
| `POST /analyze/face` | `videoKey` | facial emotion (TensorFlow) | **501 unless `FACE_ANALYSIS_ENABLED`** |

Auth: every route except `/health` needs `Authorization: Bearer ${AI_ENGINE_TOKEN}`; **fail-closed** (503 when the token is unset), constant-time compare. Handlers are plain `def` so FastAPI runs them in a thread pool (a long analysis doesn't block `/tts`). Model weights download lazily into `MODEL_CACHE_DIR` (keep the path short on Windows). Tests: 8 pytest files.
