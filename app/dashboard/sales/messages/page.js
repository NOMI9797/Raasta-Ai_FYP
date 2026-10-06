"use client";

import SalesStageShell from "@/components/sales/SalesStageShell";
import StageNotReady from "@/components/sales/StageNotReady";
import { stageHref } from "@/libs/sales/stages";

// Step 4: an AI-written message per lead, reviewed and approved before anything is sent.
export default function MessagesPage() {
  return (
    <SalesStageShell stageKey="messages">
      {({ campaign, platform }) =>
        platform === "linkedin" ? (
          <StageNotReady
            title="A review screen for LinkedIn messages is being built"
            points={[
              "Every lead with its AI message side by side.",
              "Edit, regenerate or approve each one; only approved messages are sent.",
            ]}
            workaround={{
              text: "messages are written in the third column of Research › LinkedIn.",
              href: stageHref("research", { campaignId: campaign.id, platform: "linkedin" }),
              cta: "Open Research",
            }}
          />
        ) : (
          <StageNotReady
            title="Messages for companies are being built"
            points={[
              "An email to the company, written from its job posts and company details.",
              "A LinkedIn note for the decision-maker found in Research.",
              "Edit and approve before sending.",
            ]}
          />
        )
      }
    </SalesStageShell>
  );
}
