export const rozeeAccountKeys = {
  all: ['rozeeAccounts'],
  lists: () => [...rozeeAccountKeys.all, 'list'],
  detail: (id) => [...rozeeAccountKeys.all, 'detail', id],
  bySessionId: (sessionId) => [...rozeeAccountKeys.all, 'session', sessionId],
  byEmail: (email) => [...rozeeAccountKeys.all, 'email', email],
};
