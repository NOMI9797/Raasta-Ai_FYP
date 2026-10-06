"use client";

import SalesStageShell from "@/components/sales/SalesStageShell";
import SalesCampaignsList from "@/components/sales/campaigns/SalesCampaignsList";

// Step 1: every campaign with its numbers. Opening one continues where it makes sense:
// an empty campaign needs leads, one with leads goes on to research.
export default function SalesCampaignsPage() {
  return (
    <SalesStageShell stageKey="campaigns" requireCampaign={false}>
      {() => <SalesCampaignsList />}
    </SalesStageShell>
  );
}
