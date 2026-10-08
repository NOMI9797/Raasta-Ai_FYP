-- Sales messages can go out by LinkedIn or by email, and are approved before sending.
-- status gains 'approved' (draft -> approved -> sent); the column is varchar, so no change is needed for it.
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "channel" varchar(20) DEFAULT 'linkedin' NOT NULL;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "subject" text;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "recipient" text;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;
