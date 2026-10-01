// Shared CRM synchronisation status + retry hook (Phase 3, section 9).
//
// Replaces the old fire-and-forget `.then(r => console.log/console.warn(...))` pattern in
// both checklist flows with an explicit, visible state
// machine: idle -> syncing -> synced | failed, plus a Retry action that reuses the same
// prepared payload and never re-sends the ROA email or creates a second submission.
import { useCallback, useRef, useState } from 'react';

/**
 * @param {(submissionId: string) => Promise<object>} syncFn
 */
export function useCrmSyncStatus(syncFn) {
  // 'idle' | 'syncing' | 'synced' | 'failed'
  const [status, setStatus] = useState(/** @type {'idle'|'syncing'|'synced'|'failed'} */ ('idle'));
  const [result, setResult] = useState(null);
  const retryCountRef = useRef(0);
  const resultRef = useRef(null);

  const run = useCallback(async (submissionId) => {
    setStatus('syncing');
    const attemptAt = () => new Date().toISOString();

    let r;
    try {
      const submission = await syncFn(submissionId);
      r = {
        success: ['partial', 'linked'].includes(submission?.crmSyncStatus),
        submission,
        clientId: submission?.crmClientId,
        dealId: submission?.crmDealId,
      };
    } catch (err) {
      r = { success: false, error: err?.message || 'CRM sync failed. Please retry.', errorCode: 'crm_sync_failed' };
    }

    retryCountRef.current += 1;
    const next = {
      submission: r.submission,
      clientId: r.clientId ?? resultRef.current?.clientId,
      dealId: r.dealId ?? resultRef.current?.dealId,
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
