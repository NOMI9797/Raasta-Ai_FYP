"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import { leadKeys } from "./queryKeys";
import { leadApi } from "./api";

/**
 * Custom hook for managing posts from leads using React Query
 * Handles fetching posts for selected leads with automatic caching
 */
export function usePosts() {
  const queryClient = useQueryClient();
  const [currentLeadId, setCurrentLeadId] = useState(null);

  // Mock posts data for demonstration (fallback when API fails)
  const mockPosts = [
    {
      id: "1",
      content:
        "Just shipped a new feature that reduces API response time by 40%! Sometimes the smallest optimizations make the biggest difference. #webdev #performance",
      timestamp: "2024-01-15T10:30:00Z",
      likes: 24,
      comments: 8,
      reposts: 3,
      url: "https://linkedin.com/posts/johndoe_post1",
    },
    {
      id: "2",
      content:
        "Reflecting on 2023: Built 3 major products, mentored 5 junior developers, and learned that the best code is often the code you don't write. What were your biggest learnings this year?",
      timestamp: "2024-01-10T14:20:00Z",
      likes: 156,
      comments: 42,
      reposts: 18,
      url: "https://linkedin.com/posts/johndoe_post2",
    },
    {
      id: "3",
      content:
        "Hot take: Documentation is not just for other developers - it's for future you. I just spent 2 hours figuring out code I wrote 6 months ago because I skipped the docs. Never again! 📝",
      timestamp: "2024-01-08T09:15:00Z",
      likes: 89,
      comments: 23,
      reposts: 12,
      url: "https://linkedin.com/posts/johndoe_post3",
    },
  ];

  // Fetch posts for a lead with React Query
  const {
    data: posts = [],
    isLoading,
    error,
    refetch,
    dataUpdatedAt,
  } = useQuery({
    queryKey: leadKeys.posts(currentLeadId),
    queryFn: async () => {
      try {
        return await leadApi.fetchLeadPosts(currentLeadId);
      } catch (error) {
        console.warn("API failed, using mock data:", error.message);
        return mockPosts;
      }
    },
    enabled: !!currentLeadId, // Only fetch if leadId is provided
    staleTime: 1000 * 60 * 10, // 10 minutes (posts don't change often)
    retry: (failureCount, error) => {
      // Always return mock data on failure, so don't retry
      return false;
    },
  });

  // Calculate last fetched time from React Query
  const lastFetched = dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : null;

  // Fetch posts for a specific lead
  const fetchPosts = (leadId) => {
    if (!leadId) {
      setCurrentLeadId(null);
      return;
    }
    
    setCurrentLeadId(leadId);
  };

  // Clear posts
  const clearPosts = () => {
    setCurrentLeadId(null);
  };

  // Refresh posts for current lead
  const refreshPosts = (leadId) => {
    if (leadId) {
      setCurrentLeadId(leadId);
    }
    if (currentLeadId) {
      refetch();
    }
  };

  // For backward compatibility, provide setPosts
  const setPosts = (updater) => {
    if (!currentLeadId) return;
    
    const currentPosts = queryClient.getQueryData(leadKeys.posts(currentLeadId)) || [];
    const newPosts = typeof updater === 'function' ? updater(currentPosts) : updater;
    queryClient.setQueryData(leadKeys.posts(currentLeadId), newPosts);
  };

  // Utility functions
  const formatTimestamp = useCallback((timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));

    if (diffInHours < 24) {
      return `${diffInHours}h ago`;
    } else {
      const diffInDays = Math.floor(diffInHours / 24);
      return `${diffInDays}d ago`;
    }
  }, []);

  const formatNumber = useCallback((num) => {
    // Handle undefined, null, or non-numeric values
    if (num === undefined || num === null || isNaN(num)) {
      return '0';
    }
    
    const numValue = Number(num);
    if (numValue >= 1000) {
      return `${(numValue / 1000).toFixed(1)}k`;
    }
    return numValue.toString();
  }, []);

  const calculateEngagement = useCallback((likes, comments, reposts) => {
    const likesNum = Number(likes) || 0;
    const commentsNum = Number(comments) || 0;
    const repostsNum = Number(reposts) || 0;
    return likesNum + (commentsNum * 2) + (repostsNum * 3);
  }, []);

  return {
    posts,
    setPosts,
    isLoading,
    lastFetched,
    error: error?.message || null,
    fetchPosts,
    clearPosts,
    refreshPosts,
    // Utility functions
    formatTimestamp,
    formatNumber,
    calculateEngagement,
    // Additional React Query specific properties
    currentLeadId,
  };
}
