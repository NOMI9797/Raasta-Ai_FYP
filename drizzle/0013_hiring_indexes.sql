-- Indexes for the screens and the worker that read hiring data all day (docs/ai-hiring/21-performance.md).
-- Postgres does not index foreign keys by itself, so these reads were scanning whole tables. Indexes only:
-- no data changes, safe to run more than once.
CREATE INDEX IF NOT EXISTS "jobs_user_created_idx" ON "jobs" ("user_id","created_at");
CREATE INDEX IF NOT EXISTS "candidates_job_status_idx" ON "candidates" ("job_id","status");
CREATE INDEX IF NOT EXISTS "candidates_user_applied_idx" ON "candidates" ("user_id","applied_at");
CREATE INDEX IF NOT EXISTS "agent_runs_user_created_idx" ON "agent_runs" ("user_id","created_at");
CREATE INDEX IF NOT EXISTS "agent_steps_run_idx" ON "agent_steps" ("agent_run_id","step_index");
