-- Indeed publishing (docs/ai-hiring/19-platform-publishing.md): the Indeed employer session used to post jobs,
-- and the per-job Indeed post columns. Mirrors the Rozee.pk columns. Safe to run more than once.

CREATE TABLE IF NOT EXISTS "indeed_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "session_id" text NOT NULL UNIQUE,
  "email" text NOT NULL,
  "user_name" text,
  "profile_image_url" text,
  "cookies" json NOT NULL,
  "local_storage" json,
  "session_storage" json,
  "is_active" boolean DEFAULT false NOT NULL,
  "tags" json DEFAULT '[]'::json,
  "last_used" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "indeed_accounts" ADD CONSTRAINT "indeed_accounts_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "indeed_account_id"   uuid;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "indeed_post"         text;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "indeed_post_url"     text;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "indeed_published_at" timestamp;

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "jobs" ADD CONSTRAINT "jobs_indeed_account_id_indeed_accounts_id_fk"
    FOREIGN KEY ("indeed_account_id") REFERENCES "public"."indeed_accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
