"use client";

import SalesStageShell from "@/components/sales/SalesStageShell";
import CampaignLeadsTable from "@/components/sales/CampaignLeadsTable";
import StageNotReady from "@/components/sales/StageNotReady";
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
          <div className="space-y-6">
            <StageNotReady
              title="Company research is being rebuilt"
              points={[
                "Find each company's website, email and phone.",
                "Find a decision-maker (HR head, CEO) and their LinkedIn profile.",
                "Group job posts so each company is one lead with all its open roles.",
              ]}
            />
            <CampaignLeadsTable campaignId={campaign.id} platform={platform} />
          </div>
        )
      }
    </SalesStageShell>
  );
}
