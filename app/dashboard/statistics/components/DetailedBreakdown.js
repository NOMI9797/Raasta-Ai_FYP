/**
 * Detailed Breakdown Component
 * 
 * Expandable table showing per-campaign and per-lead statistics
 */

"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";

export default function DetailedBreakdown({ byCampaign, loading }) {
  const [expandedCampaigns, setExpandedCampaigns] = useState(new Set());
  const [campaignLeads, setCampaignLeads] = useState({});
  const [loadingLeads, setLoadingLeads] = useState({});
  
  const toggleCampaign = async (campaignId) => {
    const newExpanded = new Set(expandedCampaigns);
    
    if (newExpanded.has(campaignId)) {
      newExpanded.delete(campaignId);
    } else {
      newExpanded.add(campaignId);
      
      // Fetch leads for this campaign if not already loaded
      if (!campaignLeads[campaignId]) {
        setLoadingLeads(prev => ({ ...prev, [campaignId]: true }));
        
        try {
          const response = await fetch(`/api/campaigns/${campaignId}/leads`);
          const data = await response.json();
          
          setCampaignLeads(prev => ({
            ...prev,
            [campaignId]: data.leads || []
          }));
        } catch (error) {
          console.error('Failed to fetch leads:', error);
        } finally {
          setLoadingLeads(prev => ({ ...prev, [campaignId]: false }));
        }
      }
    }
    
    setExpandedCampaigns(newExpanded);
  };
  
  const getStatusBadge = (status) => {
    const badges = {
      accepted: 'badge-success',
      sent: 'badge-warning',
      pending: 'badge-ghost',
      rejected: 'badge-error',
      failed: 'badge-error'
    };
    return badges[status] || 'badge-ghost';
  };
  
  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };
  
  /**
   * Extract a readable name from LinkedIn URL or use fallback
   */
  const getDisplayName = (lead) => {
    // If name exists and is not "Unknown", use it
    if (lead.name && lead.name.trim() !== '' && lead.name.toLowerCase() !== 'unknown') {
      return lead.name;
    }
    
    // Try to extract name from URL (LinkedIn username)
    if (lead.url) {
      try {
        const match = lead.url.match(/linkedin\.com\/in\/([^\/\?]+)/i);
        if (match && match[1]) {
          // Format username: "john-doe-123" -> "John Doe"
          const username = match[1];
          const formatted = username
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
          return formatted;
        }
      } catch (error) {
        // Fall through to default
      }
    }
    
    // Use title if available
    if (lead.title && lead.title.trim() !== '' && lead.title.toLowerCase() !== 'unknown') {
      return lead.title;
    }
    
    // Use company if available
    if (lead.company && lead.company.trim() !== '' && lead.company.toLowerCase() !== 'unknown') {
      return lead.company;
    }
    
    // Final fallback
    return 'Unknown';
  };
  
  if (loading) {
    return (
      <div className="card bg-base-200 shadow-lg">
        <div className="card-body">
          <div className="skeleton h-6 w-48 mb-4"></div>
          <div className="skeleton h-64 w-full"></div>
        </div>
      </div>
    );
  }
  
  if (byCampaign.length === 0) {
    return (
      <div className="card bg-base-200 shadow-lg">
        <div className="card-body">
          <h3 className="card-title text-lg mb-4 pb-2 border-b border-base-300">Campaign Breakdown</h3>
          <div className="flex items-center justify-center h-32 text-base-content/40">
            <p>No campaign data available</p>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="card bg-base-200 shadow-lg">
      <div className="card-body p-0">
        <div className="p-6 pb-2">
          <h3 className="card-title text-lg">Campaign Breakdown</h3>
        </div>
        <div className="p-6 pt-4">
        
        <div className="overflow-x-auto">
          <table className="table table-zebra">
            <thead>
              <tr>
                <th className="w-12"></th>
                <th>Campaign Name</th>
                <th className="text-center">Total</th>
                <th className="text-center">Pending</th>
                <th className="text-center">Sent</th>
                <th className="text-center">Accepted</th>
                <th className="text-center">Rejected</th>
                <th className="text-center">Failed</th>
                <th className="text-center">Acceptance Rate</th>
              </tr>
            </thead>
            <tbody>
              {byCampaign.map((campaign) => {
                const isExpanded = expandedCampaigns.has(campaign.campaignId);
                const leads = campaignLeads[campaign.campaignId] || [];
                const isLoadingLeads = loadingLeads[campaign.campaignId];
                
                return (
                  <React.Fragment key={campaign.campaignId}>
                    {/* Campaign Row */}
                    <tr 
                      className="hover cursor-pointer"
                      onClick={() => toggleCampaign(campaign.campaignId)}
                    >
                      <td>
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </td>
                      <td className="font-medium">{campaign.campaignName}</td>
                      <td className="text-center">{campaign.stats.total}</td>
                      <td className="text-center">{campaign.stats.pending}</td>
                      <td className="text-center">{campaign.stats.sent}</td>
                      <td className="text-center font-semibold text-success">{campaign.stats.accepted}</td>
                      <td className="text-center text-error">{campaign.stats.rejected}</td>
                      <td className="text-center text-base-content/60">{campaign.stats.failed}</td>
                      <td className="text-center">
                        <span className={`badge ${
                          campaign.stats.acceptanceRate >= 30 ? 'badge-success' :
                          campaign.stats.acceptanceRate >= 15 ? 'badge-warning' :
                          'badge-ghost'
                        }`}>
                          {campaign.stats.acceptanceRate}%
                        </span>
                      </td>
                    </tr>
                    
                    {/* Expanded Leads Rows */}
                    {isExpanded && (
                      <tr>
                        <td colSpan="9" className="p-0">
                          <div className="bg-base-200 p-4">
                            {isLoadingLeads ? (
                              <div className="flex items-center justify-center py-8">
                                <span className="loading loading-spinner loading-md"></span>
                              </div>
                            ) : leads.length === 0 ? (
                              <div className="text-center py-4 text-base-content/60">
                                No leads found
                              </div>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="table table-sm table-zebra w-full">
                                  <thead>
                                    <tr>
                                      <th className="w-1/3">Lead Name</th>
                                      <th className="w-1/4">Profile URL</th>
                                      <th className="text-center w-1/4">Invite Status</th>
                                      <th className="text-center w-1/4">Date Sent</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {leads
                                      .filter(lead => lead.inviteSent || lead.inviteStatus)
                                      .map((lead) => (
                                        <tr key={lead.id} className="hover">
                                          <td className="text-sm align-middle">
                                            {getDisplayName(lead)}
                                          </td>
                                          <td className="align-middle">
                                            <a 
                                              href={lead.url} 
                                              target="_blank" 
                                              rel="noopener noreferrer"
                                              className="link link-primary text-xs flex items-center gap-1 w-fit"
                                              onClick={(e) => e.stopPropagation()}
                                            >
                                              View Profile
                                              <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                            </a>
                                          </td>
                                          <td className="text-center align-middle">
                                            <span className={`badge badge-sm ${getStatusBadge(lead.inviteStatus)}`}>
                                              {lead.inviteStatus || 'pending'}
                                            </span>
                                          </td>
                                          <td className="text-center text-xs text-base-content/60 align-middle whitespace-nowrap">
                                            {formatDate(lead.inviteSentAt)}
                                          </td>
                                        </tr>
                                      ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>
      </div>
    </div>
  );
}

