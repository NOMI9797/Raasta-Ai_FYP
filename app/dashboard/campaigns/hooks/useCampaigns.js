"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { campaignKeys } from "./queryKeys";
import { campaignApi } from "./api";

/**
 * Custom hook for managing campaigns using React Query
 * Handles fetching, creating, and deleting campaigns with automatic caching
 */
export function useCampaigns() {
  const queryClient = useQueryClient();

  // Fetch campaigns with React Query
  const {
    data: campaigns = [],
    isLoading: loading,
    error,
    refetch: fetchCampaigns,
  } = useQuery({
    queryKey: campaignKeys.lists(),
    queryFn: campaignApi.fetchCampaigns,
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 2,
  });

  // Create campaign mutation
  const createCampaignMutation = useMutation({
    mutationFn: campaignApi.createCampaign,
    onSuccess: (newCampaign) => {
      // Optimistically update the cache
      queryClient.setQueryData(campaignKeys.lists(), (oldCampaigns = []) => [
        newCampaign,
        ...oldCampaigns,
      ]);
      toast.success("Campaign created successfully!");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create campaign");
    },
  });

  // Update campaign mutation
  const updateCampaignMutation = useMutation({
    mutationFn: campaignApi.updateCampaign,
    onSuccess: (updatedCampaign) => {
      // Update the cache
      queryClient.setQueryData(campaignKeys.lists(), (oldCampaigns = []) =>
        oldCampaigns.map(campaign => 
          campaign.id === updatedCampaign.id ? updatedCampaign : campaign
        )
      );
      toast.success("Campaign updated successfully!");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update campaign");
    },
  });

  // Delete campaign mutation
  const deleteCampaignMutation = useMutation({
    mutationFn: campaignApi.deleteCampaign,
    onSuccess: (_, campaignId) => {
      // Remove from cache
      queryClient.setQueryData(campaignKeys.lists(), (oldCampaigns = []) =>
        oldCampaigns.filter(campaign => campaign.id !== campaignId)
      );
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: campaignKeys.leads(campaignId) });
      toast.success("Campaign deleted successfully!");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to delete campaign");
    },
  });

  // Create campaign function
  const createCampaign = async (campaignData) => {
    return createCampaignMutation.mutateAsync(campaignData);
  };

  // Update campaign function
  const updateCampaign = async (campaignId, updateData) => {
    return updateCampaignMutation.mutateAsync({ campaignId, updateData });
  };

  // Delete campaign function
  const deleteCampaign = async (campaignId, campaignName) => {
    return deleteCampaignMutation.mutateAsync(campaignId);
  };

  // Refresh campaigns
  const refreshCampaigns = () => {
    fetchCampaigns();
  };

  // For backward compatibility, provide setCampaigns and setError
  const setCampaigns = (updater) => {
    const currentCampaigns = queryClient.getQueryData(campaignKeys.lists()) || [];
    const newCampaigns = typeof updater === 'function' ? updater(currentCampaigns) : updater;
    queryClient.setQueryData(campaignKeys.lists(), newCampaigns);
  };

  const setError = () => {
    // React Query handles errors automatically, this is just for compatibility
    console.warn("setError is deprecated when using React Query");
  };

  return {
    campaigns,
    setCampaigns,
    loading,
    error: error?.message || null,
    setError,
    fetchCampaigns,
    createCampaign,
    updateCampaign,
    deleteCampaign,
    refreshCampaigns,
    // Additional React Query specific properties
    isCreating: createCampaignMutation.isPending,
    isUpdating: updateCampaignMutation.isPending,
    isDeleting: deleteCampaignMutation.isPending,
  };
}
