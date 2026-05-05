import React, { createContext, useContext } from 'react';
import { useUser, useClerk } from '@clerk/clerk-react';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const { isLoaded, isSignedIn, user: clerkUser } = useUser();
  const { signOut } = useClerk();

  const user = clerkUser ? {
    name: clerkUser.fullName || clerkUser.firstName || clerkUser.primaryEmailAddress?.emailAddress,
    email: clerkUser.primaryEmailAddress?.emailAddress,
  } : null;

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!isSignedIn,
      isLoadingAuth: !isLoaded,
      isLoadingPublicSettings: false,
      authError: null,
      appPublicSettings: { id: 'hrs', public_settings: {} },
      logout: () => signOut(),
      navigateToLogin: () => {},
      checkAppState: () => {},
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
