"use client";

import Link from "next/link";
import SalesStageShell from "@/components/sales/SalesStageShell";
import StageNotReady from "@/components/sales/StageNotReady";
import LinkedInOutreachBoard from "@/components/sales/outreach/LinkedInOutreachBoard";
import { stageHref } from "@/libs/sales/stages";

// Step 5: reach out and track it. LinkedIn: invite → connected → message. Companies: email or the decision-maker on LinkedIn.
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
          <StageNotReady
            title="Company outreach is being built"
            points={[
              "Email the company using the address found in Research.",
              "Or send the decision-maker into the LinkedIn invite and message flow.",
              "Track sent, opened and replied.",
            ]}
          />
        )
      }
    </SalesStageShell>
  );
}
