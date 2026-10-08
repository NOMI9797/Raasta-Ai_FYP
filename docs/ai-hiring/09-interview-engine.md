# 09 · Interview Engine (`services/interview-engine`)

A long-running Node process that conducts live interviews over WebSocket. It reuses `libs/interview/*` for logic and `libs/db.ts` / `libs/schema` for persistence.

## Runtime
- Node 20, ESM, started with `tsx services/interview-engine/index.js` (so it can import `libs/db.ts`).
- Dependencies (add to root `package.json`): `ws`, `@deepgram/sdk` (check the current major version's live-transcription API before coding), `jose` (JWT).
- `npm run engine:dev` → `tsx watch services/interview-engine/index.js`.
- Listens on `INTERVIEW_ENGINE_PORT` (8090):
  - `GET /health` → `{ ok, activeSessions }`
  - `WS /ws?ticket=<jwt>`
- **Single instance** (sessions are in memory). Document this; horizontal scaling is out of scope.

## Connection lifecycle

```
client                                   engine
  │ WS /ws?ticket=…  ───────────────────► verifyTicket → load interview (status opened|in_progress, not expired)
  │                                      → reject if another socket already active for this interview (close 4009)
  │                                      → load job, candidate, question snapshot (create snapshot if first start)
  │                                      → restore state from interviews.state if resuming
  │ ◄──────────────────── session_ready {interviewId, resume:boolean, totalQuestions, maxMinutes, interviewerName}
  │ ready {devices, ua} ───────────────► status in_progress (first time: started_at, candidate → interview_in_progress)
  │                                      → open STT stream → speak greeting (or "Welcome back…" + re-ask current question)
  │ ◄──────────────────── ai_speaking {turnId, kind, text, audio, mime}
  │ ai_done_speaking {turnId} ─────────► start listening
  │ binary PCM16 frames ───────────────► STT → caption_partial / caption_final → loop (04-source-port-map.md rules)
  │ answer_done ───────────────────────► finalize immediately
  │ ◄──────────────────── question {index, total, text, kind:'question'|'follow_up'}
  │ ...
  │ ◄──────────────────── interview_complete {reason}
  │ socket close ◄───────────────────────
```

## WebSocket protocol

Text frames are JSON `{ type, ...payload }`. Binary frames are **only** candidate microphone audio: PCM signed 16-bit little-endian, mono, 16 kHz, 20–100 ms per frame.

**Client → engine**

| type | payload | meaning |
|---|---|---|
| `ready` | `{ ua, devices: {mic, cam} }` | Room is ready; start or resume |
| `begin` | – | Candidate clicked "Start" after the greeting (alternative to saying "ready") |
| `ai_done_speaking` | `{ turnId }` | Browser finished playing AI audio |
| `answer_done` | – | Candidate pressed "I've finished my answer" |
| `repeat_question` | – | Re-speak the current question (max 2 per question) |
| `end_interview` | – | Candidate pressed "End interview" (after confirming): save what was said, say goodbye, end |
| `client_event` | `{ event: 'tab_hidden'|'tab_visible'|'mic_muted'|'net_offline', at }` | Integrity / diagnostics |
| `ping` | `{ t }` | Keep-alive every 15s |

**Engine → client**

| type | payload |
|---|---|
| `session_ready` | `{ interviewId, resume, totalQuestions, maxMinutes, interviewerName, jobTitle, remainingSec }` (`remainingSec` drives the room's countdown; time spent disconnected isn't counted) |
| `ai_speaking` | `{ turnId, kind: 'greeting'|'question'|'follow_up'|'closing'|'system', text, audio: base64|null, mime: 'audio/wav' }` (if `audio` is null, the client uses `speechSynthesis`) |
| `question` | `{ index, total, text, kind }` (progress UI; follow-ups keep the same index) |
| `listening` | `{ silenceMs }` (show "Listening…") |
| `caption_partial` | `{ text }` |
| `caption_final` | `{ text }` |
| `processing` | – ("Thinking…" between answer and next question) |
| `time_warning` | `{ minutesLeft }` (a quarter of the interview length, at most 5, and 1 minute left; see Time budget) |
| `interview_complete` | `{ reason: 'finished'|'time_up'|'ended_by_candidate'|'ended_by_system' }` |
| `error` | `{ code, message, retryable }`, codes: `stt_unavailable`, `tts_failed`, `invalid_state`, `expired`, `duplicate_session`, `internal` |
| `pong` | `{ t }` |

**Never send to the candidate:** scores, analysis, follow-up reasons, ideal answers.

Close codes: `4001` bad/expired ticket, `4004` interview not found, `4009` duplicate session, `4010` interview already completed, `4011` expired.

## Session manager (`session-manager.js`)

```js
class SessionManager {
  sessions = new Map();            // interviewId -> InterviewSession
  attach(ws, ticketPayload)        // create or resume a session
  detach(interviewId, reason)      // socket closed: keep the session for resumeWindowMinutes, then abandon
  snapshotAll()                    // every 15s: repository.saveState(id, session.serializeState())
  shutdown()                       // SIGTERM: snapshot all, close sockets with 1012
}
```
- **Disconnect:** pause timers, keep the STT stream closed, and mark `lastActivityAt`. If no reconnect within `resumeWindowMinutes`: interview `abandoned`, candidate stays `interview_invited` while `expires_at` is in the future (they may retry once if `allowRetake`; otherwise mark `interview_completed` with partial data). **Default:** partial interviews with ≥ 50% of questions answered are treated as `completed`; otherwise `abandoned`, and the recruiter decides (extend or re-invite).
- **Reconnect:** a new ticket comes from `POST /api/interview/[token]/session`. Restore the state, say "Welcome back, let's continue", and re-ask the current question (discard the partial buffer).

## InterviewSession (`libs/interview/session-engine.js`)

Port of the loop described in [04-source-port-map.md](04-source-port-map.md). Public surface:

```js
export class InterviewSession {
  constructor({ interview, job, candidate, questions, config, deps })
  // deps = { llm, tts, repo, publish, send, now }   ← injectable for tests
  async start({ resume })
  onSttPartial(text)
  onSttFinal(text, { startMs, endMs })
  onAiDoneSpeaking(turnId)
  onAnswerDone()
  onRepeatQuestion()
  onClientEvent(evt)
  async onNonEnglishSpeech({ language })   // the candidate spoke Urdu: say the interview is English only
  async end(reason)                // 'finished' | 'time_up' | 'abandoned' | 'error'
  serializeState()
}
```

**Time budget.** The interview length is not fixed: the recruiter sets it per job (`hiring_config.interviewMaxMinutes`, 5–120 minutes, default 25; presets and a live preview in the job's "Hiring automation" card), and the interview is planned around it (`libs/interview/time-plan.js`, pure functions the settings screen shares, so what it promises is what the interviewer does). `maxMs = interviewMaxMinutes × 60000`.
- **How many questions.** `questionCount` is the *pool* (the bank). The interviewer asks as many as fit: `floor((length − 1 min) / 2.5 min)`, at least 1, at most the pool. 10 minutes asks 3 of 8, 25 minutes asks all 8, 60 minutes asks all 8 and spends the rest on follow-ups (the settings card says when to raise the pool). When the pool is trimmed, every topic (technical, role, behavioural) keeps a question and heavier-weighted questions win; the picks keep the bank's order. The plan is fixed when the session is created and saved in `state` (`questionQueue`, `totalQuestions`), so a resumed interview follows the same plan. `interviews.total_questions` and the final evaluation use the planned count ("answered 3 of 3"), not the size of the bank.
- **Follow-ups.** A follow-up is asked only while every question still to come keeps 1.5 minutes, plus 20 s to say goodbye, plus the follow-up's own 75 s (`followUpAffordable`). So short interviews get few follow-ups, long ones get up to `maxFollowUps`, and a follow-up never crowds out a planned question. (It replaces the old fixed "≥ 3 minutes left".)
- Before asking a new base question, require ≥ 1.5 minutes left; otherwise close.
- **Warnings.** `time_warning` at a quarter of the length (at most 5 minutes) and at 1 minute: 25 min → 5 and 1; 10 min → 2 and 1; 5 min → 1. "5 minutes left" in a 5-minute interview meant nothing.
- The greeting says what to expect ("I'll ask you 3 questions in up to 10 minutes, and the interview is conducted in English"); the invite email, the candidate's welcome screen and the room's countdown say "up to N minutes".
- At 0, let the candidate finish the current answer (max 60s grace), then close.

**Persistence calls (repository):**
- `appendTurn(interviewId, { seq, speaker, kind, questionId, text, startedAt, endedAt, offsetMs })` for every AI utterance and every finalised answer. `seq` is monotonic per interview and kept in the state.
- `createResponse(...)` when an answer is finalised; `updateResponseScore(responseId, score…)` when scoring returns.
- `saveState(interviewId, state)` every 15s and on every question change.
- `complete(interviewId, stats)`: status, `ended_at`, `duration_sec`, `total_questions`, `total_answers`, `follow_up_count`, `interview_score` (weighted by base question `scoreWeight`; follow-up responses count toward their base question's average). Candidate → `interview_completed`; `enqueue('analyse-interview', { interviewId })`.

**Recruiter live channel:** `publish('interview:{id}', event)` for `question`, `caption_final`, `answer_finalized`, `answer_scored {responseId, score, reasoning}`, `status`. The web app relays these as SSE ([12-recruiter-ui.md](12-recruiter-ui.md)).

## STT adapters (`libs/interview/stt/`)

Common interface:
```js
createStt({ onPartial, onFinal, onActivity, onError, onClose }) → { write(pcmBuffer), keepAlive(), flush(), close() }
```
- `onActivity()` fires while the candidate is audibly talking (Deepgram `SpeechStarted` and interim results; Whisper: every 250 ms of loud audio). The session counts the silence window from the last activity **or** final. Whisper finals only arrive once an utterance ends, so a long answer would otherwise be finalised while the candidate is still speaking.
- `flush()` runs on `answer_done` before the answer is finalised (capped at 2.5 s): Deepgram gets a `Finalize` message; Whisper transcribes what it has buffered.
- `onClose({ unexpected: true })` lets the session manager reconnect once.
**Deepgram (`deepgram.js`, default when `DEEPGRAM_API_KEY` is set).** Live streaming with:
- `model=nova-3, language=en, encoding=linear16, sample_rate=16000, channels=1`
- `interim_results=true, smart_format=true, punctuate=true`
- `endpointing=300, utterance_end_ms=1000, vad_events=true`

Behaviour:
- `is_final` results → `onFinal`; others → `onPartial`.
- Send a KeepAlive while the AI is speaking or the mic is silent, so the stream isn't closed for inactivity.
- Reconnect once on unexpected close.

**Whisper fallback (`whisper-chunked.js`):** buffer PCM, cut on 700 ms of low RMS energy or at 15s max, wrap as WAV, POST to Groq `audio.transcriptions` (`whisper-large-v3-turbo`), and emit `onFinal`. No partials. Slower, but needs no extra key.

Candidate audio received while `isAiSpeaking` is still sent to STT, but its finals go to a side buffer and are merged only if the candidate keeps talking after `ai_done_speaking` (barge-in rule 10).

## TTS (`libs/interview/tts-client.js`)
```js
synthesize(text, { voice = process.env.TTS_VOICE || 'am_michael' }) → { audio: Buffer, mime: 'audio/wav', durationMs }
```
- `POST {AI_ENGINE_URL}/tts` with `{ text, voice }` and header `Authorization: Bearer AI_ENGINE_TOKEN`. The response body is WAV bytes, with header `X-Audio-Duration-Ms`.
- Timeout 20s. On failure, send `ai_speaking` with `audio:null` (the browser speaks it).
- **Latency tweak (optional):** split the text into sentences, synthesise the first sentence, send it, and stream the rest as further `ai_speaking` chunks with the same `turnId` and `part` index.
- Cache the greeting and closing per job and voice in memory.

## LLM usage per answer (target)
1. Analyzer (1 JSON call: new topic, contradiction, deep experience) + heuristics
2. Follow-up generation (only if needed)
3. Scoring (async, doesn't block the next question)

Target latency from answer end to next question audio: **≤ 4s** with Groq.

## Implementation notes (Phase 5)
- Files: `services/interview-engine/{index,session-manager,deps}.js`, `libs/interview/session-engine.js`; all dependencies are injected (`deps.js` wires the real ones), so the loop and the manager are unit-tested with fake timers.
- Nothing is persisted for a plan the pre-speak guard aborts: the answer goes back to the front of the buffer and is saved once, together with the extra speech, when the candidate stops. The next base question is only peeked at until it is spoken.
- Everything the candidate says between the end of an answer and the next question being sent is treated as barge-in (rule 10), not as part of the next answer.
- The interview clock excludes time spent disconnected. After an engine restart, the clock is treated as frozen at `last_activity_at`.
- A socket closed by the client is kept for `resumeWindowMinutes`. After that, `end('abandoned')` marks the interview `completed` if ≥ 50% of the base questions were answered, and otherwise `abandoned` (candidate back to `interview_invited`, or `interview_expired` once the link has expired).
- In-progress interviews that never reconnect after an engine restart have no resume timer; the worker sweep's `abandonStaleSessions()` ([13-workers-automation.md](13-workers-automation.md)) closes them.

## Conversation hygiene (what the transcript showed)
A real interview transcript showed these problems; each has a fix and a test (`tests/hiring/interview-conversation.test.js`, `session-engine.test.js`).
- **The question inside the answer.** Speakers feed the interviewer's voice back into the microphone. The room closes the microphone while the interviewer speaks (10), and `libs/interview/echo-guard.js` cuts the interviewer's recent sentences off the start of anything heard (loose matching: "Node.js/React" may come back as "node dot js slash react"). A "ready to begin?" heard in the interviewer's own voice no longer starts the interview.
- **Words nobody said.** Speech models invent text on silence and noise ("Thank you.", "Bye.", sentences in another language). `libs/interview/stt/clean.js` removes foreign-script words and phantom sentences and collapses decoding loops, for both Deepgram and Whisper. Whisper is also locked to the interview language (`STT_LANGUAGE`, default `en`), asked for `verbose_json` so segments it doubts (`no_speech_prob`, `avg_logprob`, `compression_ratio`) are dropped, and never sent chunks with less than 300 ms of speech.
- **"End the interview" was ignored.** `libs/interview/intent.js` recognises an explicit request in a short answer ("kindly end my interview", "please end it", "I don't want to continue with this interview"); a long technical answer that mentions "end the session" is not one. The request is kept in the transcript, is not counted as an answer, and the interviewer closes with `endedByCandidateText`. The same happens from the button. An interview ended before any answer is `abandoned`; otherwise it is `completed` with what exists (the final evaluation marks it `needs_review` when under half was answered).
- **Follow-ups for refusals.** A short refusal or "I don't know" (`isDecline`) gets no follow-up, no scorer call (it scores 0, "The candidate declined to answer."), and the interview moves on.
- **Cut-off and generic follow-ups.** `openai/gpt-oss-*` models spend `max_tokens` on reasoning before answering: with 150 tokens the reply was empty or cut mid-sentence, and the generic fallback question was used instead. `libs/ai/llm.js` now retries once with a 3× budget when the reply stops at the limit, accepts `reasoningEffort` (sent to GPT-OSS models only; the interview paths ask for `low`, `LLM_REASONING_EFFORT` sets a default), the follow-up and scorer budgets are larger, a follow-up that doesn't end in punctuation is treated as cut off, and the fallback questions read sensibly on their own.
- **Turn offsets** (`interview_turns.offset_ms`) leave out time spent disconnected, so they follow the recording after a reload.
- Deepgram runs with `filler_words=true`, so "um" and "uh" reach the fluency measure.

## English only (Urdu)
The interview is conducted in English. `libs/interview/language.js` notices when a candidate speaks Urdu, and the interviewer says so instead of scoring a garbled transcript. Speech recognition is held to English (`language: "en"` for Deepgram), so Urdu arrives as low-confidence nonsense or as romanised Urdu words, and two checks run on every final transcript before it reaches the interview (`SessionManager.deliverFinal`):
1. **Text rules (free).** Urdu or Hindi script, or romanised Urdu words that are not English words ("hai", "nahi", "theek", "aur", …; 3+ hits, or 2 in a very short sentence). Sure enough to act on.
2. **Audio identification (only for doubtful ones).** A transcript whose recogniser confidence is below 0.8 (Deepgram's `confidence`; `LANGUAGE_CHECK_CONFIDENCE`), or that holds a stray Urdu word, has its audio cut out of a 30-second tail of the stream (`AudioTail`) and sent to Groq Whisper with **no language forced** (`detectSpokenLanguage` in `libs/ai/llm.js`, `verbose_json`). Urdu, Hindi, Punjabi, Sindhi, Pashto, Persian or Arabic counts. At most one call per 2 s and 30 per interview; a call that takes over 1.5 s or fails lets the words through (the interview is never blocked by it). Confident English is never sent anywhere.

When either says Urdu, the words are dropped (never a caption, an answer or a score) and `onNonEnglishSpeech` runs:
- **Before the first question:** "I noticed you spoke in Urdu. This interview is conducted in English only, so please answer in English. Are you ready to begin?"
- **During a question:** the same notice, then "Let me ask the question again" and the question; the half answer is dropped so they answer afresh.
- **A long English answer** (25+ words) is not cut off by one sentence in another language: the reminder is put in front of the next question instead.
- One notice per spell (20 s cooldown), firmer wording the second and third time, and no more interruptions after five (still recorded). Nothing is said while the interviewer is speaking.
- Each spell is an integrity event `non_english_speech` (recruiter's Integrity tab: "Spoke a language other than English", and "Reminded to use English" in the summary) and a live `language_notice` event.
- `LANGUAGE_GUARD=off` turns it off. Limits: the first check relies on the recogniser's confidence, so a clearly recognised sentence is never audio-checked (it is English or romanised text the rules catch); Urdu with a Pakistani-English accent that Deepgram recognises with high confidence is, correctly, English. With the Whisper fallback (no confidence score) only the text rules and the stray-word check run, so detection there is weaker. Not yet tried with a real Urdu recording: the unit tests use fakes, and the one live check confirmed that Groq returns the `language` field (English audio came back as `english`).

## Security
- The ticket JWT is verified on every connection (`typ`, `exp`, `sub`), and the interview row must match `cid`.
- Max one socket per interview; max 20 concurrent sessions (`INTERVIEW_MAX_SESSIONS`) → `error` + close if exceeded.
- Limit the binary frame size (≤ 64 KB) and the message rate.
- Never log transcripts at info level in production (debug only).

## Acceptance
- A scripted test client ([17-testing.md](17-testing.md)) that streams fixture WAV answers completes an interview with 3 questions: turns, responses and scores are saved, the candidate status is `interview_completed`, and `analyse-interview` is enqueued.
- Pressing `answer_done` moves to the next question in < 5s.
- Killing the socket mid-question and reconnecting within the window resumes at the same question.
- Talking during "processing" doesn't cause two questions to be spoken (lock and pre-speak guard).
