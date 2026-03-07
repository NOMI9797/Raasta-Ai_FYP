"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";
import { campaignKeys, leadKeys } from "./queryKeys";
import { campaignApi, leadApi } from "./api";

/**
 * Custom hook for managing leads in campaigns using React Query
 * Handles fetching leads from campaigns and adding new leads with caching
 */
export function useLeads() {
  const queryClient = useQueryClient();
  const [currentCampaignId, setCurrentCampaignId] = useState(null);

  // Fetch leads for a campaign with React Query
  const {
    data: leads = [],
    isLoading: loading,
    error,
    refetch: refetchLeads,
  } = useQuery({
    queryKey: campaignKeys.leads(currentCampaignId),
    queryFn: () => campaignApi.fetchCampaignLeads(currentCampaignId),
    enabled: !!currentCampaignId, // Only fetch if campaignId is provided
    staleTime: 1000 * 60 * 2, // 2 minutes
    retry: 2,
  });

  // Add leads mutation
  const addLeadsMutation = useMutation({
    mutationFn: leadApi.addLeads,
    onSuccess: (newLeads, { campaignId }) => {
      // Optimistically update the cache by refetching leads
      queryClient.invalidateQueries({ queryKey: campaignKeys.leads(campaignId) });
      toast.success(`Successfully added ${newLeads?.length || 0} leads!`);
      return newLeads;
    },
    onError: (error) => {
      toast.error(error.message || "Failed to add leads to campaign");
    },
  });

  // Update lead mutation
  const updateLeadMutation = useMutation({
    mutationFn: leadApi.updateLead,
    onSuccess: (_, { leadId, updateData }) => {
      // Update the lead in all relevant caches
      if (currentCampaignId) {
        queryClient.setQueryData(campaignKeys.leads(currentCampaignId), (oldLeads = []) =>
          oldLeads.map(lead => 
            (lead._id || lead.id) === leadId 
              ? { ...lead, ...updateData }
              : lead
          )
        );
      }
    },
    onError: (error) => {
      console.warn('Error updating lead:', error);
    },
  });

  // Fetch leads for a specific campaign
  const fetchLeads = (campaignId) => {
    if (!campaignId) {
      setCurrentCampaignId(null);
      return;
    }
    
    setCurrentCampaignId(campaignId);
  };

  // Add new leads to a campaign
  const addLeads = async (campaignId, urls) => {
    if (!campaignId || !urls || urls.length === 0) {
      toast.error("Please provide valid campaign ID and URLs");
      return false;
    }

    return addLeadsMutation.mutateAsync({ campaignId, urls });
  };

  // Update a single lead
  const updateLead = async (leadId, updateData) => {
    if (!leadId) return false;

    try {
      await updateLeadMutation.mutateAsync({ leadId, updateData });
      return true;
    } catch (error) {
      return false;
    }
  };

  // Refresh leads for current campaign
  const refreshLeads = (campaignId) => {
    if (campaignId) {
      setCurrentCampaignId(campaignId);
    }
    if (currentCampaignId) {
      refetchLeads();
    }
  };

  // Clear leads state
  const clearLeads = () => {
    setCurrentCampaignId(null);
  };

  // For backward compatibility, provide setLeads and setError
  const setLeads = (updater) => {
    if (!currentCampaignId) return;
    
    const currentLeads = queryClient.getQueryData(campaignKeys.leads(currentCampaignId)) || [];
    const newLeads = typeof updater === 'function' ? updater(currentLeads) : updater;
    queryClient.setQueryData(campaignKeys.leads(currentCampaignId), newLeads);
  };

  const setError = () => {
    // React Query handles errors automatically, this is just for compatibility
    console.warn("setError is deprecated when using React Query");
  };

  return {
    leads,
    setLeads,
    loading,
    error: error?.message || null,
    setError,
    fetchLeads,
    addLeads,
    updateLead,
    refreshLeads,
    clearLeads,
    // Additional React Query specific properties
    isAddingLeads: addLeadsMutation.isPending,
    isUpdatingLead: updateLeadMutation.isPending,
    currentCampaignId,
  };
}
