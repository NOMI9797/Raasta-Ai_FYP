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
| `client_event` | `{ event: 'tab_hidden'|'tab_visible'|'mic_muted'|'net_offline', at }` | Integrity / diagnostics |
| `ping` | `{ t }` | Keep-alive every 15s |

**Engine → client**

| type | payload |
|---|---|
| `session_ready` | `{ interviewId, resume, totalQuestions, maxMinutes, interviewerName, jobTitle }` |
| `ai_speaking` | `{ turnId, kind: 'greeting'|'question'|'follow_up'|'closing'|'system', text, audio: base64|null, mime: 'audio/wav' }` (if `audio` is null, the client uses `speechSynthesis`) |
| `question` | `{ index, total, text, kind }` (progress UI; follow-ups keep the same index) |
| `listening` | `{ silenceMs }` (show "Listening…") |
| `caption_partial` | `{ text }` |
| `caption_final` | `{ text }` |
| `processing` | – ("Thinking…" between answer and next question) |
| `time_warning` | `{ minutesLeft }` (sent at 5 and 1 minutes left) |
| `interview_complete` | `{ reason: 'finished'|'time_up'|'ended_by_system' }` |
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
  async end(reason)                // 'finished' | 'time_up' | 'abandoned' | 'error'
  serializeState()
}
```

**Time budget:** `maxMs = interviewMaxMinutes × 60000`.
- Before asking any follow-up, require ≥ 3 minutes left.
- Before asking a new base question, require ≥ 1.5 minutes left; otherwise close.
- Send `time_warning` at 5 and 1 minutes left.
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
