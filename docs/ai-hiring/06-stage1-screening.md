# 06 · Stage 1: AI Resume Screening and Auto-Shortlist

## Goal
Every application gets a **fit score (0–100)** against the job description. The best candidates are shortlisted automatically.

## 1. Fix resume intake first (Phase 1)

In `app/api/hiring/apply/[jobId]/route.js`:
1. **Validate the file:** `.pdf`, `.docx` or `.txt`; ≤ 5 MB; reject anything else with 400.
2. **Store the original:** `libs/hiring/storage.js` → `putObject(key, buffer, contentType)`. The key is `resumes/{jobId}/{uuid}.{ext}`. Save it in `candidates.resume_key`, and keep `resume_url` = the original filename for display.
3. **Extract text properly:** `libs/hiring/resume-text.js`.
   - PDF → `pdf-parse` (add the dependency), falling back to the current regex approach if it throws.
     `pdf-parse` must be listed in `experimental.serverComponentsExternalPackages` in `next.config.js`; when webpack bundles it, it throws and every PDF falls back to the regex. If `pdf-parse` returns empty text (a scanned PDF), keep it empty so the resume is flagged unreadable.
   - DOCX → `mammoth`; TXT → utf-8.
4. Keep the existing LLM parse (`parsedData`, `_resumeText`).
5. **Deduplicate:** if a candidate with the same `email` already exists for the same `jobId`, return 409 "You have already applied".
6. Insert the candidate with status `new`. If `getHiringConfig(job).autoScreen`, call `enqueue('screen-candidate', { candidateId })`.
7. Respond immediately; screening is asynchronous.

Add `GET /api/hiring/candidates/[candidateId]/resume` (withAuth + ownership), which redirects to a signed URL or streams the file.

## 2. Fit scorer: `libs/hiring/fit-scorer.js`

```js
export async function scoreCandidateFit({ job, candidate }) → {
  fitScore,            // 0-100 integer
  skillMatch: { matched: [], missing: [], extra: [] },
  experienceMatch: { required: "3-5 years", candidateYears: 4, verdict: "meets" | "below" | "above" | "unknown" },
  educationMatch: { verdict: "relevant" | "partially_relevant" | "not_relevant" | "unknown", note: "" },
  strengths: [],       // max 5
  concerns: [],        // max 5, used for personalised questions
  rationale: "",       // 2-3 sentences
  model: "llama-3.3-70b-versatile",
  version: 1
}
```

**Prompt (system):**
> You are an impartial technical recruiter. Compare the candidate's resume with the job requirements and return ONLY a JSON object with the schema below. Judge only job-relevant evidence: skills, experience, projects and education. Ignore and never mention name, gender, age, religion, nationality, photo, marital status or address. Do not invent facts that are not in the resume. If the resume is empty or unreadable, set fitScore to 0 and explain in rationale.

**Scoring rubric (include in prompt):**
- Required skills coverage: **45%**
- Relevant experience (years + similarity of past roles): **30%**
- Projects and achievements relevant to the stack: **15%**
- Education/certifications relevance: **10%**

**Input to prompt:**
- Job: title, description (`formalDescription || linkedinPost`), required skills, tech stack, experience range, location type, employment type.
- Candidate: `parsedData` without `_resumeText`, plus the first 6000 characters of `_resumeText`.

**Post-processing (deterministic, in code):**
- Clamp `fitScore` to 0–100 and round it.
- Recompute `skillMatch.matched`/`missing` with case-insensitive, synonym-aware matching (`js`↔`javascript`, `node`↔`node.js`, `postgres`↔`postgresql`, `k8s`↔`kubernetes`, `aws`↔`amazon web services`). If the LLM claims a match that doesn't appear in the resume text, move it to `missing`.
- If `parsedData.parseError`, set `fitScore: 0` and `concerns: ["Resume could not be read"]` and flag for manual review.
- Retry the LLM twice. On failure leave the status `new`, set `fit_analysis.error`, and surface "Screening failed – retry" in the UI.

Save to `candidates.fit_score`, `fit_analysis`, `screened_at`, with status `screened`.

## 3. Shortlisting: `libs/hiring/shortlist.js`

```js
export async function applyShortlist(jobId, { triggeredBy = 'system' } = {})
```
1. Load the job and config.
2. Select candidates for the job with status in `screened|reviewed` and `fit_score` not null.
3. Count those already in a post-shortlist status (`shortlisted`, `interview_*`, `final_*`, `hired`) → `alreadyShortlisted`.
4. Sort the remaining candidates by `fit_score DESC, applied_at ASC`.
5. For each: if `fit_score >= minFitScore` and (`maxShortlist` is null or `alreadyShortlisted < maxShortlist`), set `shortlisted` (`alreadyShortlisted++`); otherwise set `not_shortlisted`.
6. Return `{ shortlisted: [...ids], notShortlisted: [...ids] }`.
7. For each newly shortlisted candidate: `enqueue('ensure-questions', { jobId })` (idempotent), then `enqueue('send-invite', { candidateId })` if `autoInvite`.

**Manual override:** a recruiter PATCH to `shortlisted` also triggers `send-invite` if `autoInvite` is on. Otherwise the UI shows a "Send interview invite" button.

## 4. APIs

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/hiring/jobs/[jobId]/screen` | withAuth + owner | Body `{ rescore?: boolean }`. Enqueues `screen-candidate` for every `new` candidate (or all, if rescore), then `shortlist-job`. Returns counts |
| `POST /api/hiring/candidates/[candidateId]/screen` | withAuth + owner | Re-screen one candidate |
| `POST /api/hiring/jobs/[jobId]/shortlist` | withAuth + owner | Run `applyShortlist` now (the "Re-run shortlist" button) and return counts |
| `PATCH /api/hiring/jobs/[jobId]` | existing | Accepts `hiringConfig` (validated) |
| `GET /api/hiring/candidates?jobId=` | existing | Must now return `fitScore`, `fitAnalysis`, `finalScore` and the latest interview summary |

## 5. Agent pipeline change

In `libs/agent-pipelines/recruiter.js`, replace the body of `screen_candidates` to call `scoreCandidateFit` for each `new` candidate and then `applyShortlist(jobId)`. Output: `{ screened, shortlisted, notShortlisted, rankings: [{id, name, fitScore}] }`. Drop the old `minSkillMatch` criterion; read `minFitScore` from the job's hiring config, falling back to `ctx.config.autoScreenCriteria.minFitScore`.

## 6. UI (details in [12-recruiter-ui.md](12-recruiter-ui.md))
- A fit-score badge on every candidate card: green ≥ 75, yellow 50–74, red < 50.
- The expanded card shows matched (green) and missing (red) skill chips, strengths, concerns and the rationale.
- Job header buttons: **"Screen all new"** and **"Re-run shortlist"**.
- Shortlisted / not shortlisted are visible in the filter tabs.

## Acceptance
- Upload 10 fixture resumes ([17-testing.md](17-testing.md)) for the fixture JD. Strong matches score ≥ 75, irrelevant ones < 40, and a run-to-run variance of ±5 is acceptable.
- With `minFitScore=70`, `maxShortlist=3`, exactly 3 candidates are shortlisted, and they are the top 3 by score.
- No personal attributes appear in any `rationale`.
