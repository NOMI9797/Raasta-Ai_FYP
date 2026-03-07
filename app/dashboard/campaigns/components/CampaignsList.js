"use client";

import { useState } from "react";
import {
  Plus,
  Users,
  Calendar,
  MoreVertical,
  Play,
  Pause,
  Edit,
  Trash2,
  Eye,
  CheckCircle,
  MessageSquare,
} from "lucide-react";
import CreateCampaignModal from "./CreateCampaignModal";
import EditCampaignModal from "./EditCampaignModal";
import { useCampaigns } from "../hooks/useCampaigns";

export default function CampaignsList({ onSelectCampaign }) {
  const {
    campaigns,
    setCampaigns,
    loading,
    error,
    setError,
    createCampaign,
    updateCampaign,
    deleteCampaign,
    refreshCampaigns,
  } = useCampaigns();
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState(null);
  const [showMenu, setShowMenu] = useState(null);
  const [deletingCampaign, setDeletingCampaign] = useState(null);

  const handleCreateCampaign = async (campaignData) => {
    try {
      const newCampaign = await createCampaign(campaignData);
      setShowCreateModal(false);
      onSelectCampaign(newCampaign);
    } catch (err) {
      // Error handling is done in the hook
      console.error("Error creating campaign:", err);
    }
  };

  const handleEditCampaign = async (campaignId, updateData) => {
    try {
      await updateCampaign(campaignId, updateData);
      setShowEditModal(false);
      setEditingCampaign(null);
    } catch (err) {
      // Error handling is done in the hook
      console.error("Error updating campaign:", err);
    }
  };

  const handleOpenEditModal = (campaign) => {
    setEditingCampaign(campaign);
    setShowEditModal(true);
    setShowMenu(null); // Close the dropdown menu
  };

  const handleDeleteCampaign = async (campaignId, campaignName) => {
    // Show confirmation dialog
    const confirmed = window.confirm(
      `Are you sure you want to delete "${campaignName}"?\n\nThis will permanently delete:\n• The campaign\n• All associated leads\n• All generated messages\n\nThis action cannot be undone.`
    );
    
    if (!confirmed) return;

    setDeletingCampaign(campaignId);
    try {
      await deleteCampaign(campaignId, campaignName);
      setShowMenu(null);
    } catch (err) {
      // Error handling is done in the hook
      console.error("Error deleting campaign:", err);
    } finally {
      setDeletingCampaign(null);
    }
  };

  const getStatusStyle = (status) => {
    switch (status) {
      case "draft":
        return "bg-gray-100 text-gray-700 border-gray-200";
      case "active":
        return "bg-green-100 text-green-700 border-green-200";
      case "paused":
        return "bg-yellow-100 text-yellow-700 border-yellow-200";
      case "completed":
        return "bg-blue-100 text-blue-700 border-blue-200";
      default:
        return "bg-gray-100 text-gray-700 border-gray-200";
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case "draft":
        return <Edit className="h-3 w-3" />;
      case "active":
        return <Play className="h-3 w-3" />;
      case "paused":
        return <Pause className="h-3 w-3" />;
      case "completed":
        return <CheckCircle className="h-3 w-3" />;
      default:
        return null;
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  if (loading) {
    return (
      <div className="p-6 bg-base-100">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center py-12">
            <div className="loading loading-spinner loading-lg text-primary"></div>
            <span className="ml-3 text-base-content/60">Loading campaigns...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-base-100">
      <div className="max-w-7xl mx-auto">
        {/* Modern Header with Stats */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-base-content">Campaigns</h1>
              <p className="text-base-content/60 mt-1">
                Manage your LinkedIn outreach campaigns
              </p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn btn-primary gap-2 shadow-lg hover:shadow-xl transition-all w-full sm:w-auto"
            >
              <Plus className="h-4 w-4" />
              New Campaign
            </button>
          </div>
          
          {/* Quick Stats Bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
            <div className="stat bg-base-200 rounded-xl">
              <div className="stat-title text-base-content/60">Total Campaigns</div>
              <div className="stat-value text-primary">{campaigns?.length || 0}</div>
            </div>
            <div className="stat bg-base-200 rounded-xl">
              <div className="stat-title text-base-content/60">Active</div>
              <div className="stat-value text-success">{campaigns?.filter(c => c.status === 'active').length || 0}</div>
            </div>
            <div className="stat bg-base-200 rounded-xl">
              <div className="stat-title text-base-content/60">Total Leads</div>
              <div className="stat-value text-info">{campaigns?.reduce((sum, c) => sum + (c.leadsCount || 0), 0) || 0}</div>
            </div>
            <div className="stat bg-base-200 rounded-xl">
              <div className="stat-title text-base-content/60">Messages Sent</div>
              <div className="stat-value text-warning">{campaigns?.reduce((sum, c) => sum + (c.messagesSent || 0), 0) || 0}</div>
            </div>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="alert alert-error mb-6">
            <div>
              <h3 className="font-bold">Error</h3>
              <div className="text-xs">{error}</div>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={refreshCampaigns}>
              Try Again
            </button>
          </div>
        )}

        {/* Campaigns Grid */}
        {campaigns?.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 lg:gap-6">
            {campaigns.map((campaign) => (
              <div
                key={campaign.id}
                className="card bg-base-100 border border-base-300 hover:shadow-lg hover:border-primary/30 transition-all duration-200 cursor-pointer group hover:-translate-y-0.5"
                onClick={() => onSelectCampaign(campaign)}
              >
                <div className="card-body p-5">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0 pr-2">
                      <h3 className="card-title text-base text-base-content group-hover:text-primary transition-colors mb-1">
                        {campaign.name}
                      </h3>
                      {campaign.description && (
                        <p className="text-sm text-base-content/60 line-clamp-2">
                          {campaign.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-start gap-2 flex-shrink-0">
                      <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusStyle(campaign.status)}`}>
                        {getStatusIcon(campaign.status)}
                        <span className="capitalize">{campaign.status}</span>
                      </div>
                      <div className="dropdown dropdown-end">
                        <button
                          tabIndex={0}
                          role="button"
                          className="btn btn-ghost btn-sm btn-circle"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowMenu(showMenu === campaign.id ? null : campaign.id);
                          }}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                        {showMenu === campaign.id && (
                          <ul
                            tabIndex={0}
                            className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-32 border border-base-300"
                          >
                            <li>
                              <button className="gap-2">
                                <Eye className="h-4 w-4" />
                                View
                              </button>
                            </li>
                            <li>
                              <button 
                                className="gap-2"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenEditModal(campaign);
                                }}
                              >
                                <Edit className="h-4 w-4" />
                                Edit
                              </button>
                            </li>
                            <li>
                              <button 
                                className={`gap-2 text-error ${deletingCampaign === campaign.id ? 'loading' : ''}`}
                                disabled={deletingCampaign === campaign.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteCampaign(campaign.id, campaign.name);
                                }}
                              >
                                {deletingCampaign === campaign.id ? (
                                  <>
                                    <span className="loading loading-spinner loading-xs"></span>
                                    Deleting...
                                  </>
                                ) : (
                                  <>
                                    <Trash2 className="h-4 w-4" />
                                    Delete
                                  </>
                                )}
                              </button>
                            </li>
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="space-y-2.5">
                    <div className="flex items-center text-sm">
                      <div className="flex items-center gap-2 text-base-content/70">
                        <Users className="h-4 w-4" />
                        <span className="font-medium">{campaign.leadsCount} leads</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-base-content/60">
                      <Calendar className="h-3 w-3" />
                      <span>Created {formatDate(campaign.createdAt)}</span>
                    </div>

                    {/* Enhanced Progress Bar */}
                    {campaign.leadsCount > 0 && (
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs text-base-content/60">
                          <span>Processing Progress</span>
                          <span className="font-semibold">
                            {Math.round(((campaign.processedLeads || 0) / campaign.leadsCount) * 100)}%
                          </span>
                        </div>
                        <div className="relative">
                          <progress
                            className="progress progress-primary w-full h-3"
                            value={campaign.processedLeads || 0}
                            max={campaign.leadsCount}
                          ></progress>
                          <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-primary-content">
                            {campaign.processedLeads || 0}/{campaign.leadsCount}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Empty State */
          <div className="text-center py-12">
            <div className="mx-auto w-24 h-24 bg-base-200 rounded-full flex items-center justify-center mb-4">
              <MessageSquare className="h-12 w-12 text-base-content/40" />
            </div>
            <h3 className="text-lg font-semibold text-base-content mb-2">
              No campaigns yet
            </h3>
            <p className="text-base-content/60 mb-6">
              Create your first LinkedIn outreach campaign to get started
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn btn-primary gap-2"
            >
              <Plus className="h-4 w-4" />
              Create Campaign
            </button>
          </div>
        )}
      </div>

      {/* Create Campaign Modal */}
      <CreateCampaignModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateCampaign}
      />

      {/* Edit Campaign Modal */}
      <EditCampaignModal
        open={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditingCampaign(null);
        }}
        onSubmit={handleEditCampaign}
        campaign={editingCampaign}
      />

    </div>
  );
}
