"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { indeedAccountKeys } from "./indeedQueryKeys";
import { indeedAccountApi } from "./indeedApi";

/**
 * Hook for managing Indeed accounts. Same surface as useRozeeAccounts, except connecting: `startConnect` opens a
 * sign-in window on the server's screen and `connectAttempt` follows it until it is connected, failed or cancelled.
 */
export function useIndeedAccounts() {
  const queryClient = useQueryClient();

  const {
    data: accounts = [],
    isLoading: loading,
    error,
    refetch: fetchAccounts,
  } = useQuery({
    queryKey: indeedAccountKeys.lists(),
    queryFn: indeedAccountApi.fetchAccounts,
    staleTime: 1000 * 60 * 5,
    retry: 2,
  });

  // Follows the sign-in window; checks every 2 seconds while it is open and picks up an attempt that was started earlier
  const { data: connectAttempt = { status: "idle" } } = useQuery({
    queryKey: indeedAccountKeys.connect(),
    queryFn: async () => {
      const attempt = await indeedAccountApi.fetchConnectStatus();
      if (attempt.status === "connected") queryClient.invalidateQueries({ queryKey: indeedAccountKeys.lists() });
      return attempt;
    },
    refetchInterval: (query) => (query.state.data?.status === "waiting" ? 2000 : false),
    staleTime: 0,
  });

  const startConnectMutation = useMutation({
    mutationFn: indeedAccountApi.startConnect,
    retry: false,
    onSuccess: (attempt) => queryClient.setQueryData(indeedAccountKeys.connect(), attempt),
  });

  const cancelConnectMutation = useMutation({
    mutationFn: indeedAccountApi.cancelConnect,
    onSuccess: (attempt) => queryClient.setQueryData(indeedAccountKeys.connect(), attempt),
  });

  const toggleAccountStatusMutation = useMutation({
    mutationFn: indeedAccountApi.toggleAccountStatus,
    onMutate: async ({ accountId, isActive }) => {
      await queryClient.cancelQueries({ queryKey: indeedAccountKeys.lists() });
      const previousAccounts = queryClient.getQueryData(indeedAccountKeys.lists());
      queryClient.setQueryData(indeedAccountKeys.lists(), (oldAccounts = []) =>
        oldAccounts.map((account) => ({
          ...account,
          // Switching one on switches the person's other accounts off (their own only)
          isActive: account.id === accountId ? isActive : account.own && isActive ? false : account.isActive,
        }))
      );
      return { previousAccounts };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousAccounts) {
        queryClient.setQueryData(indeedAccountKeys.lists(), context.previousAccounts);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: indeedAccountKeys.lists() });
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: indeedAccountApi.deleteAccount,
    onSuccess: (_, accountId) => {
      queryClient.setQueryData(indeedAccountKeys.lists(), (oldAccounts = []) =>
        oldAccounts.filter((account) => account.id !== accountId)
      );
    },
  });

  const testAccountSessionMutation = useMutation({
    mutationFn: indeedAccountApi.testAccountSession,
    onSuccess: (result, sessionId) => {
      if (!result.isValid) {
        queryClient.setQueryData(indeedAccountKeys.lists(), (oldAccounts = []) =>
          oldAccounts.map((account) =>
            account.id === sessionId ? { ...account, isActive: false } : account
          )
        );
      }
    },
  });

  const { data: debugInfo = { publishDebugging: false, runs: [] }, refetch: refreshDebugRuns } = useQuery({
    queryKey: indeedAccountKeys.debug(),
    queryFn: indeedAccountApi.fetchDebugRuns,
    staleTime: 0,
  });

  const runDiagnosticMutation = useMutation({
    mutationFn: indeedAccountApi.runDiagnostic,
    retry: false,
    onSettled: () => refreshDebugRuns(),
  });

  return {
    accounts,
    loading,
    debugInfo,
    runDiagnostic: (sessionId, visible) => runDiagnosticMutation.mutateAsync({ sessionId, visible }),
    isDiagnosing: runDiagnosticMutation.isPending,
    error: error?.message || null,
    fetchAccounts,
    connectAttempt,
    startConnect: (email) => startConnectMutation.mutateAsync(email),
    cancelConnect: () => cancelConnectMutation.mutateAsync(),
    toggleAccountStatus: (accountId, isActive) => toggleAccountStatusMutation.mutateAsync({ accountId, isActive }),
    deleteAccount: (accountId) => deleteAccountMutation.mutateAsync(accountId),
    testAccountSession: (sessionId) => testAccountSessionMutation.mutateAsync(sessionId),
    isStarting: startConnectMutation.isPending,
    isCancelling: cancelConnectMutation.isPending,
    isToggling: toggleAccountStatusMutation.isPending,
    isDeleting: deleteAccountMutation.isPending,
    isTesting: testAccountSessionMutation.isPending,
  };
}
