export const indeedAccountKeys = {
  all: ['indeedAccounts'],
  lists: () => [...indeedAccountKeys.all, 'list'],
  connect: () => [...indeedAccountKeys.all, 'connect'],
  debug: () => [...indeedAccountKeys.all, 'debug'],
};
