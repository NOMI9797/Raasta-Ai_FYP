# Part 5 · AI Components

[← Index](README.md) · Previous: [Part 4F](04f-functionality-platform-ops.md) · Next: [Part 6 · Cross-cutting concerns](06-cross-cutting.md)

> **The honest headline.** Raasta-AI uses **pre-trained models through APIs or open weights; the team trained no model** (there is no training code, dataset or fine-tuning anywhere in the repository). The AI contribution is the *system around the models*: prompts with rubrics, input minimisation, deterministic verification of model output, bounded decision rules, fallbacks for every model call, a real-time conversation loop, signal-processing metrics, and human-in-the-loop controls. Section 5.8 answers "Isn't this just a ChatGPT wrapper?" with evidence. Where quality has **not** been measured, this document says so and proposes how.

## Contents

* [5.0 Classification: ML, LLM call, or rule-based?](#50-classification-ml-llm-call-or-rule-based)
* [5.1 Resume parsing](#51-resume-parsing)
* [5.2 Resume–JD fit scoring](#52-resumejd-fit-scoring)
* [5.3 Interview conducting and answer evaluation](#53-interview-conducting-and-answer-evaluation) (question generation · analyzer · scorer · follow-ups · speech/vision)
* [5.4 Failure modes and guards](#54-failure-modes-and-guards)
* [5.5 Fairness, explainability, human oversight](#55-fairness-explainability-and-human-oversight)
* [5.6 How quality was measured, and how it should be](#56-how-quality-was-measured-and-how-it-should-be)
* [5.7 Other AI uses: posts, final summary, client acquisition](#57-other-ai-uses)
* [5.8 "Isn't this just a ChatGPT wrapper?"](#58-isnt-this-just-a-chatgpt-wrapper)

---

## 5.0 Classification: ML, LLM call, or rule-based?

| Component | Genuine ML model (third-party, pre-trained) | LLM API call | Rule-based / deterministic code (ours) |
|---|---|---|---|
| PDF/DOCX text extraction | – | – | libraries (`pdf-parse`, `mammoth`) + regex fallback |
| Resume → structured JSON | – | ✔ (`gpt-oss-120b`) | validation, truncation, `parseError` handling |
| Resume–JD fit score | – | ✔ judgement | clamp, **skill recomputation**, name scrub, enum checks, unreadable guard |
| First shortlist | – | – | ✔ threshold + cap + tie-break (`decideShortlist`) |
| Interview question bank | – | ✔ (`gpt-oss-120b`) | ✔ mix, validation, dedupe, ordering, snapshot |
| Speech-to-text | ✔ Deepgram `nova-3` / Whisper `large-v3-turbo` | – | ✔ cleaning, echo strip, intent rules |
| Text-to-speech | ✔ Kokoro-82M | – | – |
| Turn-taking / conversation | – | – | ✔ state machine, locks, timers |
| Follow-up decision | – | ✔ (3 of 7 conditions, `gpt-oss-20b`) | ✔ (4 of 7 conditions + fallbacks) |
| Answer score | – | ✔ (`gpt-oss-120b`) | ✔ keyword fallback formula, clamping |
| Follow-up question | – | ✔ | ✔ cut-off check, fallback table |
| Pace / pauses / fillers | – | – | ✔ signal processing (RMS VAD) |
| Tone-of-voice emotion | ✔ Wav2Vec2 emotion model | – | ✔ aggregation |
| Eye contact / head / expression | ✔ MediaPipe Face Landmarker | – | ✔ baseline, thresholds, summaries |
| Communication score; final score; decision | – | – | ✔ formulas and thresholds |
| Final narrative | – | ✔ | ✔ fallback summary; name scrub |
| Platform posts | – | ✔ (`gpt-oss-20b`) | ✔ `finalizePost` enforcement |
| Sales messages | – | ✔ (retired Llama default) | ✔ cleaning |
| Lead tiers | – | – | ✔ additive score |
| Agent decisions | – | – | ✔ policy table |

**Reading it:** nothing here trains a model; two columns are other people's models; the third column is the team's own logic, and it decides every outcome that matters (who is shortlisted, what the final score is, what is automatic).

---

## 5.1 Resume parsing

**What it does (plain words).** Reads the text of a CV and writes down name, skills, experience, education, projects in a fixed structure.

**Exactly how.**
* **Input:** text from `pdf-parse`/`mammoth`/UTF-8 (first **8,000** characters sent).
* **Model:** `LLM_MODEL` default `openai/gpt-oss-120b` via Groq; `chatJSON`, temperature **0.1**, max 2000 tokens, JSON mode, no schema hint (the schema is in the system prompt).
* **Prompt (verbatim, `libs/ai/prompts/resume.js`):**

```text
SYSTEM
You are an expert resume parser. Extract ALL available structured data from the resume.
Return a valid JSON object with exactly these fields (use null or [] if not found):
{
  "name": "full name",  "location": "city, country",  "email": "email or null",  "phone": "phone or null",
  "github": "github url or null",  "linkedin": "linkedin url or null",
  "summary": "professional summary paragraph from the resume",
  "skills": ["every skill mentioned: languages, frameworks, tools, databases, cloud, etc"],
  "skillsByCategory": { "languages": [], "frontend": [], "backend": [], "databases": [], "tools": [], "other": [] },
  "yearsExperience": <number estimate or null>,
  "jobTitles": ["all job titles or roles mentioned"],
  "experience": [ { "title": "job title", "company": "company or freelance", "period": "date range", "bullets": ["key responsibility or achievement"] } ],
  "projects": [ { "name": "project name", "description": "what it does", "technologies": ["tech used"] } ],
  "education": [ { "degree": "degree name", "institution": "university/school", "period": "graduation year or expected" } ],
  "availability": "availability info or null",
  "strengths": ["listed strengths"]
}
Return ONLY the JSON object. No markdown fences, no explanation, no extra text.

USER
Parse this resume completely:

<resume text, first 8000 characters>
```

* **Post-processing:** `parseJsonContent` tolerates code fences; arrays are rejected (`{}` if not an object); `_resumeText` (first 10,000 chars) is stored beside the result; failures become `{parseError, _resumeText}`.
* **Why this approach.** Compared with rule-based parsing (spaCy NER/regex, as the FYP report says) it needs no per-format rules and handles any layout; compared with a commercial parsing API it costs nothing extra and keeps data with the same provider already used. *Trade-off:* hallucination risk (e.g., invented years), non-determinism, vendor dependency. `yearsExperience` is an LLM **estimate**.
* **Failure modes:** scanned PDFs (no text), multi-column scrambling, over-long CVs truncated, injection text inside the CV; all contained because the output is only data that later steps re-verify.
* **Quality:** not measured against a labelled set [GAP].

---

## 5.2 Resume–JD fit scoring

**What it does.** Rates how well one candidate fits one job, 0–100, with reasons.

**Exactly how.**
* **Preprocessing:** `stripPersonalFields(parsed)` removes `name, email, phone, location, github, linkedin, _resumeText` from the structured block; the job block gives title, description (`formalDescription || linkedinPost || title`), required skills, stack, experience, location type, employment type; the raw text (first **6,000** chars) is appended.
* **Model & settings:** `gpt-oss-120b`, JSON mode, temperature **0.1**, 1,200 tokens (the helper retries once with 3× if reasoning exhausted the budget), ≤ 3 attempts.
* **Prompt (verbatim, `libs/ai/prompts/fit.js`):**

```text
SYSTEM
You are an impartial technical recruiter. Compare the candidate's resume with the job requirements and return ONLY a JSON object with the schema below. Judge only job-relevant evidence: skills, experience, projects and education. Ignore and never mention name, gender, age, religion, nationality, photo, marital status or address. Do not invent facts that are not in the resume. If the resume is empty or unreadable, set fitScore to 0 and explain in rationale.

Scoring rubric (fitScore is 0-100):
- Required skills coverage: 45%
- Relevant experience (years + similarity of past roles): 30%
- Projects and achievements relevant to the stack: 15%
- Education/certifications relevance: 10%

Refer to the person only as "the candidate".

(+ schema hint appended by chatJSON)
{
  "fitScore": 0-100 integer,
  "skillMatch": { "matched": [...], "missing": [...], "extra": [...] },
  "experienceMatch": { "required": "e.g. 3-5 years", "candidateYears": number or null, "verdict": "meets" | "below" | "above" | "unknown" },
  "educationMatch": { "verdict": "relevant" | "partially_relevant" | "not_relevant" | "unknown", "note": "short note" },
  "strengths": ["max 5 job-relevant strengths"],
  "concerns": ["max 5 gaps or risks"],
  "rationale": "2-3 sentences"
}

USER
JOB
Title: …  Description: …  Required skills: …  Tech stack: …  Experience required: …  Location type: …  Employment type: …

CANDIDATE (parsed resume)
<JSON without personal fields>

CANDIDATE (resume text, first 6000 characters)
<raw text or "(no resume text available)">
```

* **Post-processing** (deterministic, see 04a H10): clamp/round; recompute matched/missing (whole-term synonym-aware regex over raw text + skills + titles + experience + projects); report `unverified`; extra skills only if in text and not required; enum verdicts; name scrubbed from strengths/concerns/rationale; lists ≤ 5; rationale ≤ 800 chars; `model` and `version` recorded. An unreadable resume skips the model.
* **Scoring rubric, in words:** 45% required-skill coverage, 30% relevant experience (years + similarity of past roles), 15% projects, 10% education. The weights are in the prompt only; the model produces the single number, so the rubric is *advisory to the model*, not computed by us. (A stricter design would have the model output four sub-scores and compute the weighted sum in code; see Part 9.)
* **Shortlisting rule on top:** deterministic (04a H11).
* **Why this model/approach and not others.**

| Option | Cost | Accuracy | Latency | Data needed | Verdict |
|---|---|---|---|---|---|
| Keyword/Boolean | ~0 | low on paraphrase, easy to game | ms | none | used only to verify |
| Embeddings + cosine | low | decent ranking, not explainable, ignores "required" | ms | an embedding model | not used |
| Supervised ranker | training cost | potentially best | ms | **thousands of labelled outcomes: not available** | rejected |
| **LLM rubric (chosen)** | cents per candidate | good in practice, unmeasured here | seconds (async) | none | chosen: explainable, no data needed |
| Bigger commercial model (GPT-4-class) | higher | maybe better | seconds | none | not evaluated; swap via `LLM_MODEL`/`LLM_BASE_URL` |

* **Known weaknesses.** Run-to-run variance (acceptance target ±5); the raw text block contains the candidate's name, contact details and anything else on the CV (address, date of birth, marital status, photo mentions are common on CVs) — the model is *told* to ignore them but they are **present** (so "blind screening" is partial, see 5.5); the verifier can be fooled by keyword stuffing.

---

## 5.3 Interview conducting and answer evaluation

### 5.3.1 Question generation

* **Model:** `gpt-oss-120b`, temperature **0.5**, 3000 tokens, JSON; up to 3 attempts; code validates (04b H13).
* **Prompt (verbatim, `libs/ai/prompts/questions.js`):**

```text
SYSTEM
You are an expert technical interviewer preparing a spoken interview for the Raasta AI Interviewer.
Rules for every question:
- It must be answerable verbally in 1-3 minutes. No coding on a whiteboard, no "write a function".
- One sentence, under 30 words, with no multi-part questions.
- "idealAnswer": 3-6 sentences describing what a strong answer contains.
- "expectedKeywords": 3-8 short terms a good answer would mention.
- "scoreWeight": 1 for the warm-up, up to 3 for core technical questions.
- "category" is one of: technical, role, behavioral. "difficulty" is one of: easy, medium, hard.
- Behavioral questions are STAR-style ("Tell me about a time...").
- Never repeat or rephrase a question from the "Existing questions" list.
Return JSON: { "questions": [ { "question", "category", "difficulty", "idealAnswer", "expectedKeywords", "scoreWeight" } ] }

USER (built by buildQuestionsUser)
JOB / Title / Description / Required skills / Tech stack / Experience required

Write exactly N interview questions:
- 1 warm-up (category "role", difficulty "easy", scoreWeight 1), exactly: "Walk me through your background and why this role interests you."
- 2 technical, medium, directly from the required skills and tech stack
- 2 technical, hard, directly from the required skills and tech stack
- 1 role (a practical scenario for this job)
- 2 behavioral (STAR-style)

Existing questions (do not repeat): …
```

* **Personalised variant:** "This candidate's screening found these gaps: Concerns… Required skills not shown on the resume…; write exactly K technical or role questions that let the candidate address these gaps, e.g. 'Your resume doesn't mention Docker; how have you handled deployments?'. Don't mention scores, and don't refer to personal attributes."
* **Why generated, not fixed:** job-specific coverage with a rubric; **why validated:** an LLM-written "ideal answer" can be wrong, so the recruiter edits.

### 5.3.2 Conducting the interview (the loop)

Rule-based (04b H17); the LLM is called at three points per answer.

### 5.3.3 Follow-up analysis (verbatim, `libs/ai/prompts/interview.js`)

```text
SYSTEM  You are an expert technical interviewer analyzing a candidate's spoken answer. Respond ONLY with a JSON object.

USER
Question: "<question>"
Expected Keywords: [...]
Candidate Answer: "<answer>"
Candidate's resume mentions: [skills]

Answer three questions about this answer:
1. opensNewTopic: does it mention something interesting, ambiguous, or a new topic that wasn't in the original question but would be valuable to explore further?
2. hasContradictions: does it contain technical inaccuracies, contradictions with the resume claims, unusual or questionable statements, or statements that contradict common knowledge?
3. showsDeepExperience: does it show deep, advanced experience worth exploring further (advanced concepts, specific implementation details, complex problem solving, real-world experience, depth beyond surface level)?

Respond with ONLY this JSON:
{ "opensNewTopic": true/false, "newTopic": "brief description" or null,
  "hasContradictions": true/false, "contradictionType": "technical" | "cv" | "logic" | "unusual" | null,
  "showsDeepExperience": true/false, "experienceAreas": ["area1"], "reasoning": "brief explanation" }
```
Settings: fast model `gpt-oss-20b`, temperature 0.3, 600 tokens, `reasoningEffort: low` (runs between answer and next question). Combined with four heuristics (completeness, skill coverage, natural cues, multi-step) per 04b H20; the first firing condition is the reason.

### 5.3.4 Answer scoring rubric (verbatim)

```text
SYSTEM
You are an expert interview evaluator. Score the candidate's answer against the ideal answer.

Scoring Guidelines:
- 90-100: Excellent - covers all key points, demonstrates deep understanding
- 70-89: Good - covers most key points, shows solid understanding
- 50-69: Adequate - covers some key points, basic understanding
- 30-49: Weak - misses important points, limited understanding
- 0-29: Poor - fails to address the question, major gaps

Consider:
1. Technical accuracy
2. Completeness of answer
3. Coverage of expected keywords
4. Depth of understanding
5. Clarity of explanation

The answer was spoken and transcribed automatically, so ignore filler words and transcription errors.
Respond ONLY with JSON: { "score": 0-100, "reasoning": "brief explanation", "keywordsCovered": [], "keywordsMissed": [] }

USER
Question: "…"  Ideal Answer: "…"  Expected Keywords: […]  Candidate's Answer: "…"
Evaluate and score this answer.
```
`gpt-oss-120b`, temperature 0.3, 1,500 tokens (the model's own reasoning counts against it; an earlier 500 produced empty replies and keyword-only scores), clamp 0–100, fallback formula `0.7 × keyword coverage + 0.3 × min(100, words/30 × 100)`.

### 5.3.5 Follow-up question prompt (verbatim structure)

```text
You are an expert interviewer conducting a professional interview. Generate a thoughtful follow-up question based on the candidate's answer.

INTERVIEW CONTEXT: Role, Position Requirements
CANDIDATE INFORMATION: Name, Skills
ORIGINAL QUESTION: "…"  Category  Expected Keywords
CANDIDATE'S ANSWER: "…"
FOLLOW-UP REASON: <condition>: <message>
ANSWER ANALYSIS: Word Count, Completeness Score, Issues Detected
CONVERSATION HISTORY (Last 3 exchanges): last 6 messages, each cut to 100 chars

RULES FOR FOLLOW-UP GENERATION:
1. Ask ONE clear, specific follow-up question
2. Be probing but respectful
3. Don't repeat the original question
4. Build on what the candidate said
5. Keep it concise (1-2 sentences max)
6. Focus on the follow-up reason (<condition>)
7. Don't ask about something already covered in their answer
8. (if depth > 0) This is follow-up #N - be more specific and drill deeper

Reply with only the follow-up question.
```
`chatText`, `gpt-oss-120b`, `reasoningEffort: low`; attempt 1: 500 tokens, temp 0.7; attempt 2: 900, temp 0.3; accept only if ≤ 400 chars and ends with terminal punctuation; else a fixed fallback per reason ("Could you add a bit more detail to your answer?", "Could you clarify that last point for me?", "Please, go ahead and tell me more.", …).

### 5.3.6 Speech and vision models

* **Deepgram nova-3** (streaming ASR) with options in 04b H18; **Whisper large-v3-turbo** via Groq as fallback (chunked; `verbose_json` segments filtered by confidence).
* **Kokoro-82M** TTS (voices af_*/am_*; default `am_michael`).
* **Wav2Vec2 speech emotion** (`r-f/wav2vec-english-speech-emotion-recognition`; classes angry, disgust, fear, happy, neutral, sad, surprise; 12 s windows; used only for *composure*, i.e. neutral+happy+calm share).
* **MediaPipe Face Landmarker** in the browser (head pose, iris, blendshapes) and in the AI engine for gaze fallback.
* **Why these, not alternatives:** local/free (Kokoro, MediaPipe, Wav2Vec2) or already-available APIs (Groq Whisper); Deepgram for streaming latency. *Not evaluated here for accent robustness* [GAP].

**Latency target** (`docs/ai-hiring/09`): ≤ 4 s from the end of an answer to the next question's audio with Groq. **Recorded measurement:** with a stub LLM, `answer_done` → next question in < 50 ms (pure loop overhead); real-model latency with keys was **not recorded** [GAP].

---

## 5.4 Failure modes and guards

| Failure mode | Where it can occur | Guard in the system | Residual risk |
|---|---|---|---|
| **Hallucinated facts** (skills, years) | resume parse; fit explanation | skills recomputed from text; unsupported claims flagged `unverified`; raw text kept for re-parse | `yearsExperience` and verdicts remain LLM judgement |
| **Hallucinated or wrong scores** | fit score; answer score; ideal answers | clamp/round; low temperature; reasoning + keywords visible; keyword fallback; recruiter review; scores advisory | A wrong-but-plausible ideal answer mis-scores everyone consistently; no calibration |
| **Bias against certain resumes** | fit scoring | structured block de-identified; prompt forbids protected attributes; name scrubbed from outputs; no photo/address features | **Raw resume text still contains name/contact/etc.**; institution names, employer names and location text can proxy for class/region; no audit [GAP] |
| **Bias against accents/language styles** | STT → transcript → scorer; communication metrics | prompts: ignore transcription errors / never penalise accent; communication = secondary (20% default) and renormalised when missing; English-only STT makes the system *restrictive* for non-English speakers | Misrecognised words lower keyword coverage; speaking pace/filler metrics can differ by language background; not measured |
| **Bias in vision signals** | eye contact, expressions | relative to the candidate's own baseline; labelled "signals, not verdicts"; can be disabled per job (`trackBehavior`) | Landmark accuracy may vary by skin tone, lighting, glasses, camera angle; unmeasured |
| **Prompt injection via resume** | parse, fit, final summary | model has no tools; output only data; numbers clamped and compared to thresholds; recruiter sees rationale | A stuffed or instruction-bearing CV can raise its own score; verifier matches keywords by presence |
| **Prompt injection via interview answers** | analyzer, scorer, follow-up, final summary | single-answer influence is bounded by weights; follow-up text is capped at 400 chars; scoring reasoning is shown only to the recruiter | A candidate can try to steer the interviewer's next question or the score |
| **Inconsistent scoring across runs** | fit, answer scores | temperature 0.1–0.3; fixed rubric; recorded `model`/`version`; re-screen button | No ensembling or seed; variance not measured |
| **Model withdrawal / drift** | any | model names in env; `LlmError` taxonomy; changes via `LLM_MODEL`, `LLM_FAST_MODEL`, `LLM_BASE_URL`; version stored in `fit_analysis` | The sales code path has a hard-coded retired model [GAP] |
| **Provider outage / slowness** | any | 30 s timeout; retry/backoff; fallbacks (keyword score, canned follow-up, deterministic summary, text-only TTS); queue retries; no auto-rejection on failure | Screening waits for recovery |
| **Gaming the interview** (reading from notes, another person, AI helper) | room | integrity events (tab hidden, offline), face-absent/multi-face flags in behaviour summary, recording kept; escalation when tab hidden ≥ 3 times/30 s | Cannot detect a second device, whispering, screen-sharing assistants; no proctoring claim is made |
| **Over-trust by recruiters** | decisions | borderline escalation within 5 points; `needs_review`; evidence before score in the agent inbox; UI wording "not proof of misconduct" | Automation bias is a human-factors issue |

---

## 5.5 Fairness, explainability and human oversight

* **Can a recruiter see why a candidate was shortlisted or rejected?** Yes, at both stages. Stage 1: matched/missing skills (recomputed), experience verdict, education verdict, strengths, concerns, rationale. Stage 2: score breakdown with weights, per-answer scores with reasoning and keyword coverage, the full transcript linked to the recording, communication components and their sources, AI summary with strengths/risks.
* **Can they override?** Yes: any shortlist/not-shortlist move; question edits; resending/extending/cancelling; final approve/override/mark hired/reject (`MANUAL_TRANSITIONS`, `applyDecision`). **No UI exists to edit an individual answer score or add reviewer notes to an answer** [GAP].
* **Who is accountable?** The recruiter who presses approve is recorded (`decided_by`, `final_decided_at`, `decision.note`). When `autoFinalize` is on the system user is recorded and the job owner is responsible for choosing that setting (default off, with a warning). The supervised agent never rejects without asking.
* **Candidate-facing transparency:** consent before recording and analysis; the invitation email states recording, AI evaluation, and camera analysis; candidates never see scores; outcome emails are generic. **No candidate right to explanation or human review request is implemented** [GAP].
* **Ethical position to state:** AI output is a *decision aid*; no fully automated rejection by default; delivery signals are minority weights; sensitive-attribute inference is prohibited by prompt and not computed.
* **Proposed fairness evaluation** (not done): (1) *counterfactual CV test*: for 30 CVs, create variants with names/pronouns/universities swapped (e.g., typically male↔female, local↔foreign names), score each 5 times, report mean Δscore and 95% CI; (2) *accent robustness*: synthesise or record the same scripted answers in several accents/TTS voices, compare WER and answer scores; (3) *camera robustness*: same scripted session under different lighting/skin tones/camera heights, compare eye-contact scores; (4) report disparities against a pre-set tolerance (e.g., |Δ| < 3 points).

---

## 5.6 How quality was measured, and how it should be

### What exists (evidence)

| Item | Evidence | What it proves | What it does *not* prove |
|---|---|---|---|
| 436 unit tests | `tests/hiring/*.test.js` | deterministic logic is correct and regressions are caught | AI quality |
| Phase acceptance runs with stub or real LLM | `docs/ai-hiring/16` progress log | pipeline works end to end; e.g. Phase 7: 39/39 checks (stub LLM) | scoring accuracy (stub) |
| Fit acceptance criteria defined | `docs/ai-hiring/06`: strong ≥ 75, unrelated < 40, ±5 variance, 10 fixtures | a target | **never recorded as met with the real model** — Phase 2 notes "still needs a run with a Groq key" [GAP] |
| Real recording analysis | 2026-10-07 entry: 858 s audio / 848 s video joined; communication score **59** with the AI engine off; MediaPipe found a face in **99.8 %** of samples over a 14-minute video | the pipeline works on one real session | validity of the 59, n = 1 |
| Question bank real-model check | "8 valid questions, ≥ 3 keywords each" listed as acceptance, "needs a Groq key" | – | not recorded as run |

**No accuracy metric (precision/recall, correlation with human raters) exists for any AI component.** State this plainly if asked, then present the protocol below.

### Proposed evaluation protocol (to run before the viva if time allows)

| Component | Data | Metric | Target (proposal, not a claim) |
|---|---|---|---|
| Fit score | 30–50 anonymised CVs × 2–3 JDs, ranked by 2 recruiters | Spearman ρ / Kendall τ vs mean recruiter rank; inter-rater agreement for context; precision@k of the shortlist | ρ ≥ 0.6 and not worse than keyword baseline |
| Fit stability | same CV × 5 runs | standard deviation | SD ≤ 3 points |
| Shortlist | rule only | unit-tested; precision@3 against recruiter top-3 | – |
| Question quality | 8 jobs × 8 questions rated by a recruiter (clarity, relevance, ideal answer correctness 1–5) | mean ≥ 4 | – |
| Answer scorer | 100 recorded/typed answers graded by 2 humans on the same rubric | Pearson r and quadratic weighted kappa | r ≥ 0.7 |
| STT | 20 answers from speakers with different accents | WER per group | gap < 3 pts |
| Latency | 30 turns | p50 / p95 answer-end → question audio | p95 ≤ 5 s |
| Cost | 10 interviews | tokens and API cost per interview | report |
| Voice metrics | 20 clips with hand-counted words/pauses | error of wpm, pause count | within 10% |

---

## 5.7 Other AI uses

* **Final summary** (`FINAL_SYSTEM`, verbatim):

```text
You are an impartial hiring panel writing the final evaluation of a candidate after an AI-led interview. Use ONLY the evidence provided: the job, the resume screening result, the interview answers with their scores, and the delivery metrics. Do not invent facts.

Rules:
- Refer to the person only as "the candidate".
- Never mention or infer name, gender, age, religion, ethnicity, nationality, accent, disability, appearance or any other protected attribute.
- Treat communication metrics (pace, pauses, filler words, eye contact, emotion) as secondary evidence. Many candidates are not native English speakers; never penalise accent or language background.
- Base the recommendation mainly on job-relevant skills shown in the resume and in the interview answers.
- Keep the summary to 3-4 sentences, factual and specific.

(+ schema) { "recommendation": "strong_yes"|"yes"|"maybe"|"no", "summary": "3-4 sentence hiring summary",
             "strengths": ["max 5"], "risks": ["max 5"], "suggestedNextSteps": ["max 3, e.g. technical round on Kubernetes"] }
```
User message lists job title/skills/experience, the screening result, questions answered "x of N", average answer score, the strongest and weakest 3 answers (400 chars each), communication score and metrics (pace, pause ratio, fillers/min, eye contact), tab switches, and the computed final score vs threshold. Temperature 0.2, 900 tokens. The recommendation is **not** used to decide; the formula is.
* **Platform posts** (`libs/hiring/platform-content.js`): three system prompts, tone presets (professional, casual, enthusiastic, formal), rules in 04d H3.
* **Sales messages** (`libs/groq-service.js`): LinkedIn (verbatim in 04e S6) and the Rozee B2B outreach prompt ("Use ONLY information from the FACTS block. Do not invent revenue, team size, awards, or services the company offers…"). **Client-acquisition "intelligence"** beyond messages is deterministic tiering (`scoreRozeeJobLead`) and, optionally, web research (Google/SerpAPI). No ML model scores leads; no conversion data exists to train one.

---

## 5.8 "Isn't this just a ChatGPT wrapper?"

**Model answer (45 seconds).** "A wrapper forwards a user's text to a model and prints the answer. Here the model is called at 12 well-defined points, and every call is surrounded by our own logic: we remove identifying fields before scoring, we recompute the facts the model claims from the source text, we clamp and validate every output, and every decision that matters — who is shortlisted, the final score, whether anything is automatic — is made by deterministic rules we wrote and unit-tested. The interviewer is a real-time system: streaming speech recognition, echo cancellation of the interviewer's own voice, a locked state machine for turn-taking, reconnect-and-resume, background scoring, recording assembly with ffmpeg and signal-processing metrics, camera analysis on-device. If the language model disappeared, the platform would still run with fallbacks; if you took away our code, the model would have nothing to talk to."

**Evidence to point to.**

| Claim | Evidence |
|---|---|
| Non-prompt logic dwarfs prompts | prompt files: ≈ 350 lines (`libs/ai/prompts`); non-prompt logic: `libs/hiring` ≈ 3.4 k, `libs/interview` ≈ 4.0 k, `libs/agent` ≈ 1.6 k, `libs/system` ≈ 1.3 k, `libs/poster` ≈ 2.8 k, interview engine ≈ 0.55 k, worker ≈ 0.4 k, Python engine ≈ 1.2 k lines (`wc -l`, 2026-10-08) |
| Deterministic decision layer | `decideShortlist`, `finalScore`, `suggestDecision`, `policy.js` and their tests |
| Output verification | `postProcessFit` + `fit-postprocess.test.js` (hallucinated skills flagged; name scrubbed; unreadable → 0) |
| Fallback for every call | `fallbackScore`, `FALLBACK_FOLLOW_UPS`, `fallbackSummary`, heuristic analyzer, browser TTS |
| Real-time engineering | `session-engine.js` (845 lines, 29 tests with fake timers), `echo-guard.js`, `stt/clean.js`, `session-manager.js` |
| Signal processing | `voice-metrics.js` (RMS VAD, pauses, WPM, fillers), `behavior.js` (baseline-relative gaze) |
| Honest limits | this Part (5.4–5.6) |

**Likely follow-up:** *"But the intelligence is still the LLM's."* → "The *judgement of text quality* is, yes, and we say so; what we added is the structure that makes that judgement usable: a rubric, evidence checks, thresholds and a human gate. We did not claim a new model. Our contribution is the end-to-end system and how it fails safely."
