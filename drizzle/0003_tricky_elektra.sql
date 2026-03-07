ALTER TABLE "leads" ADD COLUMN "invite_sent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "invite_status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "invite_retry_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "linkedin_accounts" ADD COLUMN "daily_invites_sent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "linkedin_accounts" ADD COLUMN "daily_limit" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "linkedin_accounts" ADD COLUMN "last_daily_reset" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password" text;