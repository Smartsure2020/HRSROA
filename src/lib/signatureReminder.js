// Signature reminder eligibility + feedback, shared by the server endpoint (which enforces it)
// and the UI (which only decides whether to offer the action).
//
// A reminder re-sends the signing email for the EXISTING provider envelope. It never creates an
// envelope, so it is deliberately separate from the idempotent send-for-signature path.

export const REMINDER_COOLDOWN_MS = 5 * 60 * 1000;

// Provider-reported states in which the client can still be nudged.
const REMINDABLE_SIGNING_STATUSES = new Set(['pending', 'sent', 'delivered']);

const BLOCK_REASON_BY_STATUS = {
  completed: 'signature_completed',
  declined: 'signature_declined',
  voided: 'signature_voided',
  expired: 'signature_expired',
};

/**
 * @param {{ provider?: string|null, hasEnvelope?: boolean, status?: string|null, signingStatus?: string|null }} state
 * @returns {string|null} null when a reminder may be sent, otherwise a stable error code.
 */
export function reminderBlockReason({ provider, hasEnvelope, status, signingStatus } = {}) {
  if (!hasEnvelope) return 'no_signature_request';
  if (provider !== 'documenso') return 'reminder_not_supported';
  if (BLOCK_REASON_BY_STATUS[status]) return BLOCK_REASON_BY_STATUS[status];
  const observed = String(signingStatus || '').toLowerCase();
  if (BLOCK_REASON_BY_STATUS[observed]) return BLOCK_REASON_BY_STATUS[observed];
  if (observed === 'rejected') return 'signature_declined';
  if (observed === 'cancelled') return 'signature_voided';
  if (status !== 'awaiting_signature' || !REMINDABLE_SIGNING_STATUSES.has(observed)) {
    return 'not_awaiting_signature';
  }
  return null;
}

/** Seconds left before another reminder is allowed (0 when allowed now). */
export function reminderCooldownSeconds(lastReminderAt, now = Date.now()) {
  const last = Date.parse(lastReminderAt || '');
  if (!Number.isFinite(last)) return 0;
  const remaining = REMINDER_COOLDOWN_MS - (now - last);
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/** UI gate on the broker-facing submission view (camelCase `toClientView` shape). */
export function canOfferSignatureReminder(submission) {
  if (!submission) return false;
  return reminderBlockReason({
    provider: submission.signingProvider,
    hasEnvelope: Boolean(submission.signingEnvelopeId),
    status: submission.status,
    signingStatus: submission.signingStatus,
  }) === null;
}

const ERROR_MESSAGES = {
  no_signature_request: 'No signature request has been sent for this ROA yet.',
  reminder_not_supported: 'Reminders are only available for Documenso signature requests.',
  signature_completed: 'This ROA is already fully signed.',
  signature_declined: 'The signature request was declined, so a reminder cannot be sent.',
  signature_voided: 'The signature request was cancelled, so a reminder cannot be sent.',
  signature_expired: 'The signature request has expired, so a reminder cannot be sent.',
  not_awaiting_signature: 'This ROA is not currently awaiting a signature.',
  client_already_signed: 'The client has already signed. This ROA is awaiting the broker countersignature.',
  signature_request_not_active: 'The signature request is no longer active, so a reminder cannot be sent.',
  reminder_too_soon: 'A reminder was sent very recently. Please wait a few minutes before sending another.',
  reminder_failed: 'The signing provider could not send the reminder. Please try again shortly.',
};

export function signatureReminderErrorMessage(code) {
  return ERROR_MESSAGES[code] || 'Could not send the reminder. Please try again.';
}

export function buildSignatureReminderFeedback(recipientEmail) {
  return {
    title: 'Reminder sent',
    description: `A signature reminder was sent to ${recipientEmail || 'the client'} for the existing request. No new request was created.`,
  };
}
