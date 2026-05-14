"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Search,
  Loader2,
  ExternalLink,
  Download,
  Radar,
  CheckCircle2,
  Filter,
  ArrowRight,
} from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import { PLATFORM_LIST } from "@/libs/platforms/meta";

// Today Rozee.pk and Indeed are wired to adapter.search; LinkedIn is still pending.
const SCRAPER_AVAILABILITY = {
  linkedin: false,
  rozee: true,
  indeed: true,
};

export default function LeadScraperPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [platform, setPlatform] = useState("rozee");
  const [filters, setFilters] = useState({
    query: "",
    location: "",
    limit: 25,
    indeedCountry: "",
  });
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [scraping, setScraping] = useState(false);
  const [importing, setImporting] = useState(false);
  const [campaigns, setCampaigns] = useState([]);
  const [campaignId, setCampaignId] = useState("");
  const [lastScrape, setLastScrape] = useState(null);
  const [enrichAfterImport, setEnrichAfterImport] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/");
      return;
    }
    const modes = Array.isArray(session.user?.modes) ? session.user.modes : [];
    const isAdmin = session.user?.role === "admin";
    if (!isAdmin && !modes.includes("sales")) {
      router.replace("/dashboard/home");
    }
  }, [session, status, router]);

  // Load campaigns for the import target picker. We only import into
  // campaigns whose `sources` allows the scraped platform.
  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        const res = await fetch("/api/campaigns");
        const data = await res.json();
        if (res.ok) setCampaigns(data.campaigns || []);
      } catch (err) {
        console.error("Failed to load campaigns", err);
      }
    })();
  }, [session]);

  const compatibleCampaigns = useMemo(
    () =>
      campaigns.filter((c) => {
        const sources = Array.isArray(c.sources) && c.sources.length ? c.sources : ["linkedin"];
        return sources.includes(platform);
      }),
    [campaigns, platform]
  );

  // Reset the target campaign if the picker changes platforms and the
  // previously-selected campaign no longer accepts this source.
  useEffect(() => {
    if (campaignId && !compatibleCampaigns.some((c) => c.id === campaignId)) {
      setCampaignId("");
    }
  }, [compatibleCampaigns, campaignId]);

  const handleScrape = async () => {
    if (!filters.query.trim() && !filters.location.trim()) {
      toast.error("Enter a job title / keyword or a location");
      return;
    }
    if (!SCRAPER_AVAILABILITY[platform]) {
      toast.error("This platform isn't available yet");
      return;
    }

    try {
      setScraping(true);
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
            ...(platform === "indeed" && filters.indeedCountry.trim()
              ? { country: filters.indeedCountry.trim() }
              : {}),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scrape failed");
      const rows = data.results || [];
      setResults(rows);
      setSelected(new Set(rows.map((r) => r.url)));
      setLastScrape(new Date());
      toast.success(`Found ${rows.length} profile${rows.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setScraping(false);
    }
  };

  const toggleRow = (url) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === results.length) setSelected(new Set());
    else setSelected(new Set(results.map((r) => r.url)));
  };

  const handleImport = async () => {
    if (!campaignId) {
      toast.error("Pick a campaign to import into");
      return;
    }
    if (!selected.size) {
      toast.error("Select at least one profile to import");
      return;
    }

    const profiles = results.filter((r) => selected.has(r.url));
    try {
      setImporting(true);
      const res = await fetch("/api/leads/scrape/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          profiles,
          enrichInserted: enrichAfterImport && platform === "rozee",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      toast.success(data.message || "Imported");
      // Remove imported URLs from the visible list so the user can clearly
      // see what's left.
      const importedUrls = new Set((data.leads || []).map((l) => l.url));
      setResults((prev) => prev.filter((r) => !importedUrls.has(r.url)));
      setSelected((prev) => {
        const next = new Set(prev);
        for (const url of importedUrls) next.delete(url);
        return next;
      });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setImporting(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <div className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }
  if (!session) return null;

  const selectedPlatformMeta = PLATFORM_LIST.find((p) => p.id === platform);

  return (
    <div className="min-h-screen bg-base-100 flex">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeSection="sales-lead-scraper"
      />
      <div
        className={`flex-1 transition-all duration-300 ${
          sidebarCollapsed ? "ml-16" : "ml-64"
        } flex flex-col`}
      >
        <TopBar title="Lead Scraper" />
        <main className="flex-1 p-6 space-y-6 overflow-auto">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Radar className="h-6 w-6 text-primary" />
              Lead Scraper
            </h1>
            <p className="text-sm text-base-content/70 mt-1">
              Pick a platform, run a search, then push selected profiles into a sales campaign.
            </p>
          </div>

          {/* Platform picker */}
          <section>
            <div className="text-xs uppercase tracking-wide text-base-content/60 mb-2">
              1. Platform
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {PLATFORM_LIST.map((p) => {
                const available = SCRAPER_AVAILABILITY[p.id];
                const isActive = platform === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={!available}
                    onClick={() => setPlatform(p.id)}
                    className={`relative text-left p-4 rounded-lg border transition-all ${
                      isActive
                        ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                        : "border-base-300 bg-base-200 hover:border-base-content/30"
                    } ${!available ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`${p.accent} text-white font-bold w-10 h-10 rounded-md flex items-center justify-center`}
                      >
                        {p.initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold">{p.label}</div>
                        <div className="text-xs text-base-content/60 truncate">
                          {p.description}
                        </div>
                      </div>
                      {isActive && available && (
                        <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                      )}
                    </div>
                    {!available && (
                      <div className="absolute top-2 right-2 badge badge-sm badge-ghost">
                        Coming soon
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Filters */}
          <section>
            <div className="text-xs uppercase tracking-wide text-base-content/60 mb-2">
              2. Filters
            </div>
            <div className="card bg-base-200 border border-base-300 p-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="label py-1">
                    <span className="label-text text-xs">Job title / keywords</span>
                  </label>
                  <input
                    className="input input-bordered w-full"
                    placeholder="e.g. React developer"
                    value={filters.query}
                    onChange={(e) => setFilters({ ...filters, query: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label py-1">
                    <span className="label-text text-xs">Location</span>
                  </label>
                  <input
                    className="input input-bordered w-full"
                    placeholder={
                      platform === "indeed"
                        ? "City, country, or remote"
                        : "e.g. Lahore"
                    }
                    value={filters.location}
                    onChange={(e) => setFilters({ ...filters, location: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label py-1">
                    <span className="label-text text-xs">Max results</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    className="input input-bordered w-full"
                    value={filters.limit}
                    onChange={(e) => setFilters({ ...filters, limit: e.target.value })}
                  />
                </div>
              </div>
              {platform === "indeed" && (
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <div className="form-control w-full max-w-xs">
                    <label className="label py-1">
                      <span className="label-text text-xs">Country</span>
                    </label>
                    <select
                      className="select select-bordered select-sm w-full"
                      value={filters.indeedCountry}
                      onChange={(e) =>
                        setFilters({ ...filters, indeedCountry: e.target.value })
                      }
                    >
                      <option value="">Auto</option>
                      <option value="pk">pk</option>
                      <option value="us">us</option>
                      <option value="uk">uk</option>
                    </select>
                  </div>
                </div>
              )}
              <div className="mt-4 flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs text-base-content/60">
                  Searching on{" "}
                  <span className="font-medium text-base-content">
                    {selectedPlatformMeta?.label || platform}
                  </span>
                  {!SCRAPER_AVAILABILITY[platform] && " — not available yet"}
                </p>
                <button
                  className="btn btn-primary gap-2"
                  disabled={scraping || !SCRAPER_AVAILABILITY[platform]}
                  onClick={handleScrape}
                >
                  {scraping ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Scraping…
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4" /> Run search
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>

          {/* Results */}
          <section>
            <div className="text-xs uppercase tracking-wide text-base-content/60 mb-2 flex items-center justify-between">
              <span>3. Results</span>
              {lastScrape && (
                <span className="text-[10px] text-base-content/50 normal-case tracking-normal">
                  Last run {lastScrape.toLocaleTimeString()}
                </span>
              )}
            </div>

            {scraping ? (
              <div className="card bg-base-200 border border-base-300 p-10 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
                <p className="text-sm text-base-content/70">
                  {platform === "indeed" ? (
                    <>
                      Searching Indeed… This can take a couple of minutes when there are many results.
                    </>
                  ) : (
                    <>
                      Running a headless browser against {selectedPlatformMeta?.label}. Scraping job listings —
                      this can take 30–60 seconds.
                    </>
                  )}
                </p>
              </div>
            ) : results.length === 0 ? (
              <div className="card bg-base-200 border border-base-300 p-10 text-center text-base-content/60">
                <Filter className="h-10 w-10 mx-auto mb-2 opacity-40" />
                <p>No results yet. Run a search above to see matching job listings.</p>
              </div>
            ) : (
              <div className="card bg-base-200 border border-base-300 overflow-hidden">
                <div className="p-3 border-b border-base-300 flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-sm">
                    <span className="font-semibold">{selected.size}</span> of{" "}
                    <span className="font-semibold">{results.length}</span> selected
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {platform === "rozee" && (
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-base-content/70 whitespace-nowrap">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-xs"
                          checked={enrichAfterImport}
                          onChange={(e) => setEnrichAfterImport(e.target.checked)}
                        />
                        Enrich jobs (score + description)
                      </label>
                    )}
                    <select
                      className="select select-bordered select-sm"
                      value={campaignId}
                      onChange={(e) => setCampaignId(e.target.value)}
                    >
                      <option value="">
                        {compatibleCampaigns.length
                          ? "Choose a campaign…"
                          : "No compatible campaigns"}
                      </option>
                      {compatibleCampaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn btn-primary btn-sm gap-2"
                      disabled={importing || !selected.size || !campaignId}
                      onClick={handleImport}
                    >
                      {importing ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Importing…
                        </>
                      ) : (
                        <>
                          <Download className="h-4 w-4" /> Import {selected.size || ""}
                          <ArrowRight className="h-3 w-3 opacity-70" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th className="w-8">
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm"
                            checked={selected.size === results.length && results.length > 0}
                            onChange={toggleAll}
                          />
                        </th>
                        <th>Job Title</th>
                        <th>Company</th>
                        <th>Location</th>
                        <th>Salary</th>
                        <th className="w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r) => (
                        <tr key={r.url} className="hover">
                          <td>
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm"
                              checked={selected.has(r.url)}
                              onChange={() => toggleRow(r.url)}
                            />
                          </td>
                          <td>
                            <div className="font-medium">{r.title || "—"}</div>
                            <div className="text-xs text-base-content/50 truncate max-w-[240px]">
                              {r.url}
                            </div>
                          </td>
                          <td className="text-sm">{r.name || "—"}</td>
                          <td className="text-sm text-base-content/70">{r.location || "—"}</td>
                          <td className="text-sm text-success">{r.salary || "—"}</td>
                          <td>
                            {r.url && (
                              <a
                                href={r.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-ghost btn-xs"
                                title="Open job"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!compatibleCampaigns.length && (
                  <div className="p-3 border-t border-base-300 text-xs text-base-content/60">
                    No campaigns accept <span className="font-medium capitalize">{platform}</span>{" "}
                    leads. Create a campaign with {selectedPlatformMeta?.label} in its sources to
                    import these profiles.
                  </div>
                )}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
