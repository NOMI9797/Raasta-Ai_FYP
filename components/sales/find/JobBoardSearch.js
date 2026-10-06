"use client";

import { useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { Download, ExternalLink, Info, Loader2, Search } from "lucide-react";

// Find companies that are hiring on a job board (Rozee.pk or Indeed) and add them to the campaign.
// A job post is the buying signal; the company behind it is the lead.
export default function JobBoardSearch({ platform, campaignId, onImported }) {
  const isIndeed = platform === "indeed";
  const [filters, setFilters] = useState({ query: "", location: "", limit: 25, country: "pk", hoursOld: "" });
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [enrichAfterImport, setEnrichAfterImport] = useState(false);
  const [searched, setSearched] = useState(false);

  const set = (key) => (e) => setFilters({ ...filters, [key]: e.target.value });

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!filters.query.trim() && !filters.location.trim()) {
      toast.error("Enter a job title / keyword or a location");
      return;
    }
    try {
      setSearching(true);
      setResults([]);
      setSelected(new Set());
      const res = await fetch("/api/leads/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          filters: {
            query: filters.query.trim(),
            location: filters.location.trim(),
            limit: Number(filters.limit) || 25,
            ...(isIndeed
              ? { country: filters.country, ...(filters.hoursOld ? { hoursOld: Number(filters.hoursOld) } : {}) }
              : {}),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      const rows = data.results || [];
      setResults(rows);
      setSelected(new Set(rows.map((r) => r.url)));
      setSearched(true);
      toast.success(`Found ${rows.length} job post${rows.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSearching(false);
    }
  };

  const toggleRow = (url) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });

  const toggleAll = () =>
    setSelected(selected.size === results.length ? new Set() : new Set(results.map((r) => r.url)));

  const handleImport = async () => {
    const profiles = results.filter((r) => selected.has(r.url));
    try {
      setImporting(true);
      const res = await fetch("/api/leads/scrape/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, profiles, enrichInserted: enrichAfterImport && platform === "rozee" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      toast.success(data.message || "Added to campaign");
      const importedUrls = new Set((data.leads || []).map((l) => l.url));
      setResults((prev) => prev.filter((r) => !importedUrls.has(r.url)));
      setSelected((prev) => new Set([...prev].filter((url) => !importedUrls.has(url))));
      onImported?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="card bg-base-200 border border-base-300 p-4 space-y-3">
        <p className="text-sm text-base-content/70 flex gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          {isIndeed
            ? "Search Indeed for job posts. Each company that is hiring becomes a lead: hiring means growth and budget."
            : "Search Rozee.pk for job posts. Each company that is hiring becomes a lead. Needs a connected Rozee.pk account."}
          {!isIndeed && (
            <Link href="/dashboard/platforms" className="link link-primary whitespace-nowrap">
              Platforms
            </Link>
          )}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="form-control">
            <span className="label-text text-xs mb-1">Job title / keywords</span>
            <input className="input input-bordered input-sm" placeholder="e.g. React developer" value={filters.query} onChange={set("query")} />
          </label>
          <label className="form-control">
            <span className="label-text text-xs mb-1">Location</span>
            <input className="input input-bordered input-sm" placeholder="e.g. Lahore" value={filters.location} onChange={set("location")} />
          </label>
          <label className="form-control">
            <span className="label-text text-xs mb-1">Max results</span>
            <input type="number" min={1} max={100} className="input input-bordered input-sm" value={filters.limit} onChange={set("limit")} />
          </label>
          {isIndeed && (
            <>
              <label className="form-control">
                <span className="label-text text-xs mb-1">Country</span>
                <select className="select select-bordered select-sm" value={filters.country} onChange={set("country")}>
                  <option value="pk">Pakistan</option>
                  <option value="ae">United Arab Emirates</option>
                  <option value="sa">Saudi Arabia</option>
                  <option value="uk">United Kingdom</option>
                  <option value="us">United States</option>
                </select>
              </label>
              <label className="form-control">
                <span className="label-text text-xs mb-1">Posted within</span>
                <select className="select select-bordered select-sm" value={filters.hoursOld} onChange={set("hoursOld")}>
                  <option value="">Any time</option>
                  <option value="24">Last 24 hours</option>
                  <option value="72">Last 3 days</option>
                  <option value="168">Last 7 days</option>
                  <option value="720">Last 30 days</option>
                </select>
              </label>
            </>
          )}
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary btn-sm gap-2" disabled={searching}>
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {searching ? "Searching…" : "Search"}
          </button>
        </div>
      </form>

      {searching ? (
        <div className="card bg-base-200 border border-base-300 p-8 text-center text-sm text-base-content/70">
          <Loader2 className="h-7 w-7 animate-spin text-primary mx-auto mb-2" />
          {isIndeed ? "Searching Indeed… usually a few seconds." : "Searching Rozee.pk in a browser… this can take 30–60 seconds."}
        </div>
      ) : results.length > 0 ? (
        <div className="card bg-base-200 border border-base-300 overflow-hidden">
          <div className="p-3 border-b border-base-300 flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm">
              <span className="font-semibold">{selected.size}</span> of <span className="font-semibold">{results.length}</span> selected
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              {platform === "rozee" && (
                <label className="flex items-center gap-2 cursor-pointer text-xs text-base-content/70">
                  <input type="checkbox" className="checkbox checkbox-xs" checked={enrichAfterImport} onChange={(e) => setEnrichAfterImport(e.target.checked)} />
                  Research companies after adding (slower)
                </label>
              )}
              <button className="btn btn-primary btn-sm gap-2" disabled={importing || !selected.size} onClick={handleImport}>
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Add {selected.size || ""} to campaign
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th className="w-8">
                    <input type="checkbox" className="checkbox checkbox-sm" checked={selected.size === results.length} onChange={toggleAll} aria-label="Select all" />
                  </th>
                  <th>Company</th>
                  <th>Hiring for</th>
                  <th>Location</th>
                  <th>Salary</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const company = r.sourceData?.company;
                  return (
                    <tr key={r.url} className="hover">
                      <td>
                        <input type="checkbox" className="checkbox checkbox-sm" checked={selected.has(r.url)} onChange={() => toggleRow(r.url)} aria-label={`Select ${r.name || r.title}`} />
                      </td>
                      <td className="text-sm">
                        <div className="font-medium">{r.name || "Unknown company"}</div>
                        {company && (
                          <div className="text-xs text-base-content/50">
                            {[company.industry, company.employees && `${company.employees} staff`].filter(Boolean).join(" · ")}
                            {company.website && (
                              <a href={company.website} target="_blank" rel="noopener noreferrer" className="link link-primary ml-1">
                                website
                              </a>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="text-sm">{r.title || "—"}</td>
                      <td className="text-sm text-base-content/70">{r.location || "—"}</td>
                      <td className="text-sm text-success">{r.salary || "—"}</td>
                      <td>
                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-xs" title="Open job post">
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        searched && <p className="text-sm text-base-content/60 text-center py-6">No job posts found. Try other keywords or a wider location.</p>
      )}
    </div>
  );
}
