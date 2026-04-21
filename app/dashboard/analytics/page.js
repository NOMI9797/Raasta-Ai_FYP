"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { RefreshCw, Filter } from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import StatsDashboard from "@/app/dashboard/statistics/components/StatsDashboard";
import { useGlobalStats, useCampaignStats } from "@/app/dashboard/campaigns/hooks/useStats";

export default function AnalyticsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);

  const globalStatsQuery = useGlobalStats();
  const campaignStatsQuery = useCampaignStats(selectedCampaignId);
  const activeQuery = selectedCampaignId ? campaignStatsQuery : globalStatsQuery;
  const { data, isLoading, error, refetch } = activeQuery;
  const campaigns = data?.campaigns || [];

  useEffect(() => {
    if (status === "loading") return;
    if (!session) router.push("/");
  }, [session, status, router]);

  const handleCampaignFilter = (id) => setSelectedCampaignId(id === "all" ? null : id);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <div className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }
  if (!session) return null;

  return (
    <div className="h-screen bg-base-100 flex overflow-hidden">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeSection="analytics"
      />
      <div className={`flex-1 transition-all duration-300 ${sidebarCollapsed ? "ml-16" : "ml-64"} flex flex-col h-full overflow-hidden`}>
        <div className="flex-shrink-0">
          <TopBar title="Analytics" />
        </div>
        <div className="flex-1 overflow-auto p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-base-content">Analytics</h1>
              <p className="text-sm text-base-content/60 mt-1">
                Performance across campaigns and platforms.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="dropdown dropdown-end">
                <label tabIndex={0} className="btn btn-outline btn-sm gap-2">
                  <Filter className="h-4 w-4" />
                  {selectedCampaignId
                    ? campaigns.find((c) => c.id === selectedCampaignId)?.name || "Campaign"
                    : "All Campaigns"}
                </label>
                <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow-lg bg-base-100 rounded-box w-64 mt-2 max-h-96 overflow-y-auto">
                  <li>
                    <a onClick={() => handleCampaignFilter("all")} className={!selectedCampaignId ? "active" : ""}>
                      All Campaigns
                    </a>
                  </li>
                  <li className="menu-title"><span>Filter by Campaign</span></li>
                  {campaigns.map((c) => (
                    <li key={c.id}>
                      <a
                        onClick={() => handleCampaignFilter(c.id)}
                        className={selectedCampaignId === c.id ? "active" : ""}
                      >
                        {c.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
              <button onClick={() => refetch()} disabled={isLoading} className="btn btn-primary btn-sm gap-2">
                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          </div>

          {error && (
            <div className="alert alert-error shadow-lg mb-6">
              <span>Failed to load analytics: {error.message}</span>
            </div>
          )}

          <StatsDashboard data={data} loading={isLoading} />
        </div>
      </div>
    </div>
  );
}
