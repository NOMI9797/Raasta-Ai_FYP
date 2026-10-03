# 11 · Stage 2: Interview Analysis and Final Shortlist

## 1. `analyse-interview { interviewId }` (worker)

1. **Wait for the recording:** if `recording_status != 'complete'`, re-enqueue with a 30s delay. After 10 minutes, continue without media (`analysis.media = 'missing'`).
2. **Assemble the recording:** concatenate the parts into `recordings/{id}/audio.webm` and `recordings/{id}/video.webm`, done by the ai-engine `/media/concat` (ffmpeg). Save the keys in `recording_audio_key` / `recording_video_key`.
3. **Build the segments:** use `interview_turns` where `speaker='candidate'` with `offsetMs` → `[{ responseId?, startMs, endMs }]`.
4. **Call the ai-engine** (each with a 10 min timeout; failures recorded per type, never fatal):
   - `POST /analyze/voice { audioKey, segments }`
   - `POST /analyze/emotion { audioKey, segments }`
   - `POST /analyze/gaze { videoKey, sampleFps: 1 }` (if video)
   - `POST /analyze/face { videoKey }` (if `FACE_ANALYSIS_ENABLED=true`)
5. **Store** `interviews.analysis`:
```json
{
  "voice":   { "wpm": 132, "pauseRatio": 0.18, "longPauses": 4, "fillerPerMin": 3.1, "fillerTop": ["um","like"], "jitter": 0.012, "shimmer": 0.08 },
  "emotion": { "dominant": "neutral", "distribution": {"neutral":0.62,"happy":0.2,"...":0}, "confidenceAvg": 0.71 },
  "gaze":    { "eyeContactScore": 78, "attentionScore": 81, "lookAwayCount": 6, "longestLookAwaySec": 4.2, "faceDetectionRate": 0.97 },
  "face":    { "dominant": "neutral", "distribution": {} },
  "integrity": { "tabHiddenCount": 1, "tabHiddenSec": 12 },
  "errors": { "face": "disabled" },
  "version": 1
}
```
6. **Compute `communication_score` (0–100)** in `libs/hiring/final-evaluator.js`. This is a documented, deterministic formula:
   - **Pace (30%):** 100 if 110–160 wpm; linear down to 0 at < 70 or > 210.
   - **Fluency (30%):** `100 − min(100, fillerPerMin × 12) × 0.6 − min(100, pauseRatio × 200) × 0.4`.
   - **Eye contact (25%):** `gaze.eyeContactScore`. If there's no video, reweight to the others.
   - **Composure (15%):** `100 × (neutral + happy share)`, capped at 100.

   Missing components are dropped and the weights renormalised. If nothing is available, the score is `null`.
7. Set `analysis_status = complete` and enqueue `finalize-candidate { candidateId, interviewId }`.

## 2. `finalize-candidate` (worker): `libs/hiring/final-evaluator.js`

```js
finalScore = round(
  w.resume        * candidate.fitScore +
  w.interview     * interview.interviewScore +
  w.communication * interview.communicationScore
)   // weights from hiringConfig.finalWeights; null parts dropped and weights renormalised
```

**LLM summary** (JSON) from the job, fit analysis, Q&A with scores (top/bottom 3), and analysis summary:
```json
{
  "recommendation": "strong_yes" | "yes" | "maybe" | "no",
  "summary": "3-4 sentence hiring summary",
  "strengths": ["..."], "risks": ["..."],
  "suggestedNextSteps": ["e.g. technical round on Kubernetes"]
}
```
Rules for the prompt: base it only on the evidence given; don't mention protected attributes; treat communication metrics as secondary, since non-native English speakers must not be penalised for accent.

**Decision:**
- `suggestedDecision = finalScore >= finalThreshold ? 'final_shortlisted' : 'final_rejected'`
- **Guard:** if `interview.totalAnswers < 50%` of the questions, set `suggestedDecision = 'needs_review'`.
- Save `candidates.final_score` and `final_analysis = { ...llm, suggestedDecision, breakdown: {resume, interview, communication, weights}, computedAt }`.
- If `autoFinalize` and the suggestion isn't `needs_review`: set the candidate status to the suggestion, with `decided_by='system'` and `final_decided_at=now`.
- Otherwise the candidate stays `interview_completed` and appears in the recruiter's **Decisions queue**.
- If `sendOutcomeEmails`, outcome emails go out only after a final status is set.

## 3. Recruiter decision APIs

| Method & path | Purpose |
|---|---|
| `GET /api/hiring/decisions?jobId=` | Candidates in `interview_completed` with `final_analysis`, sorted by `finalScore` |
| `POST /api/hiring/candidates/[candidateId]/decision` | Body `{ decision: 'final_shortlisted'|'final_rejected'|'hired'|'rejected', note? }`; validated with `canTransition`; sets `decided_by=user.id` |
| `POST /api/hiring/jobs/[jobId]/decisions/bulk-approve` | Applies `suggestedDecision` to all pending (excluding `needs_review`) |
| `POST /api/hiring/interviews/[interviewId]/reanalyse` | Re-run analysis + finalize |

## 4. Agent pipeline
The recruiter pipeline's `final_evaluation` step lists finalised candidates. The `approve_final` checkpoint maps to the bulk-approve endpoint (see [13-workers-automation.md](13-workers-automation.md)).

## Implementation notes (Phase 7)
- Files:
  - `libs/interview/analysis.js` (assemble, segments, integrity, analysis) and `analysis-client.js` (ai-engine HTTP)
  - `libs/hiring/final-evaluator.js` (pure formulas, unit-tested), `finalize.js` (final evaluation), `decisions.js` (decisions, bulk approve, outcome email)
  - `libs/ai/prompts/final.js`
- **Assembly:** the room's final part of each kind queues `assemble-recording { interviewId, kind }`. The audio and video jobs run concurrently. Each writes only its own key, and `recording_status` is set in one SQL statement from the row's current keys (`complete` once audio, and video if any video parts exist, are joined).
- **Waiting:** `analyse-interview` re-queues itself every 30 s until `recording_status = complete`. After 10 minutes it assembles whatever was uploaded and continues (`analysis.media` = `ok` | `partial` | `missing`). A Redis lock (`lock:analyse:{id}`) keeps a re-analyse from running alongside a first analysis.
- **Segments:** candidate `interview_turns` give `{ id: "turn-{seq}", startMs: offsetMs, endMs: offsetMs + duration, text }`. The text lets `/analyze/voice` compute WPM and fillers without Whisper. Offsets count from the interview start, so they are approximate after a reconnect.
- **Composure** counts `neutral`, `happy` and `calm` (the speech-emotion model's near-neutral class). **Fluency** without a transcript uses the pause part alone.
- **Summary fallback:** if the LLM fails, a plain summary is built from the computed facts (`fallback: true`). The candidate's name is scrubbed from the LLM output.
- **`final_analysis`** = `{ recommendation, summary, strengths, risks, suggestedNextSteps, suggestedDecision, breakdown { resume, interview, communication, weights, finalWeights, threshold }, communication { score, components, weights }, answered, totalQuestions, interviewId, computedAt, version, decision?, outcomeEmail? }`. `decision` records `{ decision, by, at, note }`. A re-analysis keeps `decision` and `outcomeEmail`.
- **Decisions** go through `applyDecision`, from the decision API, bulk approve, `autoFinalize` and the existing status PATCH, so `decided_by` / `final_decided_at` are always set. A conditional update guards against concurrent decisions.
- **Outcome emails** (`sendOutcomeEmails`) for `final_shortlisted`, `final_rejected` and `rejected` are idempotent (`final_analysis.outcomeEmail`).
- The recruiter gets an in-app notification for every evaluation (suggested decision, or what `autoFinalize` applied).

## Acceptance
- After a completed test interview with recording, `analysis`, `communication_score`, `final_score` and `final_analysis` are filled within 5 minutes.
- With `autoFinalize=false`, the status stays `interview_completed` until the recruiter approves.
- With video disabled, the final score still computes (weights renormalised).
