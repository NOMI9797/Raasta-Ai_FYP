"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Briefcase, Download, ExternalLink, Globe, Loader2, MapPin, Search } from "lucide-react";
import CompanyLogo from "@/components/sales/CompanyLogo";

const COUNTRIES = [
  { value: "pk", label: "Pakistan" },
  { value: "ae", label: "United Arab Emirates" },
  { value: "sa", label: "Saudi Arabia" },
  { value: "uk", label: "United Kingdom" },
  { value: "us", label: "United States" },
];
const POSTED = [
  { value: "", label: "Any time" },
  { value: "24", label: "24 hours" },
  { value: "72", label: "3 days" },
  { value: "168", label: "7 days" },
  { value: "720", label: "30 days" },
];
const SUGGESTIONS = ["React developer", "Flutter developer", "Full stack developer", "QA engineer", "DevOps engineer"];

function postedAgo(date) {
  if (!date) return null;
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 864e5);
  if (Number.isNaN(days)) return null;
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(date).toLocaleDateString([], { day: "numeric", month: "short" });
}

// Find companies that are hiring on a job board (Rozee.pk or Indeed) and add them to the campaign.
// A job post is the buying signal; the company behind it is the lead.
export default function JobBoardSearch({ platform, campaignId, onImported }) {
  const isIndeed = platform === "indeed";
  const [filters, setFilters] = useState({ query: "", location: "", limit: 25, country: "pk", hoursOld: "" });
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [searched, setSearched] = useState(false);
  const [provider, setProvider] = useState(null);

  // Rozee.pk is searched through a web search engine: say so when only the limited free one is set up
  useEffect(() => {
    if (isIndeed) return;
    fetch("/api/sales/search-status").then((r) => r.json()).then((d) => setProvider(d.provider || null)).catch(() => {});
  }, [isIndeed]);

  const set = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  const companies = useMemo(() => new Set(results.map((r) => (r.name || "").toLowerCase()).filter(Boolean)).size, [results]);

  const runSearch = async (overrides = {}) => {
    const f = { ...filters, ...overrides };
    if (!f.query.trim() && !f.location.trim()) {
      toast.error("Enter a job title or a location");
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
            query: f.query.trim(),
            location: f.location.trim(),
            limit: Number(f.limit) || 25,
            ...(isIndeed ? { country: f.country, ...(f.hoursOld ? { hoursOld: Number(f.hoursOld) } : {}) } : {}),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      const rows = data.results || [];
      setResults(rows);
      // Job posts without a company name can't become a lead: leave them unticked
      setSelected(new Set(rows.filter((r) => r.name).map((r) => r.url)));
      setSearched(true);
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
  const allSelected = results.length > 0 && selected.size === results.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(results.map((r) => r.url)));

  const handleImport = async () => {
    const profiles = results.filter((r) => selected.has(r.url));
    try {
      setImporting(true);
      const res = await fetch("/api/leads/scrape/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, profiles }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      toast.success(data.message || "Added to campaign");
      const importedUrls = new Set(data.importedUrls || (data.leads || []).map((l) => l.url));
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
    <div className="space-y-5">
      {/* Search */}
      <form onSubmit={(e) => { e.preventDefault(); runSearch(); }} className="rounded-xl border border-base-300 bg-base-100 p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">Find companies that are hiring</h2>
            <p className="mt-0.5 text-sm text-base-content/60">
              {isIndeed
                ? "Search Indeed for job posts. Every company behind a post becomes a lead: hiring means growth and budget."
                : "Search Rozee.pk for job posts. Every company behind a post becomes a lead. Rozee.pk blocks automated browsers, so its posts are found through a search engine."}
            </p>
          </div>

        </div>

        {!isIndeed && provider && provider !== "serper" && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            <Search className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <span>
              Rozee.pk search is using a free search engine that stops after a few searches. For reliable results, get a free key at serper.dev and add
              <code className="mx-1 rounded bg-base-200 px-1">SERPER_API_KEY=…</code> to .env.local, then restart the app.
            </span>
          </div>
        )}
        <div className="grid gap-2 lg:grid-cols-[1.4fr_1fr_auto_auto]">
          <label className="input input-bordered flex items-center gap-2">
            <Briefcase className="h-4 w-4 opacity-50" />
            <input className="grow" placeholder="Job title or keywords, e.g. React developer" value={filters.query} onChange={(e) => set("query", e.target.value)} />
          </label>
          <label className="input input-bordered flex items-center gap-2">
            <MapPin className="h-4 w-4 opacity-50" />
            <input className="grow" placeholder="City, e.g. Lahore" value={filters.location} onChange={(e) => set("location", e.target.value)} />
          </label>
          {isIndeed && (
            <label className="relative flex items-center">
              <Globe className="pointer-events-none absolute left-3 h-4 w-4 opacity-50" />
              <select className="select select-bordered w-full pl-9 lg:w-52" value={filters.country} onChange={(e) => set("country", e.target.value)} aria-label="Country">
                {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
          )}
          <button type="submit" className="btn btn-primary gap-2" disabled={searching}>
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} {searching ? "Searching…" : "Search"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          {isIndeed && (
            <div className="flex items-center gap-2">
              <span className="text-base-content/55">Posted</span>
              <div className="join">
                {POSTED.map((p) => (
                  <button key={p.value} type="button" onClick={() => set("hoursOld", p.value)}
                    className={`btn join-item btn-xs ${filters.hoursOld === p.value ? "btn-primary" : "btn-ghost border border-base-300"}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="flex items-center gap-2">
            <span className="text-base-content/55">Results</span>
            <select className="select select-bordered select-xs" value={filters.limit} onChange={(e) => set("limit", e.target.value)}>
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-base-content/55">Try</span>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="rounded-full bg-base-200 px-2.5 py-0.5 text-base-content/75 transition-colors hover:bg-primary hover:text-primary-content"
                onClick={() => { set("query", s); runSearch({ query: s }); }} disabled={searching}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </form>

      {/* Results */}
      {searching ? (
        <div className="overflow-hidden rounded-xl border border-base-300 bg-base-100">
          <div className="flex items-center gap-2 border-b border-base-300 px-4 py-3 text-sm text-base-content/60">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            {isIndeed ? "Searching Indeed… usually a few seconds." : "Searching Rozee.pk job posts… usually a few seconds."}
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 border-b border-base-200 px-4 py-3 last:border-0">
              <div className="h-9 w-9 animate-pulse rounded-lg bg-base-200" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-1/3 animate-pulse rounded bg-base-200" />
                <div className="h-2.5 w-1/2 animate-pulse rounded bg-base-200" />
              </div>
            </div>
          ))}
        </div>
      ) : results.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-primary/30 bg-base-100 shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-base-300 bg-primary/[0.04] px-4 py-3">
            <div className="flex items-center gap-3">
              <input type="checkbox" className="checkbox checkbox-sm" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
              <p className="text-sm">
                <span className="font-semibold">{results.length} job post{results.length === 1 ? "" : "s"}</span>
                <span className="text-base-content/55"> from {companies} compan{companies === 1 ? "y" : "ies"} · {selected.size} selected</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn btn-primary btn-sm gap-2" disabled={importing || !selected.size} onClick={handleImport}>
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Add {selected.size || ""} to campaign
              </button>
            </div>
          </header>
          <ul className="max-h-[32rem] divide-y divide-base-200 overflow-y-auto">
            {results.map((r) => {
              const c = r.sourceData?.company || {};
              const on = selected.has(r.url);
              const tags = [r.sourceData?.jobType, r.sourceData?.isRemote && "Remote"].filter(Boolean);
              return (
                <li key={r.url} className={`flex items-start gap-3 px-4 py-3 transition-colors ${on ? "bg-primary/[0.03]" : "hover:bg-base-200/50"}`}>
                  <input type="checkbox" className="checkbox checkbox-sm mt-2.5" checked={on} onChange={() => toggleRow(r.url)} aria-label={`Select ${r.name || r.title}`} />
                  <CompanyLogo name={r.name} logo={c.logo} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className={`font-medium ${r.name ? "" : "italic text-base-content/50"}`}>{r.name || "No company name"}</span>
                      {[c.industry, c.employees && `${c.employees} staff`].filter(Boolean).map((t) => <span key={t} className="text-xs text-base-content/50">{t}</span>)}
                    </div>
                    <p className="mt-0.5 flex items-center gap-1.5 text-sm text-base-content/80"><Briefcase className="h-3.5 w-3.5 shrink-0 opacity-50" /> <span className="truncate">{r.title || "—"}</span></p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-content/55">
                      {r.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {r.location}</span>}
                      {postedAgo(r.sourceData?.datePosted) && <span>{postedAgo(r.sourceData.datePosted)}</span>}
                      {r.salary && <span className="font-medium text-success">{r.salary}</span>}
                      {tags.map((t) => <span key={t} className="rounded bg-base-200 px-1.5 py-0.5 capitalize">{String(t).replace(/_/g, " ")}</span>)}
                      {!r.name && <span className="text-warning">Can&apos;t become a lead without a company name</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {c.website && <a href={c.website} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-xs btn-square" title="Company website"><Globe className="h-3.5 w-3.5" /></a>}
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-xs btn-square" title="Open the job post"><ExternalLink className="h-3.5 w-3.5" /></a>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : searched ? (
        <div className="rounded-xl border border-dashed border-base-300 p-8 text-center">
          <Search className="mx-auto h-7 w-7 opacity-40" />
          <p className="mt-2 font-medium">No job posts found</p>
          <p className="text-sm text-base-content/60">Try other keywords, a wider location, or a longer time range.</p>
        </div>
      ) : null}
    </div>
  );
}

