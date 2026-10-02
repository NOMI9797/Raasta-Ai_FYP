-- In-app notifications (top bar bell)
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL CONSTRAINT "notifications_user_id_users_id_fk" REFERENCES "users"("id") ON DELETE cascade,
  "type" varchar(40) NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "link" text,
  "read_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_created_idx" ON "notifications" ("user_id","created_at");
