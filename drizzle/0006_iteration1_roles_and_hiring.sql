-- Iteration 1: User roles and Hiring module (jobs + candidates)
-- Role: admin | sales_operator | recruiter — controls route access and workflows
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" varchar(20) NOT NULL DEFAULT 'sales_operator';

-- ICP config for campaigns: { targetRole, industry, serviceType }
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "icp_config" json;

-- Jobs table (Recruiter module)
CREATE TABLE "jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "linkedin_account_id" uuid,
  "title" text NOT NULL,
  "required_skills" json,
  "experience_range" varchar(50),
  "tech_stack" json,
  "salary_min" integer,
  "salary_max" integer,
  "salary_currency" varchar(10) DEFAULT 'USD',
  "location" text,
  "location_type" varchar(20),
  "employment_type" varchar(20),
  "linkedin_post" text,
  "formal_description" text,
  "linkedin_post_url" text,
  "status" varchar(20) NOT NULL DEFAULT 'draft',
  "published_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_linkedin_account_id_linkedin_accounts_id_fk" FOREIGN KEY ("linkedin_account_id") REFERENCES "public"."linkedin_accounts"("id") ON DELETE set null ON UPDATE no action;

-- Candidates table (Recruiter module)
--> statement-breakpoint
CREATE TABLE "candidates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "linkedin_url" text,
  "cover_note" text,
  "resume_url" text,
  "parsed_data" json,
  "status" varchar(20) NOT NULL DEFAULT 'new',
  "applied_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
