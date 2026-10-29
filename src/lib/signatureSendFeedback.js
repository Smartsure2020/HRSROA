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
  predecessor_unverifiable:
    'The previous signature request could not be found at the signing provider, so it cannot be confirmed as cancelled. '
    + 'Nothing was sent. Contact support before retrying.',
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

/** Human message for a failed send; falls back to the raw server message. */
export function describeSignatureSendError(err) {
  const code = err?.code || err?.message;
  return SEND_REFUSAL_MESSAGES[code] || err?.message || 'Could not send signature request. Please try again.';
}
