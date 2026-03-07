import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";

/**
 * Redis Pre-Fetch Hook
 * 
 * Handles pre-fetching all campaigns and leads to Redis cache
 * when user visits the campaigns page
 */
export function useRedisPreFetch() {
  const preFetchMutation = useMutation({
    mutationFn: async (userId) => {
      console.log(`📥 Pre-Fetch: POST /api/redis-workflow/campaigns/pre-fetch { userId: ${userId} }`);
      const response = await fetch('/api/redis-workflow/campaigns/pre-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to pre-fetch campaigns');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      console.log(`✅ Pre-Fetch: cached ${data.data.campaignsCount} campaigns and ${data.data.totalLeadsCached} leads to Redis`);
    },
    onError: (error) => {
      console.error('❌ Pre-Fetch failed:', error?.message || error);
      toast.error(`Pre-fetch failed: ${error.message}`);
    }
  });

  const preFetchCampaigns = (userId) => {
    preFetchMutation.mutate(userId);
  };

  return {
    preFetchCampaigns,
    isPreFetching: preFetchMutation.isPending,
    preFetchError: preFetchMutation.error
  };
}
