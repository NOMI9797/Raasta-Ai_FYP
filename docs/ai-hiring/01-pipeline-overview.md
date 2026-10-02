# 01 · Pipeline Overview

## In simple words

1. **Recruiter posts a job.** They enter the job details, and AI writes the job post and publishes it (LinkedIn / Rozee). *(Already exists.)*
2. **Candidates apply.** They fill the public form and upload a resume, and the system extracts skills, experience and education. *(Exists. This branch also stores the resume file and improves PDF text extraction.)*
3. **AI screens resumes (first shortlist).** Each resume is compared with the job description and gets a **fit score (0–100)** with matched and missing skills. Candidates above the threshold (and within the top-N limit) are **shortlisted**.
4. **AI prepares interview questions.** It writes a question bank per job, with an ideal answer and expected keywords for each question.
5. **Shortlisted candidates get an interview link.** An email goes out with a private link that expires (default 72h). A reminder is sent if the link hasn't been opened.
6. **Candidate takes the AI interview.** They open the link in a browser, give consent, and check their mic and camera. The **Raasta AI Interviewer** asks questions by voice and the candidate answers aloud. The interviewer can ask up to 2 follow-ups per question, and every answer is scored live.
7. **AI analyzes the interview.** The recording is analyzed for speaking pace, pauses, filler words, eye contact and emotion, which gives a **communication score**.
8. **Final scoring (second shortlist).** `final = resume fit × w1 + interview × w2 + communication × w3`. Above the cut-off the candidate becomes **final shortlisted**; otherwise **final rejected** (a suggestion until the recruiter approves).
9. **Recruiter decides.** The recruiter sees scores, Q&A, transcript, recording and an AI summary, approves the result, and marks the candidate **hired** or rejected.

## Actors

| Actor | Does |
|---|---|
| Recruiter | Creates jobs, sets hiring automation config, edits questions, approves shortlists and final decisions |
| Candidate | Applies, takes the AI interview via the emailed link |
| System (worker) | Screens, generates questions, sends invites and reminders, runs analysis, computes final scores |
| Raasta AI Interviewer (engine) | Conducts the live voice interview |

## Candidate status machine

Defined once in `libs/hiring/statuses.js` (see [05-data-model.md](05-data-model.md)).

```
new
 └─(screening)→ screened
                 ├→ shortlisted ─(invite sent)→ interview_invited
                 │                                 ├→ interview_expired      (link not used before expiry)
                 │                                 └─(candidate opens & starts)→ interview_in_progress
                 │                                                                 └→ interview_completed
                 │                                                                       └─(final evaluation)→
                 │                                                                           ├→ final_shortlisted → hired
                 │                                                                           └→ final_rejected
                 └→ not_shortlisted
```

Legacy statuses `reviewed` and `rejected` remain valid (used by existing UI and data):
- `reviewed` is treated like `screened`.
- `rejected` is a manual rejection at any stage.

| Status | Set by | Meaning |
|---|---|---|
| `new` | apply route | Application received |
| `screened` | worker | Fit score computed, not yet decided |
| `shortlisted` | worker / recruiter | Passed stage 1 |
| `not_shortlisted` | worker / recruiter | Failed stage 1 |
| `interview_invited` | worker | Invite email sent, link active |
| `interview_expired` | worker sweep | Link expired unused |
| `interview_in_progress` | engine | Candidate is in the interview |
| `interview_completed` | engine | Interview ended normally |
| `final_shortlisted` | worker (autoFinalize) / recruiter | Passed stage 2 |
| `final_rejected` | worker (autoFinalize) / recruiter | Failed stage 2 |
| `hired` | recruiter | Final outcome |
| `rejected` | recruiter | Manual rejection at any point |

**Allowed manual overrides (recruiter):** any status → `rejected`; `not_shortlisted` → `shortlisted`; `screened` → `shortlisted`/`not_shortlisted`; `final_rejected` ↔ `final_shortlisted`; `final_shortlisted` → `hired`; `interview_expired` → `interview_invited` (via "Resend invite").

## Automation modes

Controlled by `jobs.hiring_config` (see [05-data-model.md](05-data-model.md)):

| Setting | Effect |
|---|---|
| `autoScreen` | Screen each application as soon as it arrives |
| `autoInvite` | Email the interview link as soon as someone is shortlisted |
| `autoFinalize` | Apply the final decision without recruiter approval (default **false**) |

With everything on except `autoFinalize`, the recruiter only has to approve final decisions.

## End-to-end sequence

```
Candidate      Next.js app            Redis/Worker            Interview engine       AI engine     Postgres
   |  apply ──►  POST /apply/[jobId]
   |             store resume, parse ─────────────────────────────────────────────────────────────► candidates(new)
   |             XADD screen-candidate ─► screen-candidate
   |                                     fit score (LLM) ─────────────────────────────────────────► candidates(screened→shortlisted)
   |                                     ensure questions (LLM) ──────────────────────────────────► interview_questions
   |                                     send-invite: token+email ────────────────────────────────► interviews(invited)
   |  ◄──────────────── email with /interview/{token}
   |  open link ► GET /interview/[token] (validate)  ─────────────────────────────────────────────► interviews(opened)
   |  start ────► POST /api/interview/[token]/session → ticket
   |  WSS ───────────────────────────────────────────────────────► engine (ticket)
   |  mic audio ─────────────────────────────────────────────────► STT → loop → LLM → TTS ◄─► /tts
   |  ◄──────────────────────────────────────────────── AI voice + captions
   |  recording chunks ► POST /api/interview/[token]/upload → storage
   |                                                               end → XADD analyse-interview ─► interviews(completed)
   |                                     analyse-interview ─────────────────────────► /analyze/* 
   |                                     finalize-candidate (LLM summary) ────────────────────────► candidates(final_*)
Recruiter ◄── results page, approve ─────────────────────────────────────────────────────────────► candidates(hired/rejected)
```
