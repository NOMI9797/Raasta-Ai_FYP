# 04 · Porting the Legacy Interview Source

The interview logic comes from an earlier standalone interview project. Its code sits **outside** this repo at `../interview-engine-src/` and is referred to here as `$SRC`. It is a **read-only reference**: we re-implement its useful parts inside Raasta-AI with our own structure, database and naming.

## Debranding rules (non-negotiable)

- Never write the legacy project's name anywhere: code, comments, strings, file and folder names, env vars, package names, DB names, logs, commit messages or docs. `npm run check:branding` enforces this.
- Interviewer display name: `process.env.INTERVIEWER_NAME || "Raasta AI Interviewer"`.
- Don't copy: `$SRC/frontend/`, `$SRC/design-system/`, `$SRC/diagrams/`, `$SRC/.cursor/`, `*.exe`, `*.h5`, `*.task`, `*.traineddata`, `test_*.json`, `uploads/`, `INTERVIEW_SAVE_STATUS.md`, the READMEs, or the git history.
- Model weights are downloaded at build or runtime into `MODEL_CACHE_DIR` (see [14-ai-engine.md](14-ai-engine.md)), never committed.
- Convert CommonJS to ESM (`import`/`export`) to match this repo.
- Replace `new OpenAI({apiKey: OPENAI_API_KEY})` + `gpt-4o` with `libs/ai/llm.js` (Groq). Replace OpenAI tool-calling with JSON mode (`response_format: { type: "json_object" }`) plus validation.
- Replace Mongoose with Drizzle (`libs/interview/repository.js`).
- Rename concepts: "bot" → "interviewer", "sessionId (Date.now)" → `interviews.id` (uuid), "Recall webhook" → "STT event", "Role" → job, "CV" → candidate.

## File-by-file map

| `$SRC` file | Fate | New location | Notes |
|---|---|---|---|
| `backend/modules/webhooks/controllers/webhookController.js` (`handleTranscription`, `handleLLMResponse`, `getNextQuestion`, `isQuestionAlreadyAnswered`, `speakGreeting`, `speakQuestion`) | **Port (core)** | `libs/interview/session-engine.js` | See "Interview loop rules" below. Inputs become STT events; output becomes `send()` over the WebSocket |
| `backend/modules/bot/services/botService.js` | Port (partial) | `services/interview-engine/session-manager.js` | Keep: session Map, debounce-timer map, periodic save. Drop: all third-party meeting-bot API calls, ffmpeg WAV→MP3, video/participant fetches |
| `backend/utils/answerAnalyzer.js` | Port | `libs/interview/answer-analyzer.js` | Merge the 3 LLM checks (new topic, contradiction, deep experience) into **one** JSON call. Keep the heuristic checks and fallbacks as-is |
| `backend/modules/scoring/services/answerScoringService.js` | Port | `libs/interview/answer-scorer.js` | Same rubric; JSON mode instead of tool calling; keep the keyword fallback scorer |
| `backend/modules/llm/services/llmService.js` → `generateFollowUpQuestion` | Port | `libs/interview/follow-up.js` | Same prompt structure and fallback question table. Drop the other methods |
| `backend/modules/tts/services/ttsService.js` | Rewrite | `libs/interview/tts-client.js` | POST to ai-engine `/tts`, receive audio **bytes** (no file paths) |
| `backend/modules/interviews/models/Interview.js` | Replace | Postgres tables (see [05-data-model.md](05-data-model.md)) | |
| `backend/modules/interviews/services/interviewService.js` | Rewrite | `libs/interview/repository.js` | create / saveSnapshot / appendTurn / saveResponse / complete / statistics |
| `backend/modules/interviews/services/{voice,emotion,gaze}AnalysisService.js` | Rewrite | `libs/interview/analysis-client.js` | Send storage keys, not bot folder IDs |
| `backend/modules/interviews/controllers/interviewController.js` | Reference only | recruiter APIs in `app/api/hiring/interviews/**` | Reuse ideas for the results payload |
| `backend/modules/video-analysis/scripts/emotion_detector.py` | Port | `services/ai-engine/routers/face.py` | Optional facial emotion; needs TensorFlow + model weights |
| `backend/modules/video-analysis/{services,utils,controllers,models}` | Drop | – | Node↔Python bridge not needed |
| `backend/modules/bot/services/audioDownloadService.js`, `interviews/services/interviewVideoDownloadService.js`, `utils/recallBotMedia.js` | Drop | – | The browser uploads recordings directly |
| `backend/modules/webhooks/routes/*`, `bot/routes/*`, `bot/controllers/*` | Drop | – | |
| `backend/modules/{cv,roles,questions,auth}` | Drop | – | Raasta candidates / jobs / `interview_questions` / NextAuth replace them |
| `backend/scripts/*`, `backend/tests/*` | Drop | – | Write new tests ([17-testing.md](17-testing.md)) |
| `server/server.py` | Port, split | `services/ai-engine/routers/{tts,voice,emotion,gaze}.py` | Inputs become storage keys; remove hard-coded `../backend/*` paths |
| `server/services/eye_gaze_service.py` | Port | `services/ai-engine/core/gaze.py` | MediaPipe face landmarker; model file downloaded at startup |
| `server/requirements.txt` | Port | `services/ai-engine/requirements.txt` | Add `python-multipart`, `boto3`, `pyjwt`; add `tensorflow` only if face router enabled |
| `frontend/src/pages/LiveInterview.tsx` | Reference only | Recruiter live monitor ([12-recruiter-ui.md](12-recruiter-ui.md)) | Event handling ideas only, rebuilt in DaisyUI/JS |
| `frontend/src/pages/InterviewDetail.tsx` | Reference only | Recruiter results page | Tab structure ideas only |
| `frontend/src/pages/QuestionBank.tsx` | Reference only | Job question panel | |

## Interview loop rules (must be preserved)

These behaviours were tuned against real interviews. The port must keep them.

### Session state (`InterviewSession.state`)
```js
{
  stage: "waiting" | "greeting" | "asking" | "listening" | "processing" | "closing" | "ended",
  hasGreeted: false,
  questionQueue: [/* remaining base questions */],
  questionsAsked: [{ questionId, questionText, at }],
  questionsAnswered: [{ questionId, answer, at }],
  currentQuestionId: null,      // base question id, or "fu-<uuid>" for a follow-up
  currentQuestionText: null,
  currentBaseQuestionId: null,  // the base question a follow-up belongs to (NEW)
  followUpDepth: 0,
  followUpContext: null,
  currentAnswerBuffer: "",
  lastAnswerAt: null,           // ms epoch of last candidate speech
  isProcessingAnswer: false,    // single-flight lock
  isAiSpeaking: false,          // NEW: ignore/handle barge-in
  startedAt: null,
  questionIndex: 0, totalQuestions: N
}
```

### Rules
1. **Greeting:** once the room is ready (the client sends `ready`), the interviewer speaks:
   `"Hello {firstName}! I'm the Raasta AI Interviewer for the {jobTitle} role. I'll ask you about {N} questions; take your time, and press 'I've finished my answer' when you're done. Are you ready to begin?"`
   Before asking Q1, clear the answer buffer and any pending debounce timer, so stray words like "hi" aren't recorded as an answer to Q1. (The source started on the candidate's first words; we start on client `ready`.)
2. **Start trigger:** either the client sends `begin`, or the candidate says a ready word (`yes, ready, sure, okay, ok, yeah, let's, start, begin`). Then reset the buffer, `followUpDepth=0`, and ask Q1.
3. **Answer accumulation:** each final STT segment is appended to `currentAnswerBuffer` with a space, `lastAnswerAt = now`, and the client gets `caption_final`. Interim segments go to the client only as `caption_partial`.
4. **Finalising an answer:** either
   a. the client sends `answer_done` (immediate), or
   b. **silence ≥ `INTERVIEW_SILENCE_MS` (default 8000)** since `lastAnswerAt`, re-checked when the timer fires.
5. **Single-flight lock:** acquire `isProcessingAnswer = true` synchronously, **before any `await`**. If it's already locked, return. Snapshot `bufferLengthAtStart`, `currentQuestionId` and `currentQuestionText`. Release the lock in `finally`.
6. **Processing pipeline:**
   1. Trim the buffer → transcript turn (`answer`) + response row (`questionId`, `questionText`, `answer`, `isFollowUp = followUpDepth>0`, `followUpDepth`).
   2. **Score asynchronously** (don't block) if the base question has `idealAnswer`. Look the question up in the full question list, not the queue (the asked question has already left the queue). Then update the response row and send `answer_scored` to the recruiter channel only (never to the candidate).
   3. Clear the buffer.
   4. `analyzeAnswer()` → `shouldFollowUp`, `reasonForFollowUp`.
   5. If `shouldFollowUp && followUpDepth < MAX_FOLLOW_UPS (2)` and the time budget remains: generate a follow-up, `followUpDepth++`, `currentQuestionId = "fu-…"`, `currentQuestionText = followUp`.
   6. Otherwise take the next base question, with `followUpDepth = 0`.
   7. **Pre-speak guard:** if the buffer grew by **> 10 characters** since `bufferLengthAtStart`, the candidate kept talking. **Abort**, roll back the follow-up mutations (depth−1 and restore the snapshot id/text), and don't speak.
   8. Otherwise speak the question (TTS) → `question` + `ai_speaking` events.
7. **Reschedule in `finally`:** if the buffer is longer than at start, schedule a new debounce cycle so late speech isn't lost.
8. **Skip-if-already-answered heuristic:** a base question is skipped if its id was already answered, or if ≥ 50% of its words longer than 3 characters appear in the last 10 candidate turns. Keep this, but **log every skip** in `state.skipped[]` and **disable it when fewer than 6 questions remain** (it can wrongly skip short banks).
9. **Closing (new):** when no question is left, or the time budget `interviewMaxMinutes` is reached:
   `"Thank you, {firstName}. That concludes your interview for {jobTitle}. The hiring team will be in touch. You may now close this window."` → `interview_complete` → `session.end("completed")`.
10. **Barge-in (new):** while `isAiSpeaking`, STT finals are buffered but don't start the silence timer until the client reports `ai_done_speaking`.
11. **Fallbacks:** if the follow-up LLM fails, use the fallback table (`answer_incomplete` → "Can you provide more details about that?", etc.). If scoring fails, use the keyword fallback (`0.7 × keyword coverage + 0.3 × min(100, words/30×100)`). If the analyzer LLM fails, use the heuristics only.

### Answer analyzer (port faithfully)
Seven conditions; any one that fires is a reason to follow up:
1. **Incomplete:** words < 15; or a "how" question with no how-words and < 25 words; or a "why" question with no why-words and < 20 words; or completeness score < 60. Completeness = `min(100, words/30×100)` + 10 each for explanation, example and detail words.
2. **New topic** (LLM)
3. **Skill avoided:** < 50% of `expectedKeywords` mentioned
4. **Contradiction** (LLM, also against the candidate's resume skills)
5. **Deep experience** (LLM; fallback: ≥ 2 of the architecture/scalability/… terms)
6. **Natural cues:** regexes like "I can explain more", "should I continue"
7. **Multi-step:** category `behavioral`, or "tell me about a time / describe a situation / give an example / walk me through / explain how you"

The primary reason is the first one in that order. **Known behaviour:** behavioral questions almost always trigger follow-ups. That's intended, but capped by `MAX_FOLLOW_UPS` and the time budget.

### Scorer rubric (port faithfully)
90–100 excellent · 70–89 good · 50–69 adequate · 30–49 weak · 0–29 poor. The scorer considers technical accuracy, completeness, keyword coverage, depth and clarity. Output: `{ score, reasoning, keywordsCovered[], keywordsMissed[] }`.

### Follow-up prompt (port faithfully)
The context includes the role title and description, the candidate's name and skills, the original question (category, keywords), the answer, the follow-up reason and message, the analysis (word count, completeness), and the last 6 conversation messages. Rules: one clear question, probing but respectful, no repeating the original, build on what they said, 1–2 sentences, focus on the reason, and for depth > 0 "drill deeper".

## Mapping Raasta data into the session

`libs/interview/mappers.js`:
```js
export function toCandidateContext(candidate) {
  const p = candidate.parsedData || {};
  return {
    candidateName: candidate.name,
    firstName: (candidate.name || "").split(" ")[0] || "there",
    summary: p.summary || "",
    skills: p.skills || [],
    experience: (p.experience || []).map(e => `${e.title} at ${e.company} (${e.period})`),
    education: (p.education || []).map(e => `${e.degree}, ${e.institution} (${e.period})`),
    yearsExperience: p.yearsExperience ?? null,
  };
}
export function toRoleContext(job) {
  return {
    id: job.id, title: job.title,
    description: job.formalDescription || job.linkedinPost || job.title,
    skills: [...(job.requiredSkills || []), ...(job.techStack || [])],
    experienceRange: job.experienceRange || null,
  };
}
export function toSessionQuestions(rows) {
  return rows.filter(q => q.isActive).sort((a, b) => a.orderIndex - b.orderIndex).map(q => ({
    id: q.id, question: q.question, category: q.category, difficulty: q.difficulty,
    idealAnswer: q.idealAnswer, expectedKeywords: q.expectedKeywords || [], scoreWeight: q.scoreWeight || 1,
  }));
}
```
