-- AI Hiring Pipeline: candidate AI evaluation, extended stages, activity timeline.
-- Also creates tables/columns that libs/schema.ts already defines but no earlier
-- migration created (agent_* tables, workflow_jobs pause columns).
-- Idempotent: safe to run more than once, and safe on a database that was synced
-- with `npm run db:push`.

-- ─── workflow_jobs pause/resume tracking (used by /api/jobs/[jobId]/pause|resume) ───
ALTER TABLE "workflow_jobs" ADD COLUMN IF NOT EXISTS "paused_at"   timestamp;
ALTER TABLE "workflow_jobs" ADD COLUMN IF NOT EXISTS "resumed_at"  timestamp;
ALTER TABLE "workflow_jobs" ADD COLUMN IF NOT EXISTS "pause_count" integer DEFAULT 0;

-- ─── Agent tables (recruiter / sales operator pipelines) ───
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "pipeline_type" varchar(30) NOT NULL,
  "name" text NOT NULL,
  "mode" varchar(20) DEFAULT 'semi_auto' NOT NULL,
  "config" json NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_config_id" uuid,
  "user_id" text NOT NULL,
  "pipeline_type" varchar(30) NOT NULL,
  "mode" varchar(20) NOT NULL,
  "status" varchar(30) DEFAULT 'queued' NOT NULL,
  "current_step" varchar(50),
  "total_steps" integer,
  "results" json,
  "error_message" text,
  "started_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_run_id" uuid NOT NULL,
  "step_key" varchar(50) NOT NULL,
  "step_index" integer NOT NULL,
  "status" varchar(30) DEFAULT 'pending' NOT NULL,
  "input" json,
  "output" json,
  "started_at" timestamp,
  "completed_at" timestamp
);

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_config_id_agent_configs_id_fk"
    FOREIGN KEY ("agent_config_id") REFERENCES "public"."agent_configs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_agent_run_id_agent_runs_id_fk"
    FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── Candidate AI evaluation ───
-- status now also allows: interview | offer | hired (see libs/hiring/stages.js)
--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "match_score"   integer;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "ai_evaluation" json;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "evaluated_at"  timestamp;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidates_job_id_idx" ON "candidates" USING btree ("job_id");

-- ─── Candidate activity timeline ───
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candidate_activities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "candidate_id" uuid NOT NULL,
  "job_id" uuid NOT NULL,
  "actor_id" text,
  "type" varchar(30) NOT NULL,
  "from_status" varchar(20),
  "to_status" varchar(20),
  "message" text,
  "metadata" json,
  "created_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_activities" ADD CONSTRAINT "candidate_activities_candidate_id_candidates_id_fk"
    FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_activities" ADD CONSTRAINT "candidate_activities_job_id_jobs_id_fk"
    FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate_activities" ADD CONSTRAINT "candidate_activities_actor_id_users_id_fk"
    FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_activities_candidate_id_idx"
  ON "candidate_activities" USING btree ("candidate_id", "created_at");

-- Backfill an "applied" entry for candidates that existed before the timeline
--> statement-breakpoint
INSERT INTO "candidate_activities" ("candidate_id", "job_id", "type", "to_status", "message", "metadata", "created_at")
SELECT c."id", c."job_id", 'applied', 'new', 'Applied via ' || c."source", json_build_object('source', c."source"), c."applied_at"
FROM "candidates" c
WHERE NOT EXISTS (
  SELECT 1 FROM "candidate_activities" a
  WHERE a."candidate_id" = c."id" AND a."type" = 'applied'
);
