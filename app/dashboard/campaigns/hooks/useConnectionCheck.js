"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { connectionCheckApi } from "./api";
import { campaignKeys, leadKeys } from "./queryKeys";

/**
 * Custom hook for checking accepted LinkedIn connections
 * Handles connection acceptance checking with React Query
 */
export function useConnectionCheck() {
  const queryClient = useQueryClient();

  // Check accepted connections mutation
  const checkConnectionsMutation = useMutation({
    mutationFn: connectionCheckApi.checkAcceptedConnections,
    onSuccess: (data) => {
      console.log("✅ Connection check complete:", data);
      
      const { matched, total, messagesSent, checksRemaining, checksLimit } = data;
      
      if (matched > 0) {
        let message = `Found ${matched} accepted connection${matched > 1 ? 's' : ''}!`;
        if (messagesSent > 0) {
          message += ` Sent ${messagesSent} message${messagesSent > 1 ? 's' : ''}.`;
        }
        toast.success(message, { duration: 5000 });
      } else {
        toast.success(
          `Checked ${total} lead${total > 1 ? 's' : ''} - no new acceptances found.`,
          { duration: 4000 }
        );
      }
      
      // Show remaining checks info
      if (checksRemaining !== undefined) {
        toast.success(
          `${checksRemaining}/${checksLimit} connection checks remaining today`,
          { duration: 3000 }
        );
      }
      
      // Invalidate all campaign and lead queries to refresh data
      queryClient.invalidateQueries({ queryKey: campaignKeys.all });
      queryClient.invalidateQueries({ queryKey: leadKeys.all });
      queryClient.invalidateQueries({ queryKey: ['redis-workflow-leads'] });
    },
    onError: (error) => {
      console.error("❌ Connection check failed:", error);
      
      // Check if it's a rate limit error
      if (error.message.includes('limit reached')) {
        toast.error(error.message, { duration: 6000 });
      } else {
        toast.error(`Connection check failed: ${error.message}`, { duration: 5000 });
      }
    },
  });

  return {
    checkConnections: checkConnectionsMutation.mutate,
    isChecking: checkConnectionsMutation.isPending,
    checkResult: checkConnectionsMutation.data,
    error: checkConnectionsMutation.error,
  };
}

