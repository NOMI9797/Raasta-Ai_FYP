"use client";

import { useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

/**
 * Custom hook for bulk message generation
 * Handles generating messages for all completed leads in a campaign
 */
export function useBulkMessageGeneration() {
  const queryClient = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState({
    current: 0,
    total: 0,
    currentLead: null,
    completed: 0,
    failed: 0
  });

  // Get bulk generation statistics
  const getBulkStats = useCallback(async (campaignId) => {
    try {
      const response = await fetch(`/api/messages/generate-bulk?campaignId=${campaignId}`);
      if (!response.ok) {
        console.error('Bulk stats API error:', response.status, response.statusText);
        throw new Error('Failed to fetch bulk generation stats');
      }
      const data = await response.json();
      console.log('Bulk stats response:', data);
      return data;
    } catch (error) {
      console.error('Error fetching bulk stats:', error);
      throw error;
    }
  }, []);

  // Bulk message generation mutation
  const bulkGenerateMutation = useMutation({
    mutationFn: async ({ campaignId, leadIds, model, customPrompt }) => {
      setIsGenerating(true);
      setProgress({ current: 0, total: 0, currentLead: null, completed: 0, failed: 0 });

      try {
        const response = await fetch('/api/messages/generate-bulk', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            campaignId,
            leadIds,
            model,
            customPrompt
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to generate bulk messages');
        }

        return response.json();
      } finally {
        setIsGenerating(false);
        setProgress({ current: 0, total: 0, currentLead: null, completed: 0, failed: 0 });
      }
    },
    onSuccess: (data) => {
      const { successful, failed, processed } = data.data;
      
      // Show success toast with summary
      if (failed === 0) {
        toast.success(`Successfully generated ${successful} messages!`);
      } else {
        toast.success(`Generated ${successful} messages successfully. ${failed} failed.`);
      }

      // Invalidate and refetch related queries
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: (error) => {
      console.error('Bulk message generation error:', error);
      toast.error(error.message || 'Failed to generate bulk messages');
    }
  });

  // Generate messages for all completed leads
  const generateAllMessages = useCallback(async (campaignId, options = {}) => {
    const { model = "llama-3.1-8b-instant", customPrompt } = options;
    
    try {
      // First get stats to show confirmation
      const stats = await getBulkStats(campaignId);
      const { leadsNeedingMessages } = stats.data;
      
      if (leadsNeedingMessages === 0) {
        toast("No completed leads found that need message generation", {
          icon: 'ℹ️',
          duration: 3000,
        });
        return;
      }

      // Start bulk generation
      await bulkGenerateMutation.mutateAsync({
        campaignId,
        model,
        customPrompt
      });

    } catch (error) {
      console.error('Error in generateAllMessages:', error);
      toast.error(error.message || 'Failed to generate messages');
    }
  }, [bulkGenerateMutation, getBulkStats]);

  // Generate messages for specific leads
  const generateMessagesForLeads = useCallback(async (campaignId, leadIds, options = {}) => {
    const { model = "llama-3.1-8b-instant", customPrompt } = options;
    
    try {
      await bulkGenerateMutation.mutateAsync({
        campaignId,
        leadIds,
        model,
        customPrompt
      });
    } catch (error) {
      console.error('Error in generateMessagesForLeads:', error);
      toast.error(error.message || 'Failed to generate messages');
    }
  }, [bulkGenerateMutation]);

  // Get bulk generation statistics for a campaign
  const useBulkStats = (campaignId) => {
    return useQuery({
      queryKey: ['bulk-message-stats', campaignId],
      queryFn: () => getBulkStats(campaignId),
      enabled: !!campaignId,
      staleTime: 1000 * 60 * 2, // 2 minutes
      retry: 2,
    });
  };

  return {
    // State
    isGenerating: isGenerating || bulkGenerateMutation.isPending,
    progress,
    
    // Actions
    generateAllMessages,
    generateMessagesForLeads,
    
    // Data
    useBulkStats,
    
    // Mutation state
    isPending: bulkGenerateMutation.isPending,
    isError: bulkGenerateMutation.isError,
    error: bulkGenerateMutation.error,
    isSuccess: bulkGenerateMutation.isSuccess,
    data: bulkGenerateMutation.data,
  };
}
