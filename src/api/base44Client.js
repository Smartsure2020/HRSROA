// API client that can be configured for local or production use
const USE_MOCK = import.meta.env.VITE_USE_MOCK_AUTH !== 'false';

export const apiClient = {
  auth: {
    me: async () => {
      if (USE_MOCK) {
        return { name: 'Local User', email: 'user@local.test' };
      }
      // Implement real API call here
      // const response = await fetch('/api/auth/me');
      // return response.json();
      throw new Error('Real Auth not implemented yet');
    },
    logout: async () => {
      if (USE_MOCK) return;
      // Implement real logout
    },
    redirectToLogin: () => {
      if (USE_MOCK) {
        console.log('Redirecting to login (Mock)');
        return;
      }
      // window.location.href = '/login';
    },
  }
};

// Keep the old name for compatibility with existing imports
export const base44 = apiClient;
