"use client";

import { useRouter } from "next/navigation";
import SalesStageShell from "@/components/sales/SalesStageShell";
import CampaignsList from "@/app/dashboard/campaigns/components/CampaignsList";
import { stageHref } from "@/libs/sales/stages";

// Step 1: the list of campaigns. Opening one continues where it makes sense:
// an empty campaign needs leads, one with leads goes on to research.
export default function SalesCampaignsPage() {
  const router = useRouter();

  const openCampaign = (campaign) => {
    const hasLeads = Number(campaign.leadsCount) > 0;
    router.push(stageHref(hasLeads ? "research" : "find", { campaignId: campaign.id }));
  };

  return (
    <SalesStageShell stageKey="campaigns" requireCampaign={false}>
      {() => <CampaignsList onSelectCampaign={openCampaign} />}
    </SalesStageShell>
  );
}
