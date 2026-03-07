-- Add message tracking fields to leads table
ALTER TABLE "leads" ADD COLUMN "message_sent" boolean DEFAULT false NOT NULL;
ALTER TABLE "leads" ADD COLUMN "message_sent_at" timestamp;
ALTER TABLE "leads" ADD COLUMN "message_error" text;

-- Add message sending rate limiting to linkedin_accounts table
ALTER TABLE "linkedin_accounts" ADD COLUMN "daily_messages_sent" integer DEFAULT 0 NOT NULL;
ALTER TABLE "linkedin_accounts" ADD COLUMN "daily_message_limit" integer DEFAULT 10 NOT NULL;
ALTER TABLE "linkedin_accounts" ADD COLUMN "last_message_reset" timestamp DEFAULT now() NOT NULL;

