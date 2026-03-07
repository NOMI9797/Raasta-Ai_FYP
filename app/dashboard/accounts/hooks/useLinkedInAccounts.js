"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { linkedinAccountKeys } from "./queryKeys";
import { linkedinAccountApi } from "./api";

/**
 * Custom hook for managing LinkedIn accounts using React Query
 * Handles fetching, connecting, toggling, and deleting accounts with automatic caching
 */
export function useLinkedInAccounts() {
  const queryClient = useQueryClient();

  // Fetch LinkedIn accounts with React Query
  const {
    data: accounts = [],
    isLoading: loading,
    error,
    refetch: fetchAccounts,
  } = useQuery({
    queryKey: linkedinAccountKeys.lists(),
    queryFn: linkedinAccountApi.fetchAccounts,
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 2,
  });

  // Connect account mutation
  const connectAccountMutation = useMutation({
    mutationFn: ({ email, password }) => linkedinAccountApi.connectAccount(email, password),
    retry: false, // Disable automatic retries for connection attempts
    onSuccess: () => {
      console.log("✅ LinkedIn account connected successfully");
      // Invalidate and refetch accounts list
      queryClient.invalidateQueries({ queryKey: linkedinAccountKeys.lists() });
    },
    onError: (error) => {
      console.error("❌ Failed to connect LinkedIn account:", error);
    },
  });

  // Toggle account status mutation with optimistic updates
  const toggleAccountStatusMutation = useMutation({
    mutationFn: linkedinAccountApi.toggleAccountStatus,
    onMutate: async ({ accountId, isActive }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: linkedinAccountKeys.lists() });
      
      // Snapshot previous value
      const previousAccounts = queryClient.getQueryData(linkedinAccountKeys.lists());
      
      // Optimistically update
      queryClient.setQueryData(linkedinAccountKeys.lists(), (oldAccounts = []) =>
        oldAccounts.map(account => ({
          ...account,
          isActive: account.id === accountId ? isActive : false
        }))
      );
      
      return { previousAccounts };
    },
    onError: (error, variables, context) => {
      // Rollback on error
      if (context?.previousAccounts) {
        queryClient.setQueryData(linkedinAccountKeys.lists(), context.previousAccounts);
      }
      console.error("Failed to toggle account status:", error);
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: linkedinAccountKeys.lists() });
    },
  });

  // Delete account mutation
  const deleteAccountMutation = useMutation({
    mutationFn: linkedinAccountApi.deleteAccount,
    onSuccess: (_, accountId) => {
      // Remove from cache
      queryClient.setQueryData(linkedinAccountKeys.lists(), (oldAccounts = []) =>
        oldAccounts.filter(account => account.id !== accountId)
      );
    },
    onError: (error) => {
      console.error("Failed to delete account:", error);
    },
  });

  // Update account settings mutation
  const updateAccountSettingsMutation = useMutation({
    mutationFn: linkedinAccountApi.updateAccountSettings,
    onSuccess: (updatedAccount) => {
      // Update the cache
      queryClient.setQueryData(linkedinAccountKeys.lists(), (oldAccounts = []) =>
        oldAccounts.map(account => 
          account.id === updatedAccount.id ? { ...account, ...updatedAccount } : account
        )
      );
    },
    onError: (error) => {
      console.error("Failed to update account settings:", error);
    },
  });

  // Test account session mutation
  const testAccountSessionMutation = useMutation({
    mutationFn: linkedinAccountApi.testAccountSession,
    onSuccess: (result, sessionId) => {
      console.log(`Session test result for ${sessionId}:`, result);
      
      // If session is invalid, update the account status in cache
      if (!result.isValid) {
        queryClient.setQueryData(linkedinAccountKeys.lists(), (oldAccounts = []) =>
          oldAccounts.map(account => 
            account.id === sessionId ? { ...account, isActive: false } : account
          )
        );
      }
    },
    onError: (error) => {
      console.error("Failed to test account session:", error);
    },
  });

  // Update daily limit mutation
  const updateDailyLimitMutation = useMutation({
    mutationFn: ({ accountId, dailyLimit }) => linkedinAccountApi.updateAccountDailyLimit(accountId, dailyLimit),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: linkedinAccountKeys.lists() });
    },
    onError: (error) => {
      console.error("Failed to update daily limit:", error);
    },
  });

  // Connect account function
  const connectAccount = async (email, password) => {
    return connectAccountMutation.mutateAsync({ email, password });
  };

  // Toggle account status function
  const toggleAccountStatus = async (accountId, isActive) => {
    return toggleAccountStatusMutation.mutateAsync({ accountId, isActive });
  };

  // Delete account function
  const deleteAccount = async (accountId) => {
    return deleteAccountMutation.mutateAsync(accountId);
  };

  // Update account settings function
  const updateAccountSettings = async (accountId, settings) => {
    return updateAccountSettingsMutation.mutateAsync({ accountId, settings });
  };

  // Test account session function
  const testAccountSession = async (sessionId) => {
    return testAccountSessionMutation.mutateAsync(sessionId);
  };

  // Update daily limit function
  const updateDailyLimit = async (accountId, dailyLimit) => {
    return updateDailyLimitMutation.mutateAsync({ accountId, dailyLimit });
  };

  // Refresh accounts
  const refreshAccounts = () => {
    fetchAccounts();
  };

  // For backward compatibility, provide setAccounts and setError
  const setAccounts = (updater) => {
    const currentAccounts = queryClient.getQueryData(linkedinAccountKeys.lists()) || [];
    const newAccounts = typeof updater === 'function' ? updater(currentAccounts) : updater;
    queryClient.setQueryData(linkedinAccountKeys.lists(), newAccounts);
  };

  const setError = () => {
    // React Query handles errors automatically, this is just for compatibility
    console.warn("setError is deprecated when using React Query");
  };

  return {
    accounts,
    setAccounts,
    loading,
    error: error?.message || null,
    setError,
    fetchAccounts,
    connectAccount,
    toggleAccountStatus,
    deleteAccount,
    updateAccountSettings,
    testAccountSession,
    updateDailyLimit,
    refreshAccounts,
    // Additional React Query specific properties
    isConnecting: connectAccountMutation.isPending,
    isToggling: toggleAccountStatusMutation.isPending,
    isDeleting: deleteAccountMutation.isPending,
    isUpdating: updateAccountSettingsMutation.isPending,
    isTesting: testAccountSessionMutation.isPending,
    isUpdatingLimit: updateDailyLimitMutation.isPending,
  };
}
