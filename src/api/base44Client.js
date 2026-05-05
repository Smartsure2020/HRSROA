// Mock Base44 client for local use
export const base44 = {
  auth: {
    me: async () => ({ name: 'Local User', email: 'user@local.test' }),
    logout: async () => {},
    redirectToLogin: () => {},
  }
};
