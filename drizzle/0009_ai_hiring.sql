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
