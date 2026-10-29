export function buildSignatureSendFeedback(result, recipientEmail) {
  const title = result?.alreadySent
    ? 'Signature request already sent'
    : result?.recovered
      ? 'Signature request recovered'
      : 'Signature request sent';
  return {
    title,
    description: `Sent to ${recipientEmail}. This ROA will update automatically as signing progresses.`,
  };
}

// Why a replacement (amended) revision was NOT sent. Every code here means nothing was
// distributed and no second signing request exists.
const SEND_REFUSAL_MESSAGES = Object.freeze({
  submission_superseded:
    'A newer revision of this ROA exists, so this one can no longer be sent for signature.',
  predecessor_completed:
    'The previous revision was signed while you were amending it. It has been kept as the signed '
    + 'record and nothing was cancelled. Review My ROAs, then send this revision again if you still want it signed.',
  predecessor_cancel_unverified:
    'The previous signature request could not yet be confirmed as cancelled, so nothing was sent. '
    + 'Please try again in a moment.',
  predecessor_cancel_rejected:
    'The signing provider refused to cancel the previous signature request, so nothing was sent.',
  predecessor_status_unavailable:
    'The previous signature request could not be checked just now, so nothing was sent. Please try again shortly.',
  predecessor_audit_backup_failed:
    'Someone has already signed the previous signature request, and its signing audit trail could not be saved just now. '
    + 'The previous request has NOT been cancelled and nothing was sent. Please try again shortly.',
  predecessor_manual_resolution_required:
    'The previous signature request cannot be cancelled safely by the system, so it has been left exactly as it is '
    + 'and nothing was sent. Please contact HRS compliance and quote this ROA reference; they will check the signing provider and resolve it.',
  predecessor_send_in_progress:
    'The previous revision is still being sent. Wait a minute, then try again.',
  predecessor_changed:
    'The previous revision changed while we were checking it. Nothing was sent; please try again.',
  predecessor_provider_unsupported:
    'The previous revision has a live DocuSign signing request, which this app cannot cancel. '
    + 'Void it in DocuSign, refresh My ROAs, then send this revision.',
  predecessor_status_unrecognised:
    'The previous signature request is in a state we do not recognise, so nothing was sent.',
  predecessor_missing: 'The revision this one replaces could not be found, so nothing was sent.',
  revision_chain_inconsistent: 'This revision\'s history could not be verified, so nothing was sent.',
  replacement_gate_failed:
    'The previous signature request could not be safely resolved, so nothing was sent. Please try again.',
  documenso_environment_misconfigured: 'The signing provider is not configured. Nothing was sent.',
});

// Why a person has to take over (reason given with predecessor_manual_resolution_required).
const MANUAL_RESOLUTION_DETAIL = Object.freeze({
  audit_backup_unavailable:
    'Someone has already signed it and the signing audit trail could not be preserved automatically.',
  envelope_missing_unexplained:
    'The signing provider no longer has it and the system did not cancel it.',
  delete_not_dispatched:
    'The signing provider no longer has it, but the system had not yet asked for it to be cancelled.',
  delete_unacknowledged:
    'The signing provider no longer has it, but it never confirmed that it was cancelled by the system.',
});

/** Human message for a failed send; falls back to the raw server message. */
export function describeSignatureSendError(err) {
  const code = err?.code || err?.message;
  const base = SEND_REFUSAL_MESSAGES[code];
  if (code === 'predecessor_manual_resolution_required') {
    const detail = MANUAL_RESOLUTION_DETAIL[err?.data?.reason];
    return detail ? `${detail} ${base}` : base;
  }
  return base || err?.message || 'Could not send signature request. Please try again.';
}

/** Notice shown against a request that is waiting for a person to resolve it. */
export function describeManualResolution(reason) {
  if (!reason) return null;
  return `${MANUAL_RESOLUTION_DETAIL[reason] || 'It cannot be cancelled safely by the system.'} `
    + 'The revision that replaces it has not been sent. Contact HRS compliance with this ROA reference.';
}
