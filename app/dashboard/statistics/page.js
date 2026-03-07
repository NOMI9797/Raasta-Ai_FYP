/**
 * Statistics Page
 * 
 * Main page for displaying LinkedIn connection statistics
 */

"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { RefreshCw, Filter } from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import StatsDashboard from "./components/StatsDashboard";
import { useGlobalStats, useCampaignStats } from "../campaigns/hooks/useStats";

export default function StatisticsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  
  // Fetch stats based on filter
  const globalStatsQuery = useGlobalStats();
  const campaignStatsQuery = useCampaignStats(selectedCampaignId);
  
  // Use the appropriate query based on filter
  const activeQuery = selectedCampaignId ? campaignStatsQuery : globalStatsQuery;
  const { data, isLoading, error, refetch } = activeQuery;
  
  // Available campaigns for filter dropdown
  const campaigns = data?.campaigns || [];
  
  // Redirect if not authenticated
  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/");
    }
  }, [session, status, router]);
  
  const handleRefresh = () => {
    refetch();
  };
  
  const handleCampaignFilter = (campaignId) => {
    setSelectedCampaignId(campaignId === 'all' ? null : campaignId);
  };
  
  if (status === "loading") {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <div className="loading loading-spinner loading-lg text-primary"></div>
      </div>
    );
  }
  
  if (!session) {
    return null;
  }
  
  return (
    <div className="h-screen bg-base-100 flex overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeSection="statistics"
      />
      
      {/* Main Content */}
      <div className={`flex-1 transition-all duration-300 ${
        sidebarCollapsed ? "ml-16" : "ml-64"
      } flex flex-col h-full overflow-hidden`}>
        {/* Top Bar */}
        <div className="flex-shrink-0">
          <TopBar title="Statistics" />
        </div>
        
        {/* Content Area */}
        <div className="flex-1 overflow-auto p-6">
          {/* Header with Filters and Refresh */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-base-content">
                LinkedIn Connection Statistics
              </h1>
              <p className="text-sm text-base-content/60 mt-1">
                Track your invite performance and acceptance rates
              </p>
            </div>
            
            <div className="flex items-center gap-3">
              {/* Campaign Filter */}
              <div className="dropdown dropdown-end">
                <label tabIndex={0} className="btn btn-outline btn-sm gap-2">
                  <Filter className="h-4 w-4" />
                  {selectedCampaignId 
                    ? campaigns.find(c => c.id === selectedCampaignId)?.name || 'Campaign'
                    : 'All Campaigns'
                  }
                </label>
                <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow-lg bg-base-100 rounded-box w-64 mt-2 max-h-96 overflow-y-auto">
                  <li>
                    <a 
                      onClick={() => handleCampaignFilter('all')}
                      className={!selectedCampaignId ? 'active' : ''}
                    >
                      All Campaigns
                    </a>
                  </li>
                  <li className="menu-title">
                    <span>Filter by Campaign</span>
                  </li>
                  {campaigns.map((campaign) => (
                    <li key={campaign.id}>
                      <a 
                        onClick={() => handleCampaignFilter(campaign.id)}
                        className={selectedCampaignId === campaign.id ? 'active' : ''}
                      >
                        {campaign.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
              
              {/* Refresh Button */}
              <button 
                onClick={handleRefresh}
                disabled={isLoading}
                className="btn btn-primary btn-sm gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
          
          {/* Error State */}
          {error && (
            <div className="alert alert-error shadow-lg mb-6">
              <div>
                <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current flex-shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Failed to load statistics: {error.message}</span>
              </div>
            </div>
          )}
          
          {/* Dashboard */}
          <StatsDashboard data={data} loading={isLoading} />
        </div>
      </div>
    </div>
  );
}

