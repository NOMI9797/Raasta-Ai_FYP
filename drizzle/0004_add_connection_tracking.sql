-- Add connection tracking fields to leads table
ALTER TABLE "leads" ADD COLUMN "invite_sent_at" timestamp;
ALTER TABLE "leads" ADD COLUMN "invite_accepted_at" timestamp;
ALTER TABLE "leads" ADD COLUMN "last_connection_check_at" timestamp;

-- Add connection check rate limiting to linkedin_accounts table
ALTER TABLE "linkedin_accounts" ADD COLUMN "daily_connection_checks" integer DEFAULT 0 NOT NULL;
ALTER TABLE "linkedin_accounts" ADD COLUMN "last_connection_check_reset" timestamp DEFAULT now() NOT NULL;

