/**
 * Statistics Hook
 * 
 * React Query hooks for fetching and caching campaign statistics
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { statsKeys } from "./queryKeys";

/**
 * Fetch global statistics across all campaigns
 */
export function useGlobalStats() {
  return useQuery({
    queryKey: statsKeys.global(),
    queryFn: async () => {
      const response = await fetch('/api/campaigns/stats');
      if (!response.ok) {
        throw new Error('Failed to fetch statistics');
      }
      const data = await response.json();
      return data.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
    refetchOnMount: true
  });
}

/**
 * Fetch statistics for a specific campaign
 */
export function useCampaignStats(campaignId) {
  return useQuery({
    queryKey: statsKeys.campaign(campaignId),
    queryFn: async () => {
      const response = await fetch(`/api/campaigns/stats?campaignId=${campaignId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch campaign statistics');
      }
      const data = await response.json();
      return data.data;
    },
    enabled: !!campaignId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true
  });
}

