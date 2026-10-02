# 18 · FYP Report Updates

Changes needed in the Raasta-AI FYP report (Overleaf) so the document matches the implemented system.

## Fixes to existing content
1. **Resume parsing:** the report says spaCy, but the code uses an LLM (Groq, Llama 3.3 70B) with structured JSON output plus `pdf-parse`/`mammoth` text extraction. Update the module description, the requirements and any sequence diagram that mentions spaCy (or implement spaCy; the docs and code must agree).
2. **Background workers:** several diagrams still name a Python task worker. Replace it with the Node.js hiring worker (Redis Streams) and the interview engine.
3. **Fig 2.12 (Configure Job Preferences)** is a copy of the ICP diagram; redraw it.
4. **Interview module:** previously only named in Scope and Fig 2.1. It is now fully specified (below).

## New/updated sections

### Scope (1.2)
Describe the hiring pipeline as: AI resume screening → automatic shortlist → AI-generated question bank → emailed interview link → browser-based AI voice interview with adaptive follow-ups and per-answer scoring → recording analysis (speech pace, fluency, eye contact, emotion) → combined final score → recruiter-approved final shortlist.

### User classes
- **Recruiter:** gains automation settings, interview review and the decision queue.
- **Candidate:** gains the "Attend AI Interview" capability (unauthenticated, via a one-time link).

### Use cases (add detailed tables)
| ID | Name | Actor |
|---|---|---|
| UC-HR-07 | AI Resume Screening & Auto-Shortlist | System / Recruiter |
| UC-HR-08 | Manage Interview Question Bank | Recruiter |
| UC-HR-09 | Send Interview Invitation | System / Recruiter |
| UC-HR-10 | Attend AI Interview | Candidate |
| UC-HR-11 | Monitor Live Interview | Recruiter |
| UC-HR-12 | Analyse Interview & Compute Final Score | System |
| UC-HR-13 | Approve Final Decision | Recruiter |

### Functional requirements (examples to add)
- FR-HR-10: The system shall compute a 0–100 fit score for each application against the job description.
- FR-HR-11: The system shall shortlist candidates whose fit score meets the job's threshold, up to the configured maximum.
- FR-HR-12: The system shall generate interview questions, each with an ideal answer and expected keywords.
- FR-HR-13: The system shall email shortlisted candidates a unique, expiring interview link.
- FR-HR-14: The system shall conduct a spoken interview, asking up to two follow-up questions per question.
- FR-HR-15: The system shall score each answer from 0 to 100 against its ideal answer.
- FR-HR-16: The system shall analyse the interview recording for speech rate, filler words, pauses, eye contact and emotion.
- FR-HR-17: The system shall compute a weighted final score and suggest a decision for recruiter approval.

### Non-functional requirements
- Latency: next question within 4–5 s of the answer ending.
- Privacy: explicit consent; tokens stored hashed; recordings deletable.
- Fairness: AI prompts exclude protected attributes; communication metrics are secondary signals.
- Availability: an interview resumes after a disconnect within 15 minutes.

### Architecture (Layer 4)
Add the **Interview Engine** (WebSocket, STT, interview loop, TTS client), **Hiring Worker** (Redis Streams) and **AI Engine** (Python: TTS, speech/vision analysis) to the architecture diagram, plus object storage.

### Data design
Add the ERD entities `InterviewQuestion`, `Interview`, `InterviewTurn`, `InterviewResponse` and the new `Candidate`/`Job` attributes (see [05-data-model.md](05-data-model.md)).

### Sequence diagrams
1. Application → screening → shortlist → invite.
2. Interview session (browser ↔ engine ↔ STT ↔ LLM ↔ TTS).
3. Post-interview analysis → final evaluation → recruiter approval.

### Class diagram
Add `InterviewSession`, `SessionManager`, `AnswerAnalyzer`, `AnswerScorer`, `FitScorer`, `FinalEvaluator`, `QuestionGenerator`, `InvitationService`.

### Testing chapter
Summarise [17-testing.md](17-testing.md): unit tests (session engine concurrency, scoring formulas), integration (scripted interview client), and E2E demo.
