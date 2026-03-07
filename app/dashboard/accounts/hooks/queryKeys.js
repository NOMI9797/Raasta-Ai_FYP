/**
 * Query keys for React Query caching
 * Organized in a hierarchical structure for better cache invalidation
 */

export const linkedinAccountKeys = {
  // Base key for all LinkedIn account-related queries
  all: ['linkedinAccounts'],
  // List of LinkedIn accounts
  lists: () => [...linkedinAccountKeys.all, 'list'],
  // Individual LinkedIn account
  detail: (id) => [...linkedinAccountKeys.all, 'detail', id],
  // LinkedIn account by session ID
  bySessionId: (sessionId) => [...linkedinAccountKeys.all, 'session', sessionId],
  // LinkedIn account by email
  byEmail: (email) => [...linkedinAccountKeys.all, 'email', email],
};
