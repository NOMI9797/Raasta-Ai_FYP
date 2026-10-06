-- Sales conversations: every email in a lead's thread (our outreach, their replies, the agent's
-- answers and follow-ups), plus where each lead's conversation stands.
CREATE TABLE IF NOT EXISTS "conversation_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL CONSTRAINT "conversation_messages_user_id_users_id_fk" REFERENCES "users"("id") ON DELETE cascade,
  "lead_id" uuid NOT NULL CONSTRAINT "conversation_messages_lead_id_leads_id_fk" REFERENCES "leads"("id") ON DELETE cascade,
  "campaign_id" uuid NOT NULL CONSTRAINT "conversation_messages_campaign_id_campaigns_id_fk" REFERENCES "campaigns"("id") ON DELETE cascade,
  "direction" varchar(3) NOT NULL,
  "channel" varchar(20) DEFAULT 'email' NOT NULL,
  "kind" varchar(20) NOT NULL,
  "status" varchar(20) NOT NULL,
  "from_address" text,
  "to_address" text,
  "subject" text,
  "body" text NOT NULL,
  "email_message_id" text,
  "in_reply_to" text,
  "references" text,
  "intent" varchar(30),
  "meta" json,
  "handled_at" timestamp,
  "sent_at" timestamp,
  "received_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "conversation_messages_lead_idx" ON "conversation_messages" ("lead_id","created_at");
CREATE INDEX IF NOT EXISTS "conversation_messages_user_idx" ON "conversation_messages" ("user_id","created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_messages_email_id_unique" ON "conversation_messages" ("email_message_id") WHERE "email_message_id" IS NOT NULL;

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "conversation_status" varchar(20);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "last_reply_at" timestamp;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "follow_ups_sent" integer DEFAULT 0 NOT NULL;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "next_follow_up_at" timestamp;
CREATE INDEX IF NOT EXISTS "leads_conversation_idx" ON "leads" ("campaign_id","conversation_status");

-- Emails sent before this migration start their thread (no Message-ID was kept, so replies to
-- them are matched by subject)
INSERT INTO "conversation_messages" ("user_id","lead_id","campaign_id","direction","channel","kind","status","to_address","subject","body","sent_at","created_at","updated_at")
SELECT m."user_id", m."lead_id", m."campaign_id", 'out', 'email', 'outreach', 'sent', m."recipient", m."subject", m."content", coalesce(m."sent_at", m."updated_at"), coalesce(m."sent_at", m."updated_at"), now()
FROM "messages" m
WHERE m."channel" = 'email' AND m."status" = 'sent'
  AND NOT EXISTS (SELECT 1 FROM "conversation_messages" c WHERE c."lead_id" = m."lead_id" AND c."kind" = 'outreach');

UPDATE "leads" l SET "conversation_status" = 'awaiting_reply', "next_follow_up_at" = c."sent_at" + interval '3 days'
FROM "conversation_messages" c
WHERE c."lead_id" = l."id" AND c."kind" = 'outreach' AND l."conversation_status" IS NULL;
