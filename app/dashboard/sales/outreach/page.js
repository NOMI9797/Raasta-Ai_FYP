"use client";

import Link from "next/link";
import SalesStageShell from "@/components/sales/SalesStageShell";
import LinkedInOutreachBoard from "@/components/sales/outreach/LinkedInOutreachBoard";
import CompanyOutreachBoard from "@/components/sales/outreach/CompanyOutreachBoard";
import { stageHref } from "@/libs/sales/stages";

// Step 5: reach out and track it. LinkedIn: invite → connected → message. Companies: send the approved emails and follow each one.
export default function OutreachPage() {
  return (
    <SalesStageShell stageKey="outreach">
      {({ campaign, platform }) =>
        platform === "linkedin" ? (
          <div className="space-y-4">
            <p className="text-sm text-base-content/70">
              Invites and messages are sent from{" "}
              <Link href={stageHref("research", { campaignId: campaign.id, platform: "linkedin" })} className="link link-primary">
                Research › LinkedIn
              </Link>{" "}
              for now, or by the Sales agent. This board shows where every lead is.
            </p>
            <LinkedInOutreachBoard key={campaign.id} campaignId={campaign.id} />
          </div>
        ) : (
          <CompanyOutreachBoard key={`${campaign.id}-${platform}`} campaignId={campaign.id} platform={platform} />
        )
      }
    </SalesStageShell>
  );
}
