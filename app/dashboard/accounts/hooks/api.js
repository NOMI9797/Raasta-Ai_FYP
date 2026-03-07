/**
 * API functions for LinkedIn accounts
 * These functions will be used by React Query hooks
 */

// LinkedIn Account API functions
export const linkedinAccountApi = {
  // Fetch all LinkedIn accounts
  fetchAccounts: async () => {
    const response = await fetch("/api/linkedin/accounts");
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.message || "Failed to fetch LinkedIn accounts");
    }
    
    return result.accounts;
  },

  // Connect a new LinkedIn account
  connectAccount: async (email, password) => {
    const response = await fetch("/api/linkedin/connect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || "Failed to connect LinkedIn account");
    }

    return result;
  },

  // Toggle account active status
  toggleAccountStatus: async ({ accountId, isActive }) => {
    const response = await fetch("/api/linkedin/accounts/toggle-active", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ accountId, isActive }),
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || "Failed to toggle account status");
    }

    return result;
  },

  // Delete a LinkedIn account
  deleteAccount: async (accountId) => {
    const response = await fetch("/api/linkedin/accounts", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sessionId: accountId }),
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || "Failed to delete LinkedIn account");
    }

    return result;
  },

  // Update account settings (like daily limits, tags, etc.)
  updateAccountSettings: async ({ accountId, settings }) => {
    const response = await fetch(`/api/linkedin/accounts/${accountId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settings),
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || "Failed to update account settings");
    }

    return result;
  },

  // Test account session validity
  testAccountSession: async (sessionId) => {
    const response = await fetch("/api/linkedin/accounts/test-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sessionId }),
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || "Failed to test account session");
    }

    return result;
  },

  // Update account daily limit
  updateAccountDailyLimit: async (accountId, dailyLimit) => {
    const response = await fetch('/api/linkedin/accounts/update-limit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId, dailyLimit })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update daily limit');
    }

    return response.json();
  },
};
