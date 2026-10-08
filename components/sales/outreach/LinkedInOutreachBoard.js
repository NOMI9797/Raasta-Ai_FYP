"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";

const COLUMNS = [
  { value: "pending", label: "Not invited", accent: "border-base-content/30", match: (l) => !l.inviteSent },
  {
    value: "sent",
    label: "Invite sent",
    accent: "border-info",
    match: (l) => l.inviteSent && !["accepted", "failed", "rejected"].includes(l.inviteStatus),
  },
  { value: "accepted", label: "Connected", accent: "border-success", match: (l) => l.inviteStatus === "accepted" && !l.messageSent },
  { value: "messaged", label: "Message sent", accent: "border-primary", match: (l) => l.inviteStatus === "accepted" && l.messageSent },
  { value: "failed", label: "Failed / declined", accent: "border-error", match: (l) => ["failed", "rejected"].includes(l.inviteStatus) },
];

/** Where each LinkedIn lead of the campaign is: invite → connected → messaged. */
export default function LinkedInOutreachBoard({ campaignId }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/campaigns/${campaignId}/leads`)
      .then((r) => r.json())
      .then((data) => !cancelled && setLeads((data.leads || []).filter((l) => (l.source || "linkedin") === "linkedin")))
      .catch(() => !cancelled && setLeads([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const byColumn = useMemo(() => {
    const grouped = Object.fromEntries(COLUMNS.map((c) => [c.value, []]));
    for (const lead of leads) {
      const column = COLUMNS.find((c) => c.match(lead));
      if (column) grouped[column.value].push(lead);
    }
    return grouped;
  }, [leads]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      {COLUMNS.map((column) => (
        <div key={column.value} className={`card bg-base-200 border-t-4 ${column.accent} border-base-300 flex flex-col max-h-[60vh]`}>
          <div className="p-3 border-b border-base-300 flex items-center justify-between">
            <h3 className="font-semibold text-sm">{column.label}</h3>
            <span className="badge badge-ghost badge-sm">{byColumn[column.value].length}</span>
          </div>
          <div className="p-2 space-y-2 flex-1 overflow-y-auto">
            {byColumn[column.value].length === 0 ? (
              <p className="text-xs text-base-content/40 text-center py-4">Nobody here</p>
            ) : (
              byColumn[column.value].map((lead) => (
                <a
                  key={lead.id}
                  href={lead.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block bg-base-100 rounded-lg border border-base-300 p-3 hover:border-primary/40"
                >
                  <div className="font-medium text-sm truncate flex items-center gap-1">
                    {lead.name || "Not read yet"} <ExternalLink className="h-3 w-3 opacity-40" />
                  </div>
                  {lead.title && <div className="text-xs text-base-content/60 truncate">{lead.title}</div>}
                </a>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
