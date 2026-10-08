"use client";

import SalesStageShell from "@/components/sales/SalesStageShell";
import MessageReview from "@/components/sales/messages/MessageReview";

// Step 4: an AI-written message per lead, reviewed and approved before anything is sent.
export default function MessagesPage() {
  return (
    <SalesStageShell stageKey="messages">
      {({ campaign, platform }) => <MessageReview key={`${campaign.id}-${platform}`} campaignId={campaign.id} platform={platform} />}
    </SalesStageShell>
  );
}
