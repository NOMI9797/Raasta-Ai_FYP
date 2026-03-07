"use client";

import { useState, memo } from "react";
import { toast } from "react-hot-toast";
import {
  Plus,
  Upload,
  Search,
  Play,
  ChevronLeft,
  ChevronRight,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  Settings,
  Link,
  User,
  MapPin,
  Trash2,
  MessageSquare,
  UserCheck,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useLeads } from "../hooks/useLeads";
import { useScraping } from "../hooks/useScraping";

// Sortable Lead Item Component
function SortableLeadItem({ lead, isSelected, onSelect, getDisplayName, getStatusIcon, getStatusColor, scrapingProgress }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: lead._id || lead.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`card bg-base-100 border border-base-300 cursor-grab active:cursor-grabbing transition-all hover:shadow-sm ${
        isSelected
          ? "ring-2 ring-primary bg-primary/5"
          : "hover:bg-base-200"
      } ${isDragging ? "z-50" : ""}`}
      onClick={(e) => {
        // Only select if not dragging
        if (!isDragging) {
          onSelect(lead);
        }
      }}
      title="Drag to reorder or click to select"
    >
      <div className="card-body p-3">
        <div className="flex items-start gap-3">
          {/* Profile Picture or Status Icon */}
          {lead.profilePicture ? (
            <div className="avatar">
              <div className="w-8 h-8 rounded-full">
                <img 
                  src={lead.profilePicture} 
                  alt={getDisplayName(lead)}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    // Fallback to initials if image fails to load
                    e.target.style.display = 'none';
                    e.target.nextSibling.style.display = 'flex';
                  }}
                />
                <div 
                  className="w-full h-full bg-primary text-primary-content rounded-full flex items-center justify-center text-xs font-medium"
                  style={{ display: 'none' }}
                >
                  {getDisplayName(lead).split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                </div>
              </div>
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-primary text-primary-content flex items-center justify-center text-xs font-medium">
              {lead.status === 'processing' ? (
                <div className="loading loading-spinner loading-xs"></div>
              ) : (
                getDisplayName(lead).split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
              )}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-semibold text-sm text-base-content truncate">
                {getDisplayName(lead)}
              </h4>
              
              {/* Connection Status Indicator */}
              {lead.inviteSent && (
                <div 
                  className={`w-2 h-2 rounded-full ${
                    lead.inviteStatus === 'accepted' 
                      ? 'bg-green-500' 
                      : lead.inviteStatus === 'sent' 
                      ? 'bg-yellow-500' 
                      : 'bg-red-500'
                  }`}
                  title={
                    lead.inviteStatus === 'accepted' 
                      ? 'Connection Accepted ✓' 
                      : lead.inviteStatus === 'sent' 
                      ? 'Invite Pending...' 
                      : 'Invite Failed'
                  }
                />
              )}
              
              {/* Message Sent Indicator */}
              {lead.messageSent && (
                <div 
                  className="w-2 h-2 rounded-full bg-blue-500"
                  title={`Message Sent ${lead.messageSentAt ? new Date(lead.messageSentAt).toLocaleDateString() : ''}`}
                />
              )}
              
              <div className={`badge badge-sm ${getStatusColor(lead.status)}`}>
                {lead.status}
              </div>
            </div>

            {lead.title && (
              <div className="flex items-center gap-1 text-xs text-base-content/60 mb-1">
                <User className="h-3 w-3" />
                <span className="truncate">{lead.title}</span>
              </div>
            )}

            {lead.location && (
              <div className="flex items-center gap-1 text-xs text-base-content/60 mb-1">
                <MapPin className="h-3 w-3" />
                <span className="truncate">{lead.location}</span>
              </div>
            )}

            <p className="text-xs text-base-content/40 truncate mt-1">
              {lead.url}
            </p>

            {/* Progress Bar for Processing Leads */}
            {lead.status === "processing" && scrapingProgress[lead._id || lead.id] && (
              <div className="mt-2 space-y-1">
                <div className="flex justify-between text-xs text-base-content/60">
                  <span>{scrapingProgress[lead._id || lead.id].message}</span>
                  <span>{scrapingProgress[lead._id || lead.id].progress}%</span>
                </div>
                <progress
                  className="progress progress-primary w-full h-1"
                  value={scrapingProgress[lead._id || lead.id].progress}
                  max="100"
                ></progress>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const LeadsColumn = memo(function LeadsColumn({
  leads,
  setLeads,
  selectedLead,
  onSelectLead,
  collapsed,
  onToggleCollapse,
  campaignId,
  onRefreshLeads,
  loading,
  error,
  onOpenSettings,
  scrapingSettings,
  setScrapingSettings,
}) {
  const { addLeads } = useLeads();
  const { checkConnections, isChecking } = require("../hooks/useConnectionCheck").useConnectionCheck();
  const {
    isProcessing,
    scrapingProgress,
    scrapeLead,
    scrapeMultipleLeads,
  } = useScraping();
  
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUrls, setNewUrls] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showClearErrorDialog, setShowClearErrorDialog] = useState(false);
  const [isClearingErrors, setIsClearingErrors] = useState(false);

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Handle drag end
  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      const oldIndex = leads.findIndex(lead => (lead._id || lead.id) === active.id);
      const newIndex = leads.findIndex(lead => (lead._id || lead.id) === over.id);

      const newLeads = arrayMove(leads, oldIndex, newIndex);
      setLeads(newLeads);
    }
  };

  const getDisplayName = (lead) => {
    if (lead.name) return lead.name;
    if (lead.status === "processing") return "Processing...";

    // Extract name from LinkedIn URL
    const urlMatch = new RegExp("linkedin\\.com/in/([^/]+)").exec(lead.url);
    if (urlMatch) {
      const username = urlMatch[1];
      return username
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    }

    return "LinkedIn Profile";
  };

  const handleImportCSV = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv";
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const csv = e.target?.result;
            const lines = csv.split("\n").filter((line) => line.trim());

            if (lines.length === 0) {
              toast.error("CSV file is empty");
              return;
            }

            const urls = [];
            lines.forEach((line) => {
              const trimmedLine = line.trim();
              if (!trimmedLine) return;

              if (trimmedLine.includes("linkedin.com") && !trimmedLine.includes(",")) {
                urls.push(trimmedLine);
              } else {
                const columns = trimmedLine.split(",").map((col) => col.trim().replace(/"/g, ""));
                const url = columns[0];
                if (url && url.includes("linkedin.com")) {
                  urls.push(url);
                }
              }
            });

            if (urls.length === 0) {
              toast.error("No valid LinkedIn URLs found in CSV");
              return;
            }

            handleAddUrls(urls);
          } catch (error) {
            console.error("CSV import error:", error);
            toast.error("Failed to parse CSV file");
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const handleAddUrls = async (urls = null) => {
    const urlsToAdd = urls || newUrls.split("\n").filter((url) => url.trim() && url.includes("linkedin.com"));

    if (urlsToAdd.length === 0) {
      toast.error("Please enter valid LinkedIn profile URLs");
      return;
    }

    try {
      await addLeads(campaignId, urlsToAdd);
        setNewUrls("");
        setShowAddForm(false);
        onRefreshLeads();
    } catch (error) {
      console.error("Error adding leads:", error);
    }
  };


  const handleRunSelected = async () => {
    if (!selectedLead) return;
    await scrapeLead(selectedLead, scrapingSettings, leads, setLeads, campaignId);
  };

  const handleRunAll = async () => {
    const pendingLeads = leads.filter(lead => lead.status === "pending" || lead.status === "error");
    await scrapeMultipleLeads(pendingLeads, scrapingSettings, leads, setLeads, campaignId);
  };

  const handleClearErrorLeads = async () => {
    setIsClearingErrors(true);
    try {
      const response = await fetch(`/api/leads/clear-failed?campaignId=${campaignId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to clear error leads');
      }

      const result = await response.json();
      
      // Update the leads list by removing error leads
      const updatedLeads = leads.filter(lead => lead.status !== 'error');
      setLeads(updatedLeads);
      
      // Clear selection if selected lead was an error lead
      if (selectedLead && selectedLead.status === 'error') {
        onSelectLead(null);
      }

      // Show success toast
      toast.success(`Successfully removed ${result.data.deletedLeads} error lead${result.data.deletedLeads > 1 ? 's' : ''}`);
      
      setShowClearErrorDialog(false);
    } catch (error) {
      console.error('Error clearing failed leads:', error);
      toast.error('Failed to clear error leads. Please try again.');
    } finally {
      setIsClearingErrors(false);
    }
  };


  const getStatusIcon = (status) => {
    switch (status) {
      case "pending":
        return <Clock className="h-4 w-4 text-base-content/40" />;
      case "processing":
        return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
      case "completed":
        return <CheckCircle className="h-4 w-4 text-success" />;
      case "error":
        return <XCircle className="h-4 w-4 text-error" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "pending":
        return "badge-neutral";
      case "processing":
        return "badge-primary";
      case "completed":
        return "badge-success";
      case "error":
        return "badge-error";
    }
  };

  const filteredLeads = leads.filter(
    (lead) =>
      !searchQuery ||
      lead.url.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.company?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const errorLeadsCount = leads.filter(lead => lead.status === 'error').length;

  if (collapsed) {
    return (
      <div className="h-full flex flex-col items-center py-4 bg-base-100">
        <button
          onClick={onToggleCollapse}
          className="btn btn-ghost btn-sm btn-circle mb-4"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="writing-mode-vertical text-sm text-base-content/60">
          Leads ({leads.length})
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-base-100">
      {/* Header */}
      <div className="p-4 border-b border-base-300">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-base-content">Leads</h2>
            <div className="badge badge-primary badge-sm">{leads.length}</div>
            
            {/* Connection Status Legend */}
            <div className="dropdown dropdown-end">
              <div 
                tabIndex={0} 
                role="button" 
                className="btn btn-ghost btn-circle btn-xs"
                title="Connection status indicators"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="w-4 h-4 stroke-current">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
              </div>
              <div tabIndex={0} className="dropdown-content z-[1] card card-compact w-64 p-3 shadow bg-base-200 border border-base-300">
                <div className="text-xs space-y-2">
                  <div className="font-semibold mb-2">Connection Status:</div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    <span>Accepted - Connection confirmed</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
                    <span>Pending - Invite sent, awaiting</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500"></div>
                    <span>Failed - Invite error</span>
                  </div>
                  <div className="border-t border-base-300 my-2"></div>
                  <div className="font-semibold mb-2">Message Status:</div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                    <span>Message sent successfully</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <button
            onClick={onToggleCollapse}
            className="btn btn-ghost btn-sm btn-circle"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-base-content/40" />
          <input
            type="text"
            placeholder="Search leads..."
            className="input input-bordered w-full pl-9 input-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2 mb-2">
          <button
            onClick={handleRunSelected}
            disabled={!selectedLead || isProcessing}
            className="btn btn-primary btn-sm gap-1"
          >
            <Play className="h-3 w-3" />
            Run Selected
          </button>
          <button
            onClick={handleRunAll}
            disabled={isProcessing || leads.filter(lead => lead.status === "pending" || lead.status === "error").length === 0}
            className="btn btn-secondary btn-sm gap-1"
          >
            <Play className="h-3 w-3" />
            Run All
          </button>
        </div>

        {/* Connection Check Button */}
        <div className="mb-2">
          <button
            onClick={() => checkConnections()}
            disabled={isChecking || isProcessing}
            className="btn btn-accent btn-sm gap-1 w-full"
            title="Check for accepted connection requests"
          >
            {isChecking ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <UserCheck className="h-3 w-3" />
            )}
            {isChecking ? "Checking..." : "Check Connections"}
          </button>
        </div>

        {/* Add/Import Buttons */}
        <div className="grid grid-cols-2 gap-2 mb-2">
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="btn btn-outline btn-sm gap-1"
          >
            <Plus className="h-3 w-3" />
            Add URLs
          </button>
          <button
            onClick={handleImportCSV}
            className="btn btn-outline btn-sm gap-1"
          >
            <Upload className="h-3 w-3" />
            Import CSV
          </button>
        </div>

        {/* Clear Error Leads Button */}
        {errorLeadsCount > 0 && (
          <div className="mb-3">
            <button
              onClick={() => setShowClearErrorDialog(true)}
              disabled={isClearingErrors}
              className="btn btn-error btn-sm w-full gap-1"
            >
              <Trash2 className="h-3 w-3" />
              {isClearingErrors ? "Removing..." : `Remove ${errorLeadsCount} Error Lead${errorLeadsCount > 1 ? 's' : ''}`}
            </button>
          </div>
        )}


      </div>

      {/* Add URLs Form */}
      {showAddForm && (
        <div className="p-4 border-b border-base-300 bg-base-200">
          <textarea
            placeholder="Paste LinkedIn URLs (one per line)..."
            className="textarea textarea-bordered w-full mb-3 textarea-sm"
            rows={4}
            value={newUrls}
            onChange={(e) => setNewUrls(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={() => handleAddUrls()}
              disabled={!newUrls.trim()}
              className="btn btn-primary btn-sm"
            >
              Add Leads
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="btn btn-ghost btn-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Leads List with Drag and Drop */}
      <div className="flex-1 overflow-y-auto">
        {filteredLeads.length === 0 ? (
          <div className="p-4 text-center text-base-content/60">
            <Link className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No leads yet</p>
            <p className="text-xs">Add LinkedIn URLs to get started</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={filteredLeads.map(lead => lead._id || lead.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="p-2 space-y-2">
                {filteredLeads.map((lead) => (
                  <SortableLeadItem
                    key={lead._id || lead.id}
                    lead={lead}
                    isSelected={(selectedLead?._id || selectedLead?.id) === (lead._id || lead.id)}
                    onSelect={onSelectLead}
                    getDisplayName={getDisplayName}
                    getStatusIcon={getStatusIcon}
                    getStatusColor={getStatusColor}
                    scrapingProgress={scrapingProgress}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Clear Error Leads Confirmation Dialog */}
      {showClearErrorDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-base-100 rounded-lg p-6 max-w-md mx-4">
            <h3 className="font-bold text-lg mb-4">Remove Error Leads</h3>
            <p className="text-base-content/80 mb-6">
              Are you sure you want to remove {errorLeadsCount} error lead{errorLeadsCount > 1 ? 's' : ''}? 
              This action cannot be undone and will also remove any associated posts and messages.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowClearErrorDialog(false)}
                disabled={isClearingErrors}
                className="btn btn-ghost btn-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleClearErrorLeads}
                disabled={isClearingErrors}
                className="btn btn-error btn-sm gap-1"
              >
                {isClearingErrors ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Removing...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3 w-3" />
                    Remove
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
});

export default LeadsColumn;
