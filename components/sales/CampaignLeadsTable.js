"use client";

import { useEffect, useMemo, useState } from "react";
import { Briefcase, ExternalLink, Loader2, MapPin, Search, Users } from "lucide-react";
import CompanyLogo from "@/components/sales/CompanyLogo";
import { PLATFORM_KIND } from "@/libs/sales/stages";
import { PLATFORM_META } from "@/libs/platforms/meta";
import { leadStage } from "@/libs/sales/lead-stage";

/** Leads of one platform in a campaign. People (LinkedIn) and companies (Rozee.pk, Indeed) get their own columns. */
export default function CampaignLeadsTable({ campaignId, platform, refreshKey = 0, heading }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
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
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((l) => [l.company, l.name, l.title, l.sourceData?.location].some((v) => String(v || "").toLowerCase().includes(q)));
  }, [leads, query]);

  return (
    <section className="overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-sm">
      <header className="flex flex-wrap items-center gap-3 border-b border-base-300 px-4 py-3">
        <Users className="h-4 w-4 text-base-content/50" />
        <h2 className="text-sm font-semibold">{heading || `${isCompany ? "Companies" : "People"} from ${label} in this campaign`}</h2>
        {!loading && <span className="rounded-full bg-base-200 px-2 py-0.5 text-xs tabular-nums text-base-content/70">{leads.length}</span>}
        <span className="flex-1" />
        {leads.length > 5 && (
          <label className="input input-bordered input-sm flex w-full items-center gap-2 sm:w-64">
            <Search className="h-3.5 w-3.5 opacity-50" />
            <input className="grow" placeholder={isCompany ? "Search companies or roles" : "Search people"} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        )}
      </header>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : leads.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <Users className="mx-auto h-8 w-8 opacity-30" />
          <p className="mt-2 text-sm font-medium">No {isCompany ? "companies" : "people"} yet</p>
          <p className="text-xs text-base-content/55">{isCompany ? "Search above and add the companies that are hiring." : "Import a CSV or paste profile links above."}</p>
        </div>
      ) : (
        <div className="max-h-[30rem] overflow-auto">
          <table className="table table-sm">
            <thead className="sticky top-0 z-10 bg-base-100">
              <tr className="text-xs text-base-content/55">
                <th>{isCompany ? "Company" : "Person"}</th>
                <th>{isCompany ? "Hiring for" : "Title"}</th>
                <th>{isCompany ? "Location" : "Company"}</th>
                <th>Stage</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-sm text-base-content/50">No match.</td></tr>}
              {shown.map((lead) => {
                const company = lead.sourceData?.company || {};
                const jobs = lead.sourceData?.jobs || [];
                const name = isCompany ? lead.company || company.name : lead.name;
                const stage = leadStage(lead, isCompany);
                return (
                  <tr key={lead.id} className="hover">
                    <td>
                      <div className="flex items-center gap-3">
                        <CompanyLogo name={name} logo={isCompany ? company.logo : lead.profilePicture} size="h-8 w-8" />
                        <div className="min-w-0">
                          <p className={`truncate font-medium ${name ? "" : "italic text-base-content/50"}`}>{name || (isCompany ? "No company name" : "Not read yet")}</p>
                          <p className="truncate text-xs text-base-content/50">
                            {isCompany ? [company.industry, company.employees && `${company.employees} staff`].filter(Boolean).join(" · ") : lead.url?.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="max-w-[18rem]">
                      <p className="flex items-center gap-1.5 truncate text-sm">{isCompany && <Briefcase className="h-3.5 w-3.5 shrink-0 opacity-40" />}<span className="truncate">{lead.title || "—"}</span></p>
                      {isCompany && jobs.length > 1 && <p className="pl-5 text-xs text-base-content/50">+{jobs.length - 1} more open role{jobs.length === 2 ? "" : "s"}</p>}
                    </td>
                    <td className="text-sm text-base-content/70">
                      {isCompany
                        ? lead.sourceData?.location ? <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3 opacity-50" /> {lead.sourceData.location}</span> : "—"
                        : lead.company || "—"}
                    </td>
                    <td><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${stage.tone}`}>{stage.label}</span></td>
                    <td>
                      <a href={lead.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-xs btn-square" title={isCompany ? "Open job post" : "Open profile"}>
                        <ExternalLink className="h-3.5 w-3.5" />
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
