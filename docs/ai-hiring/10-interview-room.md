# 10 · Candidate Interview Room (`/interview/[token]`)

A public page that the candidate reaches from the email link. No login; the token is the credential.

## Middleware and layout
- The `/interview/*` route must not require NextAuth. The repo has no `middleware.js`; auth is enforced in `app/dashboard/layout.js`, so pages outside `app/dashboard/` are public by default. Keep it that way, and don't add a global auth middleware that would catch `/interview/*` or `/api/interview/*`.
- Use a minimal layout without the dashboard sidebar or top bar: `app/interview/layout.js` with a Raasta-AI logo top-left and a "Need help?" support email link (`config.mailgun.supportEmail`).
- Add `<meta name="robots" content="noindex">`.

## Public APIs (token-authenticated, rate-limited)

All under `app/api/interview/[token]/`. Each one hashes the token, loads the interview, and returns 404 for unknown or replaced, 410 for expired or cancelled, and 409 for already completed.

| Method & path | Purpose |
|---|---|
| `GET /api/interview/[token]` | `{ status, candidateFirstName, jobTitle, companyName, maxMinutes, questionCount, expiresAt, recordVideo, canResume }`. Sets `opened_at` (and interview `opened`) on first call |
| `POST /api/interview/[token]/consent` | Body `{ accepted: true }` → `consent_at` |
| `POST /api/interview/[token]/session` | Requires consent. Returns `{ wsUrl: NEXT_PUBLIC_INTERVIEW_WS_URL, ticket }` (JWT, 10 min). Rate limit: 10/hour/token |
| `POST /api/interview/[token]/upload` | `multipart/form-data`: `kind` (`audio`|`video`), `part` (int), `final` (bool), `file` (Blob). Stores `recordings/{interviewId}/{kind}/{part:05}.webm`; the first part sets `recording_status=uploading`; on `final` the route enqueues `assemble-recording`, which concatenates the parts (see 11) and sets `recording_status=complete`. Max 10 MB per part |
| `POST /api/interview/[token]/event` | Fallback for integrity events if the WebSocket is down |

Rate limiting: simple Redis counters `rl:interview:{tokenHash}:{route}`.

## Screens (`app/interview/[token]/page.js` + components in `app/interview/[token]/components/`)

1. **Loading / invalid states:**
   - Expired: "This interview link has expired. Contact the recruiter to request a new one."
   - Unknown, replaced or cancelled: "This link is no longer valid. Please use the link in your most recent email, or contact the recruiter."
   - Completed: "You've already completed this interview. Thank you!"
   - Unsupported browser (no `getUserMedia`, `AudioWorklet` or `MediaRecorder`): "Please use Chrome or Edge on a computer."
2. **Welcome:** "Hi {firstName}, welcome to your interview for **{jobTitle}**."
   - What to expect: about {questionCount} questions, about {maxMinutes} minutes, spoken answers, up to 2 follow-ups per question, can't pause once started, quiet room.
   - **Consent** checkbox (required): "I agree that this interview will be recorded (audio{, video}) and evaluated with the help of AI, and that the results will be shared with the hiring team."
   - Button **Continue**.
3. **Device check:**
   - Request mic (and camera if `recordVideo`) with `{ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: { width: 640, height: 360 } }`.
   - Mic level meter (AnalyserNode); require a peak above the threshold for 1s ("Say 'hello' to test your mic").
   - Camera preview (mirrored).
   - "Play test sound" → a short tone or TTS sample, with the candidate confirming "I can hear it".
   - Network: GET `/api/interview/[token]` latency < 1500 ms, otherwise show a warning (allowed to continue).
   - Button **Start interview**.
4. **Interview:**
   - Top bar: job title, `Question {index} of {total}`, timer (counts down from maxMinutes), recording indicator (red dot).
   - Centre: an interviewer visual (animated waveform/orb that pulses while `ai_speaking`; no human avatar), with the current question text below it.
   - Live caption area for the candidate (partial in grey, final in normal text).
   - State chip: `Interviewer speaking` / `Listening…` / `Thinking…`.
   - Buttons: **I've finished my answer** (enabled while listening and once the caption has ≥ 3 words), **Repeat question** (max 2 per question).
   - Small self-view camera preview in the corner.
   - Toasts for `time_warning` and reconnection.
5. **Completed:** "Thank you, {firstName}! Your interview is complete. The hiring team will contact you." Keep the page open until uploads finish ("Finishing upload… please don't close this tab"), then show "You can close this window."

## Client audio pipeline

```
getUserMedia stream
 ├─ AudioContext(48k) → AudioWorkletNode('pcm16-downsampler') → 16 kHz Int16 frames (40 ms) → ws.send(binary)
 ├─ MediaRecorder(audio only, 'audio/webm;codecs=opus', timeslice 10s) → upload parts (kind=audio)
 └─ MediaRecorder(video+audio, 'video/webm;codecs=vp8,opus', 1 Mbps, timeslice 10s) → upload parts (kind=video)   [if recordVideo]
```
- Put the worklet in `public/worklets/pcm16-downsampler.js`. Downsample by averaging, clamp, and convert to Int16.
- **Don't** send audio frames while AI audio is playing, unless barge-in is enabled (default: send, and let the engine handle it).
- AI audio playback: decode the base64 WAV into an `AudioBuffer` and play it through the same `AudioContext`. On `ended`, send `ai_done_speaking {turnId}`. If `audio` is null, use `speechSynthesis` with an English voice and send `ai_done_speaking` on `onend`.
- Upload queue: sequential, with retry ×3 and exponential backoff, kept in memory. On `interview_complete`, stop the recorders, flush the last part with `final=true`, and wait for the queue to drain.
- Visibility: on `visibilitychange`, send `client_event` (informational).
- WebSocket reconnect: on unexpected close, show "Reconnecting…", call `POST /session` for a new ticket, and reconnect up to 5 times with backoff. The engine resumes the session.

## Accessibility and UX
- All controls work by keyboard; captions are always visible.
- Keep mobile out of scope, but show a friendly message on narrow screens: "Please use a computer for the best experience."

## Acceptance
- A full interview works in Chrome and Edge on Windows and macOS with headphones and with built-in speakers (echo cancellation means the AI voice isn't transcribed as the candidate).
- Refreshing mid-interview resumes at the same question.
- Uploads complete, and both audio and video parts exist in storage.
