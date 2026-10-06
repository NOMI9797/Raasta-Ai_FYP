"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { PLATFORM_KIND } from "@/libs/sales/stages";
import { PLATFORM_META } from "@/libs/platforms/meta";

/** Leads of one platform in a campaign. People (LinkedIn) and companies (Rozee.pk, Indeed) get their own columns. */
export default function CampaignLeadsTable({ campaignId, platform, refreshKey = 0, heading }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const isCompany = PLATFORM_KIND[platform] === "company";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/campaigns/${campaignId}/leads`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const rows = (data.leads || []).filter((l) => (l.source || "linkedin") === platform);
        setLeads(rows.reverse());
      })
      .catch(() => !cancelled && setLeads([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [campaignId, platform, refreshKey]);

  const label = PLATFORM_META[platform]?.label || platform;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">
        {heading || `${isCompany ? "Companies" : "People"} from ${label} in this campaign`}
        {!loading && <span className="badge badge-ghost badge-sm ml-2">{leads.length}</span>}
      </h2>
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : leads.length === 0 ? (
        <p className="text-sm text-base-content/60 rounded-lg border border-dashed border-base-300 p-6 text-center">
          None yet. Add some above.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-base-300 bg-base-100 max-h-[28rem]">
          <table className="table table-sm">
            <thead>
              {isCompany ? (
                <tr>
                  <th>Company</th>
                  <th>Hiring for</th>
                  <th>Location</th>
                  <th>About</th>
                  <th className="w-10"></th>
                </tr>
              ) : (
                <tr>
                  <th>Name</th>
                  <th>Title</th>
                  <th>Company</th>
                  <th>Profile read</th>
                  <th className="w-10"></th>
                </tr>
              )}
            </thead>
            <tbody>
              {leads.map((lead) => {
                const company = lead.sourceData?.company;
                return isCompany ? (
                  <tr key={lead.id}>
                    <td className="font-medium">{lead.company || lead.name || "Unknown company"}</td>
                    <td>{lead.title || "—"}</td>
                    <td className="text-base-content/70">{lead.sourceData?.location || "—"}</td>
                    <td className="text-xs text-base-content/60">
                      {[company?.industry, company?.employees && `${company.employees} staff`].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td>
                      <a href={lead.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-xs" title="Open job post">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                ) : (
                  <tr key={lead.id}>
                    <td className="font-medium">{lead.name || "Not read yet"}</td>
                    <td>{lead.title || "—"}</td>
                    <td>{lead.company || "—"}</td>
                    <td>
                      <span className={`badge badge-sm ${lead.status === "completed" ? "badge-success" : lead.status === "error" ? "badge-error" : "badge-ghost"}`}>
                        {lead.status === "completed" ? "Done" : lead.status === "error" ? "Failed" : "Waiting"}
                      </span>
                    </td>
                    <td>
                      <a href={lead.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-xs" title="Open profile">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
