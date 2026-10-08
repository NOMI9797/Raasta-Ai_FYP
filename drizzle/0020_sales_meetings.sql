-- Sales meetings: times the agent offered and calls leads agreed to. Plus per-user sales settings
-- (working hours for meetings, meeting link, follow-up timing, company name for the agent).
CREATE TABLE IF NOT EXISTS "sales_settings" (
  "user_id" text PRIMARY KEY NOT NULL CONSTRAINT "sales_settings_user_id_users_id_fk" REFERENCES "users"("id") ON DELETE cascade,
  "company_name" text,
  "timezone" varchar(60) DEFAULT 'Asia/Karachi' NOT NULL,
  "availability" json,
  "meeting_minutes" integer DEFAULT 30 NOT NULL,
  "buffer_minutes" integer DEFAULT 15 NOT NULL,
  "min_notice_hours" integer DEFAULT 24 NOT NULL,
  "meeting_title" text,
  "meeting_link" text,
  "follow_up_days" json,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "meetings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL CONSTRAINT "meetings_user_id_users_id_fk" REFERENCES "users"("id") ON DELETE cascade,
  "lead_id" uuid NOT NULL CONSTRAINT "meetings_lead_id_leads_id_fk" REFERENCES "leads"("id") ON DELETE cascade,
  "campaign_id" uuid NOT NULL CONSTRAINT "meetings_campaign_id_campaigns_id_fk" REFERENCES "campaigns"("id") ON DELETE cascade,
  "status" varchar(20) NOT NULL,
  "title" text NOT NULL,
  "start_at" timestamp,
  "end_at" timestamp,
  "timezone" varchar(60) NOT NULL,
  "proposed_slots" json,
  "attendee_name" text,
  "attendee_email" text,
  "location" text,
  "notes" text,
  "outcome" text,
  "booked_by" varchar(10) DEFAULT 'agent' NOT NULL,
  "conversation_message_id" uuid CONSTRAINT "meetings_conversation_message_id_fk" REFERENCES "conversation_messages"("id") ON DELETE set null,
  "ics_uid" text,
  "ics_sequence" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "meetings_user_start_idx" ON "meetings" ("user_id","start_at");
CREATE INDEX IF NOT EXISTS "meetings_lead_idx" ON "meetings" ("lead_id","created_at");
