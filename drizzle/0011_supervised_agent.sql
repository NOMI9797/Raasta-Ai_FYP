-- Supervised recruiter agent (docs/ai-hiring/13-workers-automation.md, agent section):
-- runs are tied to a job, and every agent action is recorded (approval inbox + audit trail)
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "job_id" uuid CONSTRAINT "agent_runs_job_id_jobs_id_fk" REFERENCES "jobs"("id") ON DELETE set null;
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "config" json;
CREATE INDEX IF NOT EXISTS "agent_runs_job_status_idx" ON "agent_runs" ("job_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_run_id" uuid NOT NULL CONSTRAINT "agent_actions_agent_run_id_agent_runs_id_fk" REFERENCES "agent_runs"("id") ON DELETE cascade,
  "user_id" text NOT NULL CONSTRAINT "agent_actions_user_id_users_id_fk" REFERENCES "users"("id") ON DELETE cascade,
  "job_id" uuid CONSTRAINT "agent_actions_job_id_jobs_id_fk" REFERENCES "jobs"("id") ON DELETE cascade,
  "candidate_id" uuid CONSTRAINT "agent_actions_candidate_id_candidates_id_fk" REFERENCES "candidates"("id") ON DELETE cascade,
  "action" varchar(40) NOT NULL,
  "route" varchar(10) NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "blocking" boolean DEFAULT false NOT NULL,
  "summary" text NOT NULL,
  "payload" json,
  "evidence" json,
  "escalations" json DEFAULT '[]'::json,
  "result" json,
  "dedupe_key" text,
  "decided_by" text,
  "decided_at" timestamp,
  "decision_note" text,
  "executed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_actions_run_idx" ON "agent_actions" ("agent_run_id","created_at");
CREATE INDEX IF NOT EXISTS "agent_actions_user_status_idx" ON "agent_actions" ("user_id","status");
CREATE INDEX IF NOT EXISTS "agent_actions_dedupe_idx" ON "agent_actions" ("dedupe_key");
--> statement-breakpoint
-- Recruiter agents use the new mode names; sales agents keep semi_auto / full_auto
UPDATE "agent_configs" SET "mode" = 'assisted' WHERE "pipeline_type" = 'recruiter' AND "mode" = 'semi_auto';
UPDATE "agent_configs" SET "mode" = 'autopilot' WHERE "pipeline_type" = 'recruiter' AND "mode" = 'full_auto';
UPDATE "agent_runs" SET "mode" = 'assisted' WHERE "pipeline_type" = 'recruiter' AND "mode" = 'semi_auto';
UPDATE "agent_runs" SET "mode" = 'autopilot' WHERE "pipeline_type" = 'recruiter' AND "mode" = 'full_auto';
