-- Where each job post has been published, per platform (docs/ai-hiring/17-platform-publishing.md).
-- One row per attempt: automatic posts through a connected account, and hand-offs where the recruiter
-- posts it themselves. It is also the guard for posting limits and for "never post the same job twice at once".
CREATE TABLE IF NOT EXISTS "job_publications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL CONSTRAINT "job_publications_job_id_jobs_id_fk" REFERENCES "jobs"("id") ON DELETE cascade,
  "user_id" text NOT NULL CONSTRAINT "job_publications_user_id_users_id_fk" REFERENCES "users"("id") ON DELETE cascade,
  "platform" varchar(20) NOT NULL,
  "account_id" uuid,
  "mode" varchar(10) NOT NULL,
  "status" varchar(20) NOT NULL,
  "initiated_by" varchar(10) DEFAULT 'user' NOT NULL,
  "content" text,
  "post_url" text,
  "error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_publications_job_idx" ON "job_publications" ("job_id","platform","created_at");
CREATE INDEX IF NOT EXISTS "job_publications_account_idx" ON "job_publications" ("account_id","created_at");
-- at most one attempt in flight per job and platform
CREATE UNIQUE INDEX IF NOT EXISTS "job_publications_one_inflight" ON "job_publications" ("job_id","platform") WHERE "status" = 'publishing';
