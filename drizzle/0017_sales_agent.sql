-- Sales agent: runs work a campaign, and their approval requests point at a lead.
ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "campaign_id" uuid CONSTRAINT "agent_runs_campaign_id_campaigns_id_fk" REFERENCES "campaigns"("id") ON DELETE set null;
CREATE INDEX IF NOT EXISTS "agent_runs_campaign_status_idx" ON "agent_runs" ("campaign_id","status");

ALTER TABLE "agent_actions" ADD COLUMN IF NOT EXISTS "campaign_id" uuid CONSTRAINT "agent_actions_campaign_id_campaigns_id_fk" REFERENCES "campaigns"("id") ON DELETE cascade;
ALTER TABLE "agent_actions" ADD COLUMN IF NOT EXISTS "lead_id" uuid CONSTRAINT "agent_actions_lead_id_leads_id_fk" REFERENCES "leads"("id") ON DELETE cascade;
CREATE INDEX IF NOT EXISTS "agent_actions_campaign_status_idx" ON "agent_actions" ("campaign_id","status");
