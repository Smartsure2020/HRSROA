import React, { createContext, useState, useContext, useEffect } from 'react';

const AuthContext = createContext();

// Set this to false when you have a real backend to connect to
const USE_MOCK_AUTH = import.meta.env.VITE_USE_MOCK_AUTH !== 'false';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null);

  useEffect(() => {
    checkAppState();
  }, []);

  const checkAppState = async () => {
    setIsLoadingPublicSettings(true);

    if (USE_MOCK_AUTH) {
      // Simulation of successful app load in mock mode
      setAppPublicSettings({ id: 'local', public_settings: {} });
      setIsLoadingPublicSettings(false);
      checkUserAuth();
    } else {
      // When you have a real API, implement the fetch here
      try {
        // const response = await fetch('/api/public-settings');
        // const data = await response.json();
        // setAppPublicSettings(data);
        setIsLoadingPublicSettings(false);
        checkUserAuth();
      } catch (error) {
        setAuthError({ type: 'error', message: 'Failed to load app settings' });
        setIsLoadingPublicSettings(false);
      }
    }
  };

  const checkUserAuth = async () => {
    setIsLoadingAuth(true);

    if (USE_MOCK_AUTH) {
      // Mock user for development
      setUser({ name: 'Local User', email: 'user@local.test' });
      setIsAuthenticated(true);
      setIsLoadingAuth(false);
    } else {
      // Implement real auth check here
      try {
        // const user = await api.getCurrentUser();
        // setUser(user);
        // setIsAuthenticated(true);
      } catch (error) {
        setIsAuthenticated(false);
      } finally {
        setIsLoadingAuth(false);
      }
    }
  };

  const logout = () => {
    setUser(null);
    setIsAuthenticated(false);
    // In production, also clear tokens/cookies and redirect
    if (!USE_MOCK_AUTH) {
      // window.location.href = '/login';
    }
  };

  const navigateToLogin = () => {
    if (USE_MOCK_AUTH) {
      console.log('Login navigation requested (Mock Mode)');
    } else {
      // window.location.href = '/login';
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated, 
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      logout,
      navigateToLogin,
      checkAppState
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
