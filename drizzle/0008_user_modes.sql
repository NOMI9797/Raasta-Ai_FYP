-- Phase 1: add modes column for Two-Modes architecture (Recruiter / Sales)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "modes" json DEFAULT '[]'::json;

-- Backfill from existing role so current users keep working
UPDATE "users" SET "modes" = '["sales"]'::json
  WHERE (modes::text = '[]' OR modes IS NULL) AND "role" = 'sales_operator';

UPDATE "users" SET "modes" = '["recruiter"]'::json
  WHERE (modes::text = '[]' OR modes IS NULL) AND "role" = 'recruiter';

UPDATE "users" SET "modes" = '["recruiter","sales"]'::json
  WHERE (modes::text = '[]' OR modes IS NULL) AND "role" = 'admin';
