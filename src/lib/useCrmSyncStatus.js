// Shared CRM synchronisation status + retry hook (Phase 3, section 9).
//
// Replaces the old fire-and-forget `.then(r => console.log/console.warn(...))` pattern in
// both AdviceRecord.jsx and CommercialAdviceRecord.jsx with an explicit, visible state
// machine: idle -> syncing -> synced | failed, plus a Retry action that reuses the same
// prepared payload and never re-sends the ROA email or creates a second submission.
import { useCallback, useRef, useState } from 'react';
import { supabase } from './supabaseClient';

/**
 * @param {(formData: object, session: object, existing: {clientId?: string, dealId?: string}) => Promise<object>} syncFn
 */
export function useCrmSyncStatus(syncFn) {
  // 'idle' | 'syncing' | 'synced' | 'failed'
  const [status, setStatus] = useState(/** @type {'idle'|'syncing'|'synced'|'failed'} */ ('idle'));
  const [result, setResult] = useState(null);
  const retryCountRef = useRef(0);
  const resultRef = useRef(null);

  const run = useCallback(async (formData) => {
    setStatus('syncing');
    const attemptAt = () => new Date().toISOString();

    let session;
    try {
      const { data } = await supabase.auth.getSession();
      session = data?.session;
    } catch {
      session = null;
    }

    if (!session) {
      retryCountRef.current += 1;
      const next = { error: 'Not signed in — the CRM record could not be updated.', errorCode: 'no_session', retryCount: retryCountRef.current, lastAttemptAt: attemptAt() };
      resultRef.current = next;
      setResult(next);
      setStatus('failed');
      return;
    }

    const existing = resultRef.current?.clientId
      ? { clientId: resultRef.current.clientId, dealId: resultRef.current.dealId }
      : {};

    let r;
    try {
      r = await syncFn(formData, session, existing);
    } catch (err) {
      r = { success: false, error: 'An unexpected error occurred while syncing to the CRM. Please retry.', errorCode: 'unknown_error' };
    }

    retryCountRef.current += 1;
    const next = {
      clientId: r.clientId ?? existing.clientId,
      dealId: r.dealId ?? existing.dealId,
      error: r.error,
      errorCode: r.errorCode,
      retryCount: retryCountRef.current,
      lastAttemptAt: attemptAt(),
    };
    resultRef.current = next;
    setResult(next);
    setStatus(r.success ? 'synced' : 'failed');
  }, [syncFn]);

  const reset = useCallback(() => {
    retryCountRef.current = 0;
    resultRef.current = null;
    setResult(null);
    setStatus('idle');
  }, []);

  return { status, result, sync: run, retry: run, reset };
}
