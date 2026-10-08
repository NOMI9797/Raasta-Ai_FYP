-- Posting engine runs (docs/ai-hiring/19-platform-publishing.md, section 5f): one row per run of the engine that fills a
-- platform's post form in a visible browser window and hands over to the recruiter at every check, sign-in and decision.
-- The web app inserts a queued run; the engine claims it and writes its progress here; the Publish panel reads it live.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS "posting_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL CONSTRAINT "posting_runs_job_id_jobs_id_fk" REFERENCES "jobs"("id") ON DELETE cascade,
  "user_id" text NOT NULL CONSTRAINT "posting_runs_user_id_users_id_fk" REFERENCES "users"("id") ON DELETE cascade,
  "platform" varchar(20) NOT NULL,
  "mode" varchar(12) NOT NULL,
  "status" varchar(20) DEFAULT 'queued' NOT NULL,
  "gate" json,
  "steps" json DEFAULT '[]'::json NOT NULL,
  "kit" json NOT NULL,
  "outcome" json,
  "cancel_requested" boolean DEFAULT false NOT NULL,
  "engine_id" text,
  "heartbeat_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "started_at" timestamp,
  "completed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "posting_runs_job_idx" ON "posting_runs" ("job_id","platform","created_at");
CREATE INDEX IF NOT EXISTS "posting_runs_queue_idx" ON "posting_runs" ("status","created_at");
-- at most one live run per job and platform
CREATE UNIQUE INDEX IF NOT EXISTS "posting_runs_one_live" ON "posting_runs" ("job_id","platform") WHERE "status" IN ('queued', 'running', 'needs_you', 'awaiting_confirm');
