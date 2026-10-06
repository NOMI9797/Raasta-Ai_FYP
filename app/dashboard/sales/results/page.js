"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import SalesStageShell from "@/components/sales/SalesStageShell";
import { PLATFORM_KIND } from "@/libs/sales/stages";

// How far leads got, per platform. Each bar is a share of the leads added.
const FUNNELS = {
  person: [
    { label: "Added", match: () => true },
    { label: "Profile read", match: (l) => l.status === "completed" },
    { label: "Invite sent", match: (l) => l.inviteSent },
    { label: "Connected", match: (l) => l.inviteStatus === "accepted" },
    { label: "Message sent", match: (l) => l.messageSent },
  ],
  company: [
    { label: "Added", match: () => true },
    { label: "Researched", match: (l) => Boolean(l.sourceData?.research || l.sourceData?.conversion) },
    { label: "Contacted", match: (l) => l.messageSent },
  ],
};

function Funnel({ campaignId, platform }) {
  const [leads, setLeads] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLeads(null);
    fetch(`/api/campaigns/${campaignId}/leads`)
      .then((r) => r.json())
      .then((data) => !cancelled && setLeads((data.leads || []).filter((l) => (l.source || "linkedin") === platform)))
      .catch(() => !cancelled && setLeads([]));
    return () => {
      cancelled = true;
    };
  }, [campaignId, platform]);

  if (!leads) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!leads.length) {
    return <p className="text-sm text-base-content/60 rounded-lg border border-dashed border-base-300 p-6 text-center">No leads from this platform yet.</p>;
  }

  const rows = FUNNELS[PLATFORM_KIND[platform]].map((stage) => ({ ...stage, count: leads.filter(stage.match).length }));
  return (
    <div className="rounded-xl border border-base-300 bg-base-100 p-4 space-y-3 max-w-2xl">
      {rows.map((row) => {
        const share = Math.round((row.count / leads.length) * 100);
        return (
          <div key={row.label} className="grid grid-cols-[8rem_1fr_5rem] items-center gap-3 text-sm">
            <span>{row.label}</span>
            <progress className="progress progress-primary w-full" value={share} max={100} aria-label={`${row.label}: ${share}%`} />
            <span className="text-right tabular-nums">
              {row.count} <span className="text-base-content/50">({share}%)</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Step 8: what worked.
export default function ResultsPage() {
  return (
    <SalesStageShell stageKey="results">
      {({ campaign, platform }) => <Funnel key={`${campaign.id}-${platform}`} campaignId={campaign.id} platform={platform} />}
    </SalesStageShell>
  );
}
