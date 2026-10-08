/**
 * API client for Indeed accounts. Connecting is different from LinkedIn and Rozee.pk: there is no password form.
 * The server opens a browser window on Indeed, the person signs in there, and the client polls for the result
 * (see libs/indeed-connect.js).
 */
const jsonHeaders = { 'Content-Type': 'application/json' };

async function readJson(response) {
  return response.json().catch(() => ({}));
}

export const indeedAccountApi = {
  fetchAccounts: async () => {
    const result = await readJson(await fetch('/api/indeed/accounts'));
    if (!result.success) {
      throw new Error(result.message || 'Failed to fetch Indeed accounts');
    }
    return result.accounts;
  },

  // Opens the sign-in window. Returns at once with the attempt; the result arrives through fetchConnectStatus.
  startConnect: async (email) => {
    const response = await fetch('/api/indeed/connect', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email }) });
    const result = await readJson(response);
    if (!response.ok) {
      const err = new Error(result.message || 'Could not open the Indeed sign-in window');
      err.errorCode = result.error;
      throw err;
    }
    return result.attempt;
  },

  fetchConnectStatus: async () => {
    const result = await readJson(await fetch('/api/indeed/connect'));
    return result.attempt || { status: 'idle' };
  },

  cancelConnect: async () => {
    const result = await readJson(await fetch('/api/indeed/connect', { method: 'DELETE' }));
    return result.attempt || { status: 'idle' };
  },

  toggleAccountStatus: async ({ accountId, isActive }) => {
    const result = await readJson(await fetch('/api/indeed/accounts/toggle-active', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ accountId, isActive }),
    }));
    if (!result.success) {
      throw new Error(result.error || 'Failed to toggle account status');
    }
    return result;
  },

  deleteAccount: async (accountId) => {
    const result = await readJson(await fetch('/api/indeed/accounts', {
      method: 'DELETE',
      headers: jsonHeaders,
      body: JSON.stringify({ sessionId: accountId }),
    }));
    if (!result.success) {
      throw new Error(result.message || result.error || 'Failed to disconnect Indeed account');
    }
    return result;
  },

  // Read-only visit to the employer area that records what the automation sees (libs/indeed-diagnose.js)
  runDiagnostic: async ({ sessionId, visible }) => {
    const response = await fetch('/api/indeed/accounts/debug', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ sessionId, visible: Boolean(visible) }),
    });
    const result = await readJson(response);
    if (!response.ok) {
      throw new Error(result.message || result.error || 'The diagnostic could not run');
    }
    return result;
  },

  fetchDebugRuns: async () => {
    const result = await readJson(await fetch('/api/indeed/accounts/debug'));
    return { publishDebugging: Boolean(result.publishDebugging), runs: result.runs || [] };
  },

  testAccountSession: async (sessionId) => {
    const result = await readJson(await fetch('/api/indeed/accounts/test-session', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ sessionId }),
    }));
    if (!result.success) {
      throw new Error(result.message || result.error || 'Failed to test Indeed session');
    }
    return result;
  },
};
