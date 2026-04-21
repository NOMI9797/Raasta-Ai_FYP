/**
 * API client for Rozee.pk accounts. Mirrors linkedinAccountApi but talks to
 * the /api/rozee/* route tree.
 */
export const rozeeAccountApi = {
  fetchAccounts: async () => {
    const response = await fetch('/api/rozee/accounts');
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.message || 'Failed to fetch Rozee accounts');
    }
    return result.accounts;
  },

  connectAccount: async (email, password) => {
    const response = await fetch('/api/rozee/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const result = await response.json();
    if (!result.success) {
      const err = new Error(result.message || 'Failed to connect Rozee account');
      err.debugScreenshots = result.debugScreenshots || [];
      err.errorCode = result.error;
      throw err;
    }
    return result;
  },

  toggleAccountStatus: async ({ accountId, isActive }) => {
    const response = await fetch('/api/rozee/accounts/toggle-active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, isActive }),
    });
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.message || 'Failed to toggle account status');
    }
    return result;
  },

  deleteAccount: async (accountId) => {
    const response = await fetch('/api/rozee/accounts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: accountId }),
    });
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.message || 'Failed to delete Rozee account');
    }
    return result;
  },

  testAccountSession: async (sessionId) => {
    const response = await fetch('/api/rozee/accounts/test-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.message || 'Failed to test Rozee session');
    }
    return result;
  },

  updateAccountDailyLimit: async (accountId, dailyLimit) => {
    const response = await fetch('/api/rozee/accounts/update-limit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, dailyLimit }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update Rozee daily limit');
    }
    return response.json();
  },
};
