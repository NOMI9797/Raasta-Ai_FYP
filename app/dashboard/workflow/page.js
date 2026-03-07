"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import WorkflowLayout from "./components/WorkflowLayout";
import AudienceTab from "./components/AudienceTab";
import SequenceTemplates from "./components/SequenceTemplates";
import LeadGenerationCanvas from "./templates/lead-generation/LeadGenerationCanvas";
import SendInviteCanvas from "./templates/send-invite/SendInviteCanvas";
import ExtraProfileViewsCanvas from "./templates/extra-profile-views/ExtraProfileViewsCanvas";
import StatisticsTab from "./components/StatisticsTab";
import SettingsTab from "./components/SettingsTab";
import { useCampaigns } from "../campaigns/hooks/useCampaigns";

export default function WorkflowPage() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  
  // Get campaign data from URL parameters
  const campaignId = searchParams.get('campaignId');
  const campaignName = searchParams.get('campaign') || "LinkedIn Outreach Campaign";
  
  // Fetch real campaign data using React Query
  const { campaigns, loading: campaignsLoading } = useCampaigns();
  
  // Find the specific campaign if campaignId is provided
  const selectedCampaign = campaignId ? campaigns.find(c => c.id === campaignId) : null;
  
  // Use real campaign data or fallback to URL params
  const displayCampaignName = selectedCampaign?.name || campaignName;
  const campaignStatus = selectedCampaign?.status || 'draft';
  
  // Status info based on real campaign data
  const getStatusInfo = (status) => {
    switch (status) {
      case 'active':
        return { status: 'active', color: 'bg-success', text: 'Active' };
      case 'paused':
        return { status: 'paused', color: 'bg-warning', text: 'Paused' };
      case 'completed':
        return { status: 'completed', color: 'bg-info', text: 'Completed' };
      case 'draft':
      default:
        return { status: 'draft', color: 'bg-base-300', text: 'Draft' };
    }
  };
  
  const campaignStatusInfo = getStatusInfo(campaignStatus);

  // Redirect if not authenticated
  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      window.location.href = "/";
    }
  }, [session, status]);

  if (status === "loading" || campaignsLoading) {
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
    <div className="min-h-screen bg-base-100 flex">
      {/* Sidebar */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeSection="workflow"
      />

      {/* Main Content */}
      <div className={`flex-1 transition-all duration-300 ${
        sidebarCollapsed ? "ml-16" : "ml-64"
      } flex flex-col min-h-screen overflow-y-auto`}>
        {/* Top Bar */}
        <div className="flex-shrink-0">
          <TopBar title="Workflow Designer" />
        </div>

        {/* Content Area */}
        <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
          {/* Page header cards - only for Workflow Designer */}
          <div className="px-4 pt-4">
            <div className="rounded-2xl border border-base-300 bg-base-200/40 p-4">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Campaign info */}
                <div className="rounded-xl border border-base-300 bg-base-100 p-4">
                  <div className="text-sm text-base-content/60">Campaign</div>
                  <div className="mt-2">
                    <div className="text-lg font-semibold text-base-content">
                      {displayCampaignName}
                    </div>
                    {campaignId && (
                      <div className="text-xs text-base-content/60 mt-1">
                        ID: {campaignId}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-sm text-base-content/60">
                    <span className="inline-flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${campaignStatusInfo.color}`}></span> 
                      {campaignStatusInfo.text}
                    </span>
                  </div>
                </div>

                {/* LinkedIn stats */}
                <div className="rounded-xl border border-base-300 bg-base-100 p-4">
                  <div className="text-sm text-base-content/60 uppercase tracking-wide">LinkedIn</div>
                  <div className="mt-4 flex items-center justify-between text-base-content">
                    <div className="text-sm">Acceptance rate</div>
                    <div className="text-sm font-semibold">
                      {selectedCampaign?.acceptanceRate || '0%'}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-base-content">
                    <div className="text-sm">Response rate</div>
                    <div className="text-sm font-semibold">
                      {selectedCampaign?.responseRate || '0%'}
                    </div>
                  </div>
                </div>

                {/* Controls */}
                <div className="rounded-xl border border-base-300 bg-base-100 p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-base-content/60">Active</div>
                    <input 
                      type="checkbox" 
                      className="toggle toggle-primary" 
                      checked={campaignStatus === 'active'}
                      disabled={campaignStatus === 'completed'}
                    />
                  </div>
                  <div className="text-sm text-base-content/60">{new Date().toLocaleDateString()}</div>
                  <div className="mt-auto flex items-center justify-end">
                    <button className="btn btn-sm btn-ghost" title="Delete" disabled>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M9 3.75A2.25 2.25 0 0 1 11.25 1.5h1.5A2.25 2.25 0 0 1 15 3.75V4.5h3.75a.75.75 0 0 1 0 1.5h-1.086l-.638 12.128A3 3 0 0 1 14.031 21H9.97a3 3 0 0 1-2.995-2.872L6.338 6H5.25a.75.75 0 0 1 0-1.5H9V3.75Zm1.5.75h3V3.75a.75.75 0 0 0-.75-.75h-1.5a.75.75 0 0 0-.75.75V4.5ZM7.838 6l.637 12.128A1.5 1.5 0 0 0 9.969 19.5h4.062a1.5 1.5 0 0 0 1.494-1.372L16.162 6H7.838Z"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0">
            <WorkflowLayout
              AudienceTab={AudienceTab}
              SequenceTab={() => {
                const template = searchParams.get('template');
                if (template === 'lead-generation') return <LeadGenerationCanvas campaignName={campaignName} campaignId={campaignId} />;
                if (template === 'endorse-my-skills') return <SendInviteCanvas campaignName={campaignName} campaignId={campaignId} />;
                if (template === 'extra-profile-views') return <ExtraProfileViewsCanvas campaignName={campaignName} campaignId={campaignId} />;
                return <SequenceTemplates />;
              }}
              StatisticsTab={StatisticsTab}
              SettingsTab={SettingsTab}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
