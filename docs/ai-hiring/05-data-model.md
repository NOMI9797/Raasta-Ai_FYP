# 05 · Data Model

All changes go into **both** `libs/schema.js` and `libs/schema.ts` (identical table definitions) and into the hand-written migration `drizzle/0009_ai_hiring.sql`. Add `index` and `uniqueIndex` to the `drizzle-orm/pg-core` import list. The repo uses drizzle-orm 0.44, so the third `pgTable` argument returns an **array**.

## 1. `jobs`: add hiring configuration

```js
hiringConfig: json('hiring_config'), // see DEFAULT_HIRING_CONFIG
```

`libs/hiring/config.js`:
```js
export const DEFAULT_HIRING_CONFIG = {
  autoScreen: true,          // screen on apply
  minFitScore: 70,           // stage-1 threshold (0-100)
  maxShortlist: 20,          // top-N cap per job (null = no cap)
  autoInvite: true,          // email interview link on shortlist
  inviteExpiryHours: 72,
  reminderAfterHours: 24,
  questionCount: 8,          // base questions in the bank
  personalisedQuestions: 0,  // extra per-candidate questions (0-2)
  maxFollowUps: 2,
  interviewMaxMinutes: 25,
  resumeWindowMinutes: 15,   // reconnect window after disconnect
  recordVideo: true,
  finalWeights: { resume: 0.3, interview: 0.5, communication: 0.2 },
  finalThreshold: 70,
  autoFinalize: false,       // false = recruiter approves final decisions
  sendOutcomeEmails: false,
};
export function getHiringConfig(job) {
  const c = { ...DEFAULT_HIRING_CONFIG, ...(job?.hiringConfig || {}) };
  c.finalWeights = { ...DEFAULT_HIRING_CONFIG.finalWeights, ...(job?.hiringConfig?.finalWeights || {}) };
  return c;
}
```
Validate on save: thresholds 0–100, weights ≥ 0 and normalised to sum 1, `questionCount` 3–15, `interviewMaxMinutes` 5–60.

## 2. `candidates`: add columns

```js
resumeKey: text('resume_key'),              // storage key of original file
fitScore: integer('fit_score'),
fitAnalysis: json('fit_analysis'),          // see 06-stage1-screening.md
screenedAt: timestamp('screened_at'),
finalScore: integer('final_score'),
finalAnalysis: json('final_analysis'),      // see 11-stage2-evaluation.md
finalDecidedAt: timestamp('final_decided_at'),
decidedBy: text('decided_by'),              // 'system' | users.id
```
Widen `status` from `varchar(20)` to `varchar(30)` (`interview_in_progress` is 21 characters).

## 3. `interview_questions` (new)

```js
export const interviewQuestions = pgTable('interview_questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }).notNull(),
  candidateId: uuid('candidate_id').references(() => candidates.id, { onDelete: 'cascade' }), // null = job-wide; set = personalised
  question: text('question').notNull(),
  category: varchar('category', { length: 20 }).notNull().default('technical'), // technical | role | behavioral
  difficulty: varchar('difficulty', { length: 10 }).notNull().default('medium'), // easy | medium | hard
  idealAnswer: text('ideal_answer').notNull(),
  expectedKeywords: json('expected_keywords').default([]),
  scoreWeight: integer('score_weight').default(1).notNull(), // 1-5
  orderIndex: integer('order_index').default(0).notNull(),
  source: varchar('source', { length: 10 }).notNull().default('ai'), // ai | manual
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('interview_questions_job_idx').on(t.jobId, t.isActive),
]);
```

## 4. `interviews` (new)

```js
export const interviews = pgTable('interviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(), // job owner
  jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }).notNull(),
  candidateId: uuid('candidate_id').references(() => candidates.id, { onDelete: 'cascade' }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('invited'),
  //  invited | opened | in_progress | completed | abandoned | expired | failed | cancelled
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  invitedAt: timestamp('invited_at').defaultNow().notNull(),
  reminderSentAt: timestamp('reminder_sent_at'),
  openedAt: timestamp('opened_at'),
  consentAt: timestamp('consent_at'),
  startedAt: timestamp('started_at'),
  endedAt: timestamp('ended_at'),
  lastActivityAt: timestamp('last_activity_at'),
  durationSec: integer('duration_sec'),
  questionSnapshot: json('question_snapshot'),   // questions frozen at start
  state: json('state'),                          // live session snapshot (resume)
  clientInfo: json('client_info'),               // UA, devices
  integrityEvents: json('integrity_events').default([]), // [{type:'tab_hidden', at}]
  recordingAudioKey: text('recording_audio_key'),
  recordingVideoKey: text('recording_video_key'),
  recordingStatus: varchar('recording_status', { length: 20 }).default('none'), // none|uploading|complete|failed
  totalQuestions: integer('total_questions'),
  totalAnswers: integer('total_answers'),
  followUpCount: integer('follow_up_count'),
  interviewScore: integer('interview_score'),
  communicationScore: integer('communication_score'),
  analysis: json('analysis'),                    // see 11-stage2-evaluation.md
  analysisStatus: varchar('analysis_status', { length: 20 }).default('pending'), // pending|processing|complete|failed|skipped
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('interviews_candidate_idx').on(t.candidateId),
  index('interviews_job_status_idx').on(t.jobId, t.status),
  index('interviews_user_status_idx').on(t.userId, t.status),
]);
```
Rule: at most **one active interview per candidate** (status in `invited|opened|in_progress`). Enforce this in code inside a transaction.

## 5. `interview_turns` (new): full transcript

```js
export const interviewTurns = pgTable('interview_turns', {
  id: uuid('id').primaryKey().defaultRandom(),
  interviewId: uuid('interview_id').references(() => interviews.id, { onDelete: 'cascade' }).notNull(),
  seq: integer('seq').notNull(),
  speaker: varchar('speaker', { length: 10 }).notNull(), // ai | candidate
  kind: varchar('kind', { length: 15 }).notNull(),       // greeting | question | follow_up | answer | closing | system
  questionId: text('question_id'),                       // base uuid or "fu-…"
  text: text('text').notNull(),
  startedAt: timestamp('started_at').notNull(),
  endedAt: timestamp('ended_at'),
  offsetMs: integer('offset_ms'),                        // ms since recording start (for video markers)
}, (t) => [
  uniqueIndex('interview_turns_seq_idx').on(t.interviewId, t.seq),
]);
```

## 6. `interview_responses` (new): scored Q&A

```js
export const interviewResponses = pgTable('interview_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  interviewId: uuid('interview_id').references(() => interviews.id, { onDelete: 'cascade' }).notNull(),
  questionId: uuid('question_id').references(() => interviewQuestions.id, { onDelete: 'set null' }), // base question
  questionText: text('question_text').notNull(),
  answer: text('answer').notNull(),
  isFollowUp: boolean('is_follow_up').default(false).notNull(),
  followUpDepth: integer('follow_up_depth').default(0).notNull(),
  followUpReason: varchar('follow_up_reason', { length: 30 }),
  score: integer('score'),
  scoreReasoning: text('score_reasoning'),
  keywordsCovered: json('keywords_covered').default([]),
  keywordsMissed: json('keywords_missed').default([]),
  scoredAt: timestamp('scored_at'),
  answeredAt: timestamp('answered_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('interview_responses_interview_idx').on(t.interviewId),
]);
```

## 7. Migration `drizzle/0009_ai_hiring.sql`

```sql
-- AI Hiring Pipeline: screening, interview questions, interviews, transcript, responses
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "hiring_config" json;
--> statement-breakpoint
ALTER TABLE "candidates" ALTER COLUMN "status" TYPE varchar(30);
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "resume_key" text;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "fit_score" integer;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "fit_analysis" json;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "screened_at" timestamp;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "final_score" integer;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "final_analysis" json;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "final_decided_at" timestamp;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "decided_by" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "interview_questions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL CONSTRAINT "interview_questions_user_id_users_id_fk" REFERENCES "users"("id") ON DELETE cascade,
  "job_id" uuid NOT NULL CONSTRAINT "interview_questions_job_id_jobs_id_fk" REFERENCES "jobs"("id") ON DELETE cascade,
  "candidate_id" uuid CONSTRAINT "interview_questions_candidate_id_candidates_id_fk" REFERENCES "candidates"("id") ON DELETE cascade,
  "question" text NOT NULL,
  "category" varchar(20) DEFAULT 'technical' NOT NULL,
  "difficulty" varchar(10) DEFAULT 'medium' NOT NULL,
  "ideal_answer" text NOT NULL,
  "expected_keywords" json DEFAULT '[]'::json,
  "score_weight" integer DEFAULT 1 NOT NULL,
  "order_index" integer DEFAULT 0 NOT NULL,
  "source" varchar(10) DEFAULT 'ai' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "interview_questions_job_idx" ON "interview_questions" ("job_id","is_active");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "interviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL CONSTRAINT "interviews_user_id_users_id_fk" REFERENCES "users"("id") ON DELETE cascade,
  "job_id" uuid NOT NULL CONSTRAINT "interviews_job_id_jobs_id_fk" REFERENCES "jobs"("id") ON DELETE cascade,
  "candidate_id" uuid NOT NULL CONSTRAINT "interviews_candidate_id_candidates_id_fk" REFERENCES "candidates"("id") ON DELETE cascade,
  "status" varchar(20) DEFAULT 'invited' NOT NULL,
  "token_hash" text NOT NULL CONSTRAINT "interviews_token_hash_unique" UNIQUE,
  "expires_at" timestamp NOT NULL,
  "invited_at" timestamp DEFAULT now() NOT NULL,
  "reminder_sent_at" timestamp,
  "opened_at" timestamp,
  "consent_at" timestamp,
  "started_at" timestamp,
  "ended_at" timestamp,
  "last_activity_at" timestamp,
  "duration_sec" integer,
  "question_snapshot" json,
  "state" json,
  "client_info" json,
  "integrity_events" json DEFAULT '[]'::json,
  "recording_audio_key" text,
  "recording_video_key" text,
  "recording_status" varchar(20) DEFAULT 'none',
  "total_questions" integer,
  "total_answers" integer,
  "follow_up_count" integer,
  "interview_score" integer,
  "communication_score" integer,
  "analysis" json,
  "analysis_status" varchar(20) DEFAULT 'pending',
  "error_message" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "interviews_candidate_idx" ON "interviews" ("candidate_id");
CREATE INDEX IF NOT EXISTS "interviews_job_status_idx" ON "interviews" ("job_id","status");
CREATE INDEX IF NOT EXISTS "interviews_user_status_idx" ON "interviews" ("user_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "interview_turns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "interview_id" uuid NOT NULL CONSTRAINT "interview_turns_interview_id_interviews_id_fk" REFERENCES "interviews"("id") ON DELETE cascade,
  "seq" integer NOT NULL,
  "speaker" varchar(10) NOT NULL,
  "kind" varchar(15) NOT NULL,
  "question_id" text,
  "text" text NOT NULL,
  "started_at" timestamp NOT NULL,
  "ended_at" timestamp,
  "offset_ms" integer
);
CREATE UNIQUE INDEX IF NOT EXISTS "interview_turns_seq_idx" ON "interview_turns" ("interview_id","seq");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "interview_responses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "interview_id" uuid NOT NULL CONSTRAINT "interview_responses_interview_id_interviews_id_fk" REFERENCES "interviews"("id") ON DELETE cascade,
  "question_id" uuid CONSTRAINT "interview_responses_question_id_interview_questions_id_fk" REFERENCES "interview_questions"("id") ON DELETE set null,
  "question_text" text NOT NULL,
  "answer" text NOT NULL,
  "is_follow_up" boolean DEFAULT false NOT NULL,
  "follow_up_depth" integer DEFAULT 0 NOT NULL,
  "follow_up_reason" varchar(30),
  "score" integer,
  "score_reasoning" text,
  "keywords_covered" json DEFAULT '[]'::json,
  "keywords_missed" json DEFAULT '[]'::json,
  "scored_at" timestamp,
  "answered_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "interview_responses_interview_idx" ON "interview_responses" ("interview_id");
```
Constraints are named the way Drizzle names them (`<table>_<column>_<ref>_id_fk`, `interviews_token_hash_unique`), so a later `npm run db:push` sees no difference.

Apply: `psql "$DATABASE_URL" -f drizzle/0009_ai_hiring.sql`. Verify with `npm run db:studio`.

## 7b. Migration `drizzle/0011_supervised_agent.sql` (Phase 8)

- `agent_runs`: `job_id` (the job a recruiter agent manages, FK `jobs`, `ON DELETE set null`), `config` (json snapshot at launch); index `(job_id, status)`.
- New table `agent_actions`: the supervised agent's approval inbox and audit trail — `agent_run_id`, `user_id`, `job_id`, `candidate_id`, `action`, `route` (`auto | ask | human`), `status` (`pending | approved | rejected | executed | failed | superseded`), `blocking`, `summary`, `payload`, `evidence`, `escalations`, `result`, `dedupe_key`, `decided_by`, `decided_at`, `decision_note`, `executed_at`. Indexes on `(agent_run_id, created_at)`, `(user_id, status)`, `(dedupe_key)`.
- Recruiter rows in `agent_configs` / `agent_runs`: mode `semi_auto` → `assisted`, `full_auto` → `autopilot`.

Idempotent (`IF NOT EXISTS`); apply it the same way as `0009`.

## 7c. Migration `drizzle/0012_job_publications.sql` (publishing)

New table `job_publications`: one row per attempt to put a job post on a platform — `job_id`, `user_id`, `platform` (`linkedin | rozee`), `account_id`, `mode` (`auto | handoff`), `status` (`publishing | published | failed | needs_login | handed_off`), `initiated_by` (`user | agent`), `content`, `post_url`, `error`, timestamps. It is the audit trail, the counter behind the posting limits, and (partial unique index `job_publications_one_inflight` on `(job_id, platform) WHERE status = 'publishing'`) the guard against two posts of the same job at once. See 19.

Idempotent (`IF NOT EXISTS`); apply it the same way as `0009`.

## 7d. Migration `drizzle/0013_hiring_indexes.sql` (speed)

Indexes only, no data changes: `jobs (user_id, created_at)`, `candidates (job_id, status)` and `(user_id, applied_at)`, `agent_runs (user_id, created_at)`, `agent_steps (agent_run_id, step_index)`. Postgres does not index foreign keys by itself, and these are the columns the pipeline, the job counts, the candidate lists and the worker filter on. Idempotent (`IF NOT EXISTS`); defined in `libs/schema.js` and `libs/schema.ts` too. See 21.

## 8. `libs/hiring/statuses.js`

```js
export const CANDIDATE_STATUS = {
  NEW: 'new', SCREENED: 'screened', REVIEWED: 'reviewed',
  SHORTLISTED: 'shortlisted', NOT_SHORTLISTED: 'not_shortlisted',
  INTERVIEW_INVITED: 'interview_invited', INTERVIEW_EXPIRED: 'interview_expired',
  INTERVIEW_IN_PROGRESS: 'interview_in_progress', INTERVIEW_COMPLETED: 'interview_completed',
  FINAL_SHORTLISTED: 'final_shortlisted', FINAL_REJECTED: 'final_rejected',
  HIRED: 'hired', REJECTED: 'rejected',
};
export const STATUS_META = {
  new:                   { label: 'New',                 badge: 'badge-ghost',     stage: 'applied' },
  screened:              { label: 'Screened',            badge: 'badge-info',      stage: 'applied' },
  reviewed:              { label: 'Reviewed',            badge: 'badge-info',      stage: 'applied' },
  shortlisted:           { label: 'Shortlisted',         badge: 'badge-primary',   stage: 'shortlisted' },
  not_shortlisted:       { label: 'Not shortlisted',     badge: 'badge-neutral',   stage: 'closed' },
  interview_invited:     { label: 'Interview invited',   badge: 'badge-secondary', stage: 'interview' },
  interview_expired:     { label: 'Invite expired',      badge: 'badge-warning',   stage: 'interview' },
  interview_in_progress: { label: 'Interviewing',        badge: 'badge-accent',    stage: 'interview' },
  interview_completed:   { label: 'Interviewed',         badge: 'badge-accent',    stage: 'evaluation' },
  final_shortlisted:     { label: 'Final shortlist',     badge: 'badge-success',   stage: 'decision' },
  final_rejected:        { label: 'Not selected',        badge: 'badge-error',     stage: 'decision' },
  hired:                 { label: 'Hired',               badge: 'badge-success',   stage: 'decision' },
  rejected:              { label: 'Rejected',            badge: 'badge-error',     stage: 'closed' },
};
export const KANBAN_STAGES = [
  { value: 'applied', label: 'Applied' }, { value: 'shortlisted', label: 'Shortlisted' },
  { value: 'interview', label: 'Interview' }, { value: 'evaluation', label: 'Evaluation' },
  { value: 'decision', label: 'Decision' }, { value: 'closed', label: 'Closed' },
];
export const MANUAL_TRANSITIONS = {
  new: ['shortlisted', 'not_shortlisted', 'rejected'],
  screened: ['shortlisted', 'not_shortlisted', 'rejected'],
  reviewed: ['shortlisted', 'not_shortlisted', 'rejected'],
  not_shortlisted: ['shortlisted', 'rejected'],
  shortlisted: ['not_shortlisted', 'rejected'],
  interview_invited: ['rejected'],
  interview_expired: ['rejected'],               // re-invite via API, not PATCH
  interview_in_progress: [],
  interview_completed: ['final_shortlisted', 'final_rejected', 'rejected'],
  final_shortlisted: ['hired', 'final_rejected', 'rejected'],
  final_rejected: ['final_shortlisted', 'rejected'],
  hired: [], rejected: ['shortlisted'],
};
export const ALL_STATUSES = Object.keys(STATUS_META);
export function canTransition(from, to) { return (MANUAL_TRANSITIONS[from] || []).includes(to); }
```
The existing PATCH route must validate with `canTransition`. The Kanban groups candidates by `STATUS_META[status].stage`. A drag between stages offers only the allowed target statuses.
