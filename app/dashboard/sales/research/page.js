"use client";

import SalesStageShell from "@/components/sales/SalesStageShell";
import CompanyResearch from "@/components/sales/research/CompanyResearch";
import CampaignWorkspace from "@/app/dashboard/campaigns/components/CampaignWorkspace";

// Step 3: learn about each lead. LinkedIn: read the profile and recent posts. Companies: who they are and who to contact.
export default function ResearchPage() {
  return (
    <SalesStageShell stageKey="research">
      {({ campaign, platform }) =>
        platform === "linkedin" ? (
          <div className="h-[75vh] min-h-[32rem] rounded-xl border border-base-300 overflow-hidden">
            <CampaignWorkspace key={campaign.id} campaign={campaign} sourceFilter="linkedin" />
          </div>
        ) : (
          <CompanyResearch key={`${campaign.id}-${platform}`} campaignId={campaign.id} platform={platform} />
        )
      }
    </SalesStageShell>
  );
}
