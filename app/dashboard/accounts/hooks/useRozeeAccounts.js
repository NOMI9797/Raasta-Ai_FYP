"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { rozeeAccountKeys } from "./rozeeQueryKeys";
import { rozeeAccountApi } from "./rozeeApi";

/**
 * Hook for managing Rozee.pk accounts. Same surface as useLinkedInAccounts,
 * but routed at /api/rozee/* endpoints.
 */
export function useRozeeAccounts() {
  const queryClient = useQueryClient();

  const {
    data: accounts = [],
    isLoading: loading,
    error,
    refetch: fetchAccounts,
  } = useQuery({
    queryKey: rozeeAccountKeys.lists(),
    queryFn: rozeeAccountApi.fetchAccounts,
    staleTime: 1000 * 60 * 5,
    retry: 2,
  });

  const connectAccountMutation = useMutation({
    mutationFn: ({ email, password }) => rozeeAccountApi.connectAccount(email, password),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rozeeAccountKeys.lists() });
    },
  });

  const toggleAccountStatusMutation = useMutation({
    mutationFn: rozeeAccountApi.toggleAccountStatus,
    onMutate: async ({ accountId, isActive }) => {
      await queryClient.cancelQueries({ queryKey: rozeeAccountKeys.lists() });
      const previousAccounts = queryClient.getQueryData(rozeeAccountKeys.lists());
      queryClient.setQueryData(rozeeAccountKeys.lists(), (oldAccounts = []) =>
        oldAccounts.map((account) => ({
          ...account,
          isActive: account.id === accountId ? isActive : false,
        }))
      );
      return { previousAccounts };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousAccounts) {
        queryClient.setQueryData(rozeeAccountKeys.lists(), context.previousAccounts);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: rozeeAccountKeys.lists() });
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: rozeeAccountApi.deleteAccount,
    onSuccess: (_, accountId) => {
      queryClient.setQueryData(rozeeAccountKeys.lists(), (oldAccounts = []) =>
        oldAccounts.filter((account) => account.id !== accountId)
      );
    },
  });

  const testAccountSessionMutation = useMutation({
    mutationFn: rozeeAccountApi.testAccountSession,
    onSuccess: (result, sessionId) => {
      if (!result.isValid) {
        queryClient.setQueryData(rozeeAccountKeys.lists(), (oldAccounts = []) =>
          oldAccounts.map((account) =>
            account.id === sessionId ? { ...account, isActive: false } : account
          )
        );
      }
    },
  });

  const updateDailyLimitMutation = useMutation({
    mutationFn: ({ accountId, dailyLimit }) => rozeeAccountApi.updateAccountDailyLimit(accountId, dailyLimit),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rozeeAccountKeys.lists() });
    },
  });

  return {
    accounts,
    loading,
    error: error?.message || null,
    fetchAccounts,
    connectAccount: (email, password) => connectAccountMutation.mutateAsync({ email, password }),
    toggleAccountStatus: (accountId, isActive) => toggleAccountStatusMutation.mutateAsync({ accountId, isActive }),
    deleteAccount: (accountId) => deleteAccountMutation.mutateAsync(accountId),
    testAccountSession: (sessionId) => testAccountSessionMutation.mutateAsync(sessionId),
    updateDailyLimit: (accountId, dailyLimit) => updateDailyLimitMutation.mutateAsync({ accountId, dailyLimit }),
    isConnecting: connectAccountMutation.isPending,
    isToggling: toggleAccountStatusMutation.isPending,
    isDeleting: deleteAccountMutation.isPending,
    isTesting: testAccountSessionMutation.isPending,
    isUpdatingLimit: updateDailyLimitMutation.isPending,
  };
}
