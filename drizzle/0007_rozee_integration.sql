-- Iteration: Rozee.pk integration
-- Adds rozee_accounts table and source/sourceData columns to leads, candidates, messages
-- Adds Rozee publishing columns to jobs

-- ─── Rozee Accounts table ───
CREATE TABLE IF NOT EXISTS "rozee_accounts" (
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
  "daily_invites_sent" integer DEFAULT 0 NOT NULL,
  "daily_limit" integer DEFAULT 20 NOT NULL,
  "last_daily_reset" timestamp DEFAULT now() NOT NULL,
  "daily_messages_sent" integer DEFAULT 0 NOT NULL,
  "daily_message_limit" integer DEFAULT 15 NOT NULL,
  "last_message_reset" timestamp DEFAULT now() NOT NULL,
  "last_used" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "rozee_accounts" ADD CONSTRAINT "rozee_accounts_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── Source columns on shared tables (default 'linkedin' for back-compat) ───
ALTER TABLE "leads"      ADD COLUMN IF NOT EXISTS "source"      varchar(20) NOT NULL DEFAULT 'linkedin';
ALTER TABLE "leads"      ADD COLUMN IF NOT EXISTS "source_data" json;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "source"      varchar(20) NOT NULL DEFAULT 'linkedin';
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "source_data" json;
ALTER TABLE "messages"   ADD COLUMN IF NOT EXISTS "source"      varchar(20) NOT NULL DEFAULT 'linkedin';

-- ─── Sources column on campaigns (multi-platform targeting) ───
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "sources" json DEFAULT '["linkedin"]'::json;

-- ─── Rozee publishing columns on jobs ───
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "rozee_account_id"   uuid;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "rozee_post"         text;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "rozee_post_url"     text;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "rozee_published_at" timestamp;

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "jobs" ADD CONSTRAINT "jobs_rozee_account_id_rozee_accounts_id_fk"
    FOREIGN KEY ("rozee_account_id") REFERENCES "public"."rozee_accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
