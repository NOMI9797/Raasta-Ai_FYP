"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Filter, Briefcase, Target } from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import { useSidebar } from "@/components/layout/SidebarContext";
import TopBar from "@/components/layout/TopBar";
import StatsDashboard from "@/app/dashboard/statistics/components/StatsDashboard";
import { useGlobalStats, useCampaignStats } from "@/app/dashboard/campaigns/hooks/useStats";
import { statsKeys } from "@/app/dashboard/campaigns/hooks/queryKeys";
import HiringAnalytics from "./components/HiringAnalytics";

function SalesAnalytics() {
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  const globalStatsQuery = useGlobalStats();
  const campaignStatsQuery = useCampaignStats(selectedCampaignId);
  const activeQuery = selectedCampaignId ? campaignStatsQuery : globalStatsQuery;
  const { data, isLoading, error } = activeQuery;
  // The campaign list only comes with the unfiltered stats
  const campaigns = globalStatsQuery.data?.campaigns || [];

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <div className="dropdown dropdown-end">
          <label tabIndex={0} className="btn btn-outline btn-sm gap-2">
            <Filter className="h-4 w-4" />
            {selectedCampaignId
              ? campaigns.find((c) => c.id === selectedCampaignId)?.name || "Campaign"
              : "All campaigns"}
          </label>
          <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow-lg bg-base-100 rounded-box w-64 mt-2 max-h-96 overflow-y-auto">
            <li>
              <button onClick={() => setSelectedCampaignId(null)} className={!selectedCampaignId ? "active" : ""}>
                All campaigns
              </button>
            </li>
            {campaigns.length > 0 && <li className="menu-title"><span>Filter by campaign</span></li>}
            {campaigns.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => setSelectedCampaignId(c.id)}
                  className={selectedCampaignId === c.id ? "active" : ""}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          <span>Failed to load analytics: {error.message}</span>
        </div>
      )}

      <StatsDashboard data={data} loading={isLoading} />
    </div>
  );
}

export default function AnalyticsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { collapsed: sidebarCollapsed, setCollapsed: setSidebarCollapsed } = useSidebar();

  const isAdmin = session?.user?.role === "admin";
  const modes = Array.isArray(session?.user?.modes) ? session.user.modes : [];
  const tabs = [
    (isAdmin || modes.includes("recruiter")) && { id: "hiring", label: "Hiring", icon: Briefcase },
    (isAdmin || modes.includes("sales")) && { id: "sales", label: "Sales", icon: Target },
  ].filter(Boolean);
  const [activeTab, setActiveTab] = useState(null);
  const tab = tabs.find((t) => t.id === activeTab)?.id || tabs[0]?.id;

  useEffect(() => {
    if (status === "loading") return;
    if (!session) router.push("/");
  }, [session, status, router]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["hiring-analytics"] });
    queryClient.invalidateQueries({ queryKey: statsKeys.all });
  };

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
      <div className={`flex-1 min-w-0 transition-all duration-300 ${sidebarCollapsed ? "ml-16" : "ml-16 md:ml-64"} flex flex-col h-full overflow-hidden`}>
        <div className="flex-shrink-0">
          <TopBar title="Analytics" />
        </div>
        <div className="flex-1 overflow-auto p-6 space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-base-content">Analytics</h1>
              <p className="text-sm text-base-content/60 mt-1">
                {tab === "sales"
                  ? "LinkedIn invite performance across your campaigns."
                  : "Applicants, screening and hiring outcomes across your jobs."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {tabs.length > 1 && (
                <div className="tabs tabs-boxed" role="tablist">
                  {tabs.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={tab === id}
                      className={`tab gap-2 ${tab === id ? "tab-active" : ""}`}
                      onClick={() => setActiveTab(id)}
                    >
                      <Icon className="h-4 w-4" /> {label}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={refresh} className="btn btn-outline btn-sm gap-2">
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
            </div>
          </div>

          {tab === "hiring" && <HiringAnalytics />}
          {tab === "sales" && <SalesAnalytics />}
        </div>
      </div>
    </div>
  );
}
