import { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import logoUrl from '@/assets/hrs-logo.png';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetMode, setResetMode] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetStatus, setResetStatus] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setResetLoading(true);
    setResetStatus('');
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResetLoading(false);
    if (resetError) {
      setResetStatus(`error:${resetError.message}`);
    } else {
      setResetStatus('success');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-hrs-blue via-hrs-blue2 to-[#0a1628] flex flex-col items-center justify-center p-6">
      <div className="bg-white rounded-xl px-6 py-4 shadow-2xl mb-6">
        <img src={logoUrl} alt="HRS Insurance" className="h-12" />
      </div>
      <div className="bg-white/10 border border-white/20 rounded-2xl p-8 w-full max-w-sm">
        <h1 className="font-heading text-white text-xl text-center mb-1">Record of Advice</h1>
        <p className="text-white/50 text-sm text-center mb-6">Sign in to continue</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-white/70 text-xs mb-1 block">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-white/20 bg-white/10 text-white placeholder:text-white/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-hrs-orange"
              placeholder="you@hrsinsurance.co.za"
            />
          </div>
          <div>
            <label className="text-white/70 text-xs mb-1 block">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-white/20 bg-white/10 text-white placeholder:text-white/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-hrs-orange"
              placeholder="••••••••"
            />
          </div>
          {error && (
            <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-hrs-orange hover:bg-hrs-orange/90 text-white rounded-lg py-2.5 text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
          <div className="text-center">
            <button
              type="button"
              onClick={() => { setResetMode(m => !m); setResetStatus(''); }}
              className="text-white/50 hover:text-white/80 text-xs underline underline-offset-2 transition-colors"
            >
              Forgot password?
            </button>
          </div>
        </form>

        {resetMode && (
          <form onSubmit={handleResetPassword} className="mt-4 space-y-3 border-t border-white/10 pt-4">
            <p className="text-white/60 text-xs">Enter your email and we'll send a reset link.</p>
            <input
              type="email"
              value={resetEmail}
              onChange={e => setResetEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-white/20 bg-white/10 text-white placeholder:text-white/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-hrs-orange"
              placeholder="you@hrsinsurance.co.za"
            />
            {resetStatus === 'success' && (
              <p className="text-green-400 text-xs bg-green-400/10 rounded-lg px-3 py-2">
                Reset link sent — check your inbox.
              </p>
            )}
            {resetStatus.startsWith('error:') && (
              <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-2">
                {resetStatus.slice(6)}
              </p>
            )}
            <button
              type="submit"
              disabled={resetLoading}
              className="w-full bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-lg py-2 text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {resetLoading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>
        )}

        <p className="text-white/30 text-[0.7rem] text-center mt-6">
          Holistic Risk Services (Pty) Ltd · FSP 28582
        </p>
      </div>
    </div>
  );
}
