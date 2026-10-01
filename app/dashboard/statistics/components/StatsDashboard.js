/**
 * Statistics Dashboard Component
 * 
 * Main container for the statistics dashboard
 * Orchestrates summary cards, charts, and detailed breakdown
 */

"use client";

import SummaryCards from "./SummaryCards";
import StatsCharts from "./StatsCharts";
import DetailedBreakdown from "./DetailedBreakdown";

export default function StatsDashboard({ data, loading }) {
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body p-6">
            <div className="skeleton h-6 w-48 mb-4"></div>
            <SummaryCards stats={{}} loading={true} />
          </div>
        </div>
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body p-6">
            <div className="skeleton h-6 w-48 mb-4"></div>
            <StatsCharts stats={{}} byCampaign={[]} loading={true} />
          </div>
        </div>
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body p-6">
            <div className="skeleton h-6 w-48 mb-4"></div>
            <DetailedBreakdown byCampaign={[]} loading={true} />
          </div>
        </div>
      </div>
    );
  }
  
  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-lg text-base-content/60">No statistics available</p>
          <p className="text-sm text-base-content/40 mt-2">Start sending invites to see your stats</p>
        </div>
      </div>
    );
  }

  const stats = {
    total: 0,
    pending: 0,
    sent: 0,
    accepted: 0,
    rejected: 0,
    failed: 0,
    acceptanceRate: 0,
    totalInvitesSent: 0,
    ...(data.global || {}),
  };
  const byCampaign = Array.isArray(data.byCampaign) ? data.byCampaign : [];
  
  return (
    <div className="space-y-6">
      {/* Summary Cards Section */}
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body p-6">
          <h2 className="card-title text-xl mb-4">
            Overview Metrics
          </h2>
          <SummaryCards stats={stats} loading={false} />
        </div>
      </div>
      
      {/* Charts Section */}
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body p-6">
          <h2 className="card-title text-xl mb-4">
            Visual Analytics
          </h2>
          <StatsCharts 
            stats={stats}
            byCampaign={byCampaign}
            loading={false} 
          />
        </div>
      </div>
      
      {/* Detailed Breakdown Section */}
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body p-6">
          <h2 className="card-title text-xl mb-4">
            Campaign Details
          </h2>
          <DetailedBreakdown 
            byCampaign={byCampaign}
            loading={false} 
          />
        </div>
      </div>
    </div>
  );
}

