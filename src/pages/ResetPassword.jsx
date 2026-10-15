import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  exchangeRecoveryLink,
  parseRecoveryLink,
  validateNewPassword,
} from '@/lib/passwordRecovery';
import logoUrl from '@/assets/hrs-logo.png';

// Landing page for the password-recovery email sent from the sign-in screen.
// The recovery runs against the CRM Supabase Auth project, so the new password is the
// broker's HRS CRM password too. Reachable without being signed in (see App.jsx).

const SESSION_WAIT_MS = 4000;
const inputClass = 'w-full rounded-lg border border-white/20 bg-white/10 text-white placeholder:text-white/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-hrs-orange';

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-hrs-blue via-hrs-blue2 to-[#0a1628] flex flex-col items-center justify-center p-6">
      <div className="bg-white rounded-xl px-6 py-4 shadow-2xl mb-6">
        <img src={logoUrl} alt="HRS Insurance" className="h-12" />
      </div>
      <div className="bg-white/10 border border-white/20 rounded-2xl p-8 w-full max-w-sm">
        <h1 className="font-heading text-white text-xl text-center mb-1">Reset password</h1>
        {children}
      </div>
    </div>
  );
}

export default function ResetPassword() {
  const [phase, setPhase] = useState('verifying'); // verifying | ready | invalid | done
  const [message, setMessage] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer;

    const markReady = () => {
      if (cancelled) return;
      clearTimeout(timer);
      setPhase((current) => (current === 'verifying' ? 'ready' : current));
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) markReady();
    });

    (async () => {
      const link = parseRecoveryLink(window.location.search, window.location.hash);
      // Never echo text taken from the URL (error_description is attacker-controllable):
      // anyone can craft a link to this page, so only fixed wording is ever shown.
      if (link.error) {
        setPhase('invalid');
        return;
      }

      try {
        const exchanged = await exchangeRecoveryLink(supabase, link);
        // The one-time credentials are spent; don't leave them in the address bar.
        if (exchanged) window.history.replaceState(window.history.state, '', window.location.pathname);
      } catch {
        if (!cancelled) setPhase('invalid');
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        markReady();
      } else {
        // Fragment tokens are consumed by supabase-js asynchronously; allow a moment.
        timer = setTimeout(() => {
          if (!cancelled) setPhase((current) => (current === 'verifying' ? 'invalid' : current));
        }, SESSION_WAIT_MS);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const problem = validateNewPassword(password, confirmation);
    if (problem) {
      setMessage(problem);
      return;
    }
    setSaving(true);
    setMessage('');
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setPhase('done');
  };

  // Fixed destination — never taken from the URL. A full load re-runs the access check.
  const goToApp = () => window.location.assign('/');

  if (phase === 'verifying') {
    return (
      <Shell>
        <p className="text-white/50 text-sm text-center mt-4">Checking your reset link…</p>
      </Shell>
    );
  }

  if (phase === 'invalid') {
    return (
      <Shell>
        <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-2 mt-4" role="alert">
          This reset link is invalid or has expired. Request a new one from the sign-in screen.
        </p>
        <button
          type="button"
          onClick={goToApp}
          className="w-full mt-4 bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-lg py-2 text-sm font-semibold transition-colors"
        >
          Back to sign in
        </button>
      </Shell>
    );
  }

  if (phase === 'done') {
    return (
      <Shell>
        <p className="text-green-400 text-xs bg-green-400/10 rounded-lg px-3 py-2 mt-4" role="status">
          Your password has been updated. Use it for both the HRS CRM and the Record of Advice system.
        </p>
        <button
          type="button"
          onClick={goToApp}
          className="w-full mt-4 bg-hrs-orange hover:bg-hrs-orange/90 text-white rounded-lg py-2.5 text-sm font-semibold transition-colors"
        >
          Continue
        </button>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="text-white/50 text-sm text-center mb-6">
        Choose a new password. It will also be your HRS CRM password.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-white/70 text-xs mb-1 block" htmlFor="new-password">New password</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label className="text-white/70 text-xs mb-1 block" htmlFor="confirm-password">Confirm new password</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            required
            className={inputClass}
          />
        </div>
        {message && (
          <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-2" role="alert">{message}</p>
        )}
        <button
          type="submit"
          disabled={saving}
          className="w-full bg-hrs-orange hover:bg-hrs-orange/90 text-white rounded-lg py-2.5 text-sm font-semibold transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Update password'}
        </button>
      </form>
    </Shell>
  );
}
