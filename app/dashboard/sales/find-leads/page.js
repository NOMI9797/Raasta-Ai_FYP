"use client";

import { useState } from "react";
import SalesStageShell from "@/components/sales/SalesStageShell";
import CampaignLeadsTable from "@/components/sales/CampaignLeadsTable";
import LinkedInImport from "@/components/sales/find/LinkedInImport";
import JobBoardSearch from "@/components/sales/find/JobBoardSearch";

// Step 2: get leads into the campaign. LinkedIn = people you add; Rozee.pk / Indeed = companies that are hiring.
export default function FindLeadsPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <SalesStageShell stageKey="find">
      {({ campaign, platform }) => (
        <div className="space-y-6">
          {platform === "linkedin" ? (
            <LinkedInImport campaignId={campaign.id} onImported={refresh} />
          ) : (
            <JobBoardSearch key={platform} platform={platform} campaignId={campaign.id} onImported={refresh} />
          )}
          <CampaignLeadsTable campaignId={campaign.id} platform={platform} refreshKey={refreshKey} />
        </div>
      )}
    </SalesStageShell>
  );
}
