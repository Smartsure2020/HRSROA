import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase, authProject } from '@/lib/supabaseClient';
import { isCrmSessionHandoffEnabled } from '@/lib/authConfig';
import {
  AUTH_NOTICES,
  captureHandoffFromUrl,
  probeBrokerAuthorisation,
  purgeLegacyAuthStorage,
  signOutLocal,
} from '@/lib/authSession';

const AuthContext = createContext();

// Brokers sign in with their HRS CRM account (the CRM Supabase Auth project). A valid
// CRM session is NOT enough to use ROA: after every sign-in the API confirms the
// person is an approved ROA broker, and the dashboard is only shown once it has.

// The CRM "Open ROA System" link carries session tokens in the query string. They are
// captured and scrubbed from the URL here, at import time, before React renders or any
// effect (including StrictMode's second run) can read the address bar.
const initialHandoff = captureHandoffFromUrl();

const RECOVERY_PATH = '/reset-password';
const browserStorage = () => {
  try { return window.localStorage; } catch { return null; }
};
const isRecoveryRoute = () => typeof window !== 'undefined' && window.location.pathname === RECOVERY_PATH;

const noticeFor = (status) => ({
  denied: AUTH_NOTICES.denied,
  unauthenticated: AUTH_NOTICES.expired,
}[status] || AUTH_NOTICES.unverified);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authNotice, setAuthNotice] = useState('');

  const verifiedUserId = useRef(null);
  const inFlight = useRef(null); // { userId, promise } — de-duplicates concurrent checks

  const clearAuthState = useCallback(() => {
    verifiedUserId.current = null;
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  const endLocalSession = useCallback(
    () => signOutLocal(supabase, { storage: browserStorage(), storageRef: authProject.storageRef }),
    [],
  );

  /** Confirms the CRM session belongs to an approved ROA broker. Resolves to the verdict. */
  const establish = useCallback((session) => {
    const userId = session.user.id;
    // Token refreshes / tab-focus events for a user we already verified change nothing.
    if (verifiedUserId.current === userId) return Promise.resolve('authorised');
    if (inFlight.current?.userId === userId) return inFlight.current.promise;

    const promise = (async () => {
      const verdict = await probeBrokerAuthorisation(session.access_token);

      if (verdict.status === 'authorised') {
        verifiedUserId.current = userId;
        setUser({
          name: session.user.user_metadata?.full_name || verdict.broker.name || verdict.broker.email,
          // Canonical directory address — keeps downstream broker lookups exact.
          email: verdict.broker.email,
        });
        setIsAuthenticated(true);
        setAuthNotice('');
        return 'authorised';
      }

      clearAuthState();
      setAuthNotice(noticeFor(verdict.status));
      // Not approved, or the session is no longer valid: end it. A transient
      // verification failure keeps the session so the broker can simply retry.
      if (verdict.status === 'denied' || verdict.status === 'unauthenticated') {
        await endLocalSession();
      }
      return verdict.status;
    })().finally(() => {
      if (inFlight.current?.userId === userId) inFlight.current = null;
    });

    inFlight.current = { userId, promise };
    return promise;
  }, [clearAuthState, endLocalSession]);

  useEffect(() => {
    let cancelled = false;

    // Remove any pre-cutover ROA-project session left in this browser.
    purgeLegacyAuthStorage(browserStorage(), authProject.storageRef);

    async function init() {
      try {
        if (initialHandoff && isCrmSessionHandoffEnabled()) {
          try {
            await supabase.auth.setSession({
              access_token: initialHandoff.accessToken,
              refresh_token: initialHandoff.refreshToken,
            });
          } catch {
            // An invalid handoff simply falls through to the normal sign-in screen.
          }
        }

        const { data: { session } } = await supabase.auth.getSession();
        // The password-recovery page manages its own session; don't judge it here.
        if (!cancelled && session?.user && !isRecoveryRoute()) {
          await establish(session);
        }
      } catch {
        // Could not read the stored session: fall through to the sign-in screen.
      } finally {
        if (!cancelled) setIsLoadingAuth(false);
      }
    }

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session?.user) {
        clearAuthState();
        return;
      }
      if (event === 'INITIAL_SESSION' || isRecoveryRoute()) return; // init() owns the first check
      // Never call back into supabase-js from inside this callback; defer.
      setTimeout(() => { establish(session); }, 0);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [clearAuthState, establish]);

  /**
   * Bad credentials throw (shown inline). A correct CRM sign-in that ROA then refuses
   * (not an approved broker / could not verify) does not throw: `establish` has already
   * set `authNotice`, which the sign-in screen renders once.
   */
  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return establish(data.session);
  }

  async function signOut() {
    setAuthNotice('');
    await endLocalSession();
    clearAuthState();
  }

  /** Re-runs the access check for the stored session after a transient failure. */
  async function retryAuthorisation() {
    setIsLoadingAuth(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) await establish(session);
    setIsLoadingAuth(false);
  }

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      authNotice,
      signIn,
      logout: signOut,
      retryAuthorisation,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
