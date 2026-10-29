// Replacement gate for amended ROAs (Issue #8).
//
// A replacement revision may only be distributed for signature once the revision it
// replaces can no longer be signed. This module is the single place that decides that,
// and it fails closed: unless every branch below ends in a positively verified "the
// previous request is not live", the replacement stays unsent and the broker is told why.
//
// Nothing here runs when the broker merely OPENS the amendment editor (an abandoned edit
// must never void a live request). It runs at "controlled finalisation": the broker's
// first attempt to send the replacement.
//
//   predecessor state                         what happens
//   ----------------------------------------  --------------------------------------------
//   completed / declined / voided / expired   nothing live → send proceeds
//   submitted / signature_failed, no envelope never sent → send proceeds
//   awaiting_signature, no envelope yet       reconcile by externalId: adopt-and-cancel the
//                                             orphan, or release the reservation
//   live Documenso envelope                   re-read it; then, by LIVE status:
//       COMPLETED                               abort — keep it as the signed record,
//                                               reconcile its evidence, block this send
//       REJECTED / CANCELLED                    record it, send proceeds
//       PENDING / DRAFT                         persist intent → capture audit log (best
//                                               effort) → delete → VERIFY by re-reading →
//                                               mark voided (compare-and-swap) → proceed
//       404 / anything else                     block (404 only counts as "cancelled" when
//                                               our own persisted intent says we asked)
//   live DocuSign (legacy) envelope           block — this app cannot cancel it
//
// Every step is safe to repeat: the intent marker lives in signing_meta.supersession and
// the database writes are compare-and-swap on status + completed_at, so a double click,
// a second tab or a retry after a timeout converges on the same result and never
// produces two live signing requests.

import {
  deleteDocumensoEnvelope,
  downloadDocumensoAuditLog,
  findDocumensoEnvelopeByExternalId,
  getDocumensoEnvelope,
  isDocumensoConfigured,
} from './documensoClient.js';
import { refreshViaDocumenso, reservationMayStillBeInFlight } from './documensoSigning.js';
import {
  ensurePdfStored,
  loadSubmissionForBroker,
  markSupersededVoided,
  recordSupersessionIntent,
  releaseSigningReservation,
  StoragePaths,
  updateSubmission,
} from './submissionRepo.js';
import { sha256HexOfBytes } from './sha256.js';
import { hasSigningEnvelope, signingProviderFor } from './signingLifecycle.js';

const NOT_LIVE_STATUSES = new Set(['completed', 'declined', 'voided', 'expired']);

export class SupersessionError extends Error {
  constructor(code, status, extra = {}) {
    super(code);
    this.name = 'SupersessionError';
    this.code = code;
    this.status = status;
    Object.assign(this, extra);
  }
}

function settled(predecessor, outcome) {
  return { required: true, outcome, predecessor };
}

const upper = (value) => String(value || '').toUpperCase();

/** Recipient progress without any personal data: order, role and signing state only. */
function summariseRecipients(envelope) {
  const recipients = Array.isArray(envelope?.recipients) ? envelope.recipients : [];
  return recipients.map((recipient) => ({
    signingOrder: Number.isFinite(Number(recipient?.signingOrder)) ? Number(recipient.signingOrder) : null,
    role: recipient?.role ? String(recipient.role) : null,
    signingStatus: upper(recipient?.signingStatus) || null,
  }));
}

/**
 * Ensures the revision a replacement supersedes cannot be signed any more.
 *
 * @param {{ replacement: object, broker: object }} args  the replacement DB row and the
 *   authorised broker (both rows must belong to this broker).
 * @returns {Promise<{ required: boolean, outcome: string, predecessor?: object }>}
 * @throws {SupersessionError} whenever the replacement must not be sent yet.
 */
export async function resolvePredecessorForReplacement({ replacement, broker }) {
  const predecessorId = replacement?.supersedes_submission_id;
  if (!predecessorId) return { required: false, outcome: 'not_required' };

  const predecessor = await loadSubmissionForBroker(predecessorId, broker);
  if (!predecessor) throw new SupersessionError('predecessor_missing', 409);
  if (predecessor.superseded_by_submission_id !== replacement.id) {
    throw new SupersessionError('revision_chain_inconsistent', 409);
  }
  return settlePredecessor({ predecessor, replacement, broker });
}

async function settlePredecessor({ predecessor, replacement, broker }) {
  if (NOT_LIVE_STATUSES.has(predecessor.status)) return settled(predecessor, 'predecessor_not_live');

  if (!hasSigningEnvelope(predecessor)) {
    // Never sent (submitted / signature_failed): nothing can be signed.
    if (predecessor.status !== 'awaiting_signature') return settled(predecessor, 'predecessor_not_live');
    return settleUnconfirmedSend({ predecessor, replacement, broker });
  }

  if (signingProviderFor(predecessor) !== 'documenso') {
    // A live DocuSign envelope cannot be cancelled from here. Fail closed.
    throw new SupersessionError('predecessor_provider_unsupported', 409, { predecessor });
  }
  if (!isDocumensoConfigured()) throw new SupersessionError('documenso_environment_misconfigured', 500);
  return settleLiveDocumenso({ predecessor, replacement, broker });
}

/**
 * The predecessor reserved a send but never recorded an envelope (a lost response, a
 * crash). Mirrors sendViaDocumenso's own recovery: look the envelope up by externalId.
 */
async function settleUnconfirmedSend({ predecessor, replacement, broker }) {
  if (predecessor.signing_provider !== 'documenso') {
    throw new SupersessionError('predecessor_provider_unsupported', 409, { predecessor });
  }
  if (!isDocumensoConfigured()) throw new SupersessionError('documenso_environment_misconfigured', 500);
  if (reservationMayStillBeInFlight(predecessor.sent_for_signature_at)) {
    throw new SupersessionError('predecessor_send_in_progress', 409, { retryable: true, predecessor });
  }

  let found;
  try {
    found = await findDocumensoEnvelopeByExternalId(predecessor.id);
  } catch {
    throw new SupersessionError('predecessor_status_unavailable', 503, { retryable: true, predecessor });
  }

  if (!found?.id) {
    await releaseSigningReservation(predecessor.id, broker, 'documenso', {
      reason: 'superseded_before_send_confirmed',
    });
    const reloaded = await loadSubmissionForBroker(predecessor.id, broker);
    if (reloaded && hasSigningEnvelope(reloaded)) {
      // Someone recorded an envelope while we were releasing. Re-evaluate on retry.
      throw new SupersessionError('predecessor_changed', 409, { retryable: true, predecessor: reloaded });
    }
    return settled(reloaded || predecessor, 'predecessor_not_live');
  }

  const adopted = await updateSubmission(predecessor.id, {
    signing_provider: 'documenso',
    signing_envelope_id: found.id,
    signing_status: String(found.status || 'pending').toLowerCase(),
    signing_meta: { ...(predecessor.signing_meta || {}), externalId: predecessor.id },
  });
  return settleLiveDocumenso({ predecessor: adopted, replacement, broker });
}

async function settleLiveDocumenso({ predecessor, replacement, broker }) {
  let envelope;
  try {
    envelope = await getDocumensoEnvelope(predecessor.signing_envelope_id);
  } catch (err) {
    if (err?.status === 404) return settleMissingEnvelope({ predecessor, replacement, broker });
    throw new SupersessionError('predecessor_status_unavailable', 503, { retryable: true, predecessor });
  }

  const observed = upper(envelope?.status);
  if (observed === 'COMPLETED') return abortForCompletion({ predecessor, broker });
  if (observed === 'REJECTED' || observed === 'CANCELLED') {
    return settled(await recordProviderTerminal(predecessor, observed), 'predecessor_not_live');
  }
  if (observed === 'PENDING' || observed === 'DRAFT') {
    return cancelLiveEnvelope({ predecessor, replacement, broker, envelope, observed });
  }
  throw new SupersessionError('predecessor_status_unrecognised', 409, { predecessor });
}

/**
 * The provider no longer knows the envelope. That is only accepted as "cancelled" when our
 * own persisted intent shows we asked for it (a previous attempt that died after the
 * provider acted but before we recorded it). Any other 404 could be a wrong environment,
 * a different account or a deletion we cannot explain — so it blocks.
 */
async function settleMissingEnvelope({ predecessor, replacement, broker }) {
  const fresh = (await loadSubmissionForBroker(predecessor.id, broker)) || predecessor;
  const intent = fresh.signing_meta?.supersession;
  if (NOT_LIVE_STATUSES.has(fresh.status)) return settled(fresh, 'predecessor_not_live');
  if (intent?.cancelRequestedAt && intent.replacementId === replacement.id) {
    return finaliseVoided({
      predecessor: fresh,
      broker,
      supersession: { ...intent, verifiedBy: 'not_found_after_requested_cancel' },
      outcome: 'predecessor_already_cancelled',
    });
  }
  throw new SupersessionError('predecessor_unverifiable', 409, { predecessor: fresh });
}

/**
 * The previous request completed (possibly while the broker was amending). It stays the
 * signed record: its evidence is reconciled and the stale cancellation is abandoned. The
 * send is blocked this once so the broker consciously re-confirms; the retry then passes
 * because a completed predecessor has nothing live left to cancel.
 */
async function abortForCompletion({ predecessor, broker }) {
  let reconciled = predecessor;
  try {
    const result = await refreshViaDocumenso({ submissionId: predecessor.id, row: predecessor, broker });
    reconciled = result.row || predecessor;
  } catch (err) {
    console.error('supersession: reconcile of completed predecessor failed', err?.message);
  }
  throw new SupersessionError('predecessor_completed', 409, { predecessor: reconciled });
}

async function recordProviderTerminal(predecessor, observed) {
  const status = observed === 'REJECTED' ? 'declined' : 'voided';
  return updateSubmission(predecessor.id, { status, signing_status: observed.toLowerCase() });
}

async function observeEnvelope(envelopeId) {
  try {
    const envelope = await getDocumensoEnvelope(envelopeId);
    const status = upper(envelope?.status);
    if (status === 'CANCELLED') return { state: 'cancelled' };
    if (status === 'COMPLETED') return { state: 'completed' };
    if (status === 'REJECTED') return { state: 'rejected' };
    if (status === 'PENDING' || status === 'DRAFT') return { state: 'live' };
    return { state: 'unknown' };
  } catch (err) {
    if (err?.status === 404) return { state: 'gone' };
    return { state: 'unknown' };
  }
}

/**
 * Best effort: keep a copy of the provider's audit log before a partially-signed request
 * is withdrawn (the vendor documents deletion of a pending envelope as irreversible and
 * does not say whether its audit trail survives). A failure never blocks the amendment —
 * the recipient progress is recorded in signing_meta regardless.
 */
async function captureAuditLog({ predecessor, envelopeId, now }) {
  const previous = predecessor.signing_meta?.supersession?.auditLog;
  if (previous?.sha256) return previous;
  try {
    const bytes = await downloadDocumensoAuditLog(envelopeId);
    const sha256 = sha256HexOfBytes(bytes);
    const path = StoragePaths.supersededAuditLog(predecessor.id);
    await ensurePdfStored(path, bytes, { expectedSha256: sha256 });
    return { path, sha256, capturedAt: now };
  } catch (err) {
    console.error('supersession: audit-log capture failed', err?.message);
    return { captured: false };
  }
}

async function cancelLiveEnvelope({ predecessor, replacement, broker, envelope, observed }) {
  const envelopeId = predecessor.signing_envelope_id;
  const now = new Date().toISOString();
  const recipients = summariseRecipients(envelope);
  const baseMeta = { ...(predecessor.signing_meta || {}) };
  const supersession = {
    ...(baseMeta.supersession || {}),
    replacementId: replacement.id,
    cancelRequestedAt: baseMeta.supersession?.cancelRequestedAt || now,
    observedStatus: observed,
    recipients,
  };

  // 1. Persist the intent BEFORE touching the provider, so a crash after the provider acts
  //    is recoverable (a later 404 is then a verified cancellation, not a mystery).
  const withIntent = await recordSupersessionIntent(predecessor.id, broker, { ...baseMeta, supersession });
  if (!withIntent) {
    const latest = await loadSubmissionForBroker(predecessor.id, broker);
    if (latest?.status === 'completed') return abortForCompletion({ predecessor: latest, broker });
    if (latest && NOT_LIVE_STATUSES.has(latest.status)) return settled(latest, 'predecessor_already_cancelled');
    throw new SupersessionError('predecessor_changed', 409, { retryable: true, predecessor: latest || predecessor });
  }

  // 2. Preserve what the provider can still tell us about a partially signed request.
  if (observed === 'PENDING' && recipients.some((r) => r.signingStatus === 'SIGNED')) {
    supersession.auditLog = await captureAuditLog({ predecessor, envelopeId, now });
    // Persist the pointer before the provider can destroy the original, so a crash between
    // the delete and the final write cannot orphan the captured copy.
    await recordSupersessionIntent(predecessor.id, broker, { ...baseMeta, supersession });
  }

  // 3. Ask the provider to withdraw it. A definite 4xx rejection means it is still live;
  //    a 5xx / network failure is ambiguous. Neither is trusted — step 4 decides.
  let deleteError = null;
  try {
    await deleteDocumensoEnvelope(envelopeId);
  } catch (err) {
    deleteError = err;
  }
  const definitelyRejected = Boolean(deleteError)
    && Number.isFinite(deleteError.status)
    && deleteError.status < 500
    && deleteError.status !== 404;

  // 4. VERIFY by re-reading the envelope. A success response is never taken as proof.
  const verdict = await observeEnvelope(envelopeId);

  if (verdict.state === 'completed') {
    // Completed concurrently: abandon the stale cancellation, keep it as the signed record.
    const latest = await loadSubmissionForBroker(predecessor.id, broker);
    return abortForCompletion({ predecessor: latest || predecessor, broker });
  }
  if (verdict.state === 'rejected') {
    return settled(await recordProviderTerminal(predecessor, 'REJECTED'), 'predecessor_not_live');
  }
  if (verdict.state === 'live') {
    throw new SupersessionError(
      definitelyRejected ? 'predecessor_cancel_rejected' : 'predecessor_cancel_unverified',
      definitelyRejected ? 502 : 503,
      { retryable: true, predecessor },
    );
  }
  if (verdict.state === 'unknown' || definitelyRejected) {
    throw new SupersessionError('predecessor_cancel_unverified', 503, { retryable: true, predecessor });
  }

  // 'gone' or 'cancelled': verified.
  return finaliseVoided({
    predecessor,
    broker,
    supersession: { ...supersession, cancelledAt: new Date().toISOString(), verifiedBy: verdict.state },
    outcome: 'predecessor_cancelled',
  });
}

async function finaliseVoided({ predecessor, broker, supersession, outcome }) {
  const meta = { ...(predecessor.signing_meta || {}), supersession };
  const voided = await markSupersededVoided(predecessor.id, broker, meta);
  if (voided) return settled(voided, outcome);

  // The compare-and-swap found the row already moved on.
  const latest = await loadSubmissionForBroker(predecessor.id, broker);
  if (latest?.status === 'voided') return settled(latest, 'predecessor_already_cancelled');
  if (latest?.status === 'completed') throw new SupersessionError('predecessor_completed', 409, { predecessor: latest });
  if (latest && NOT_LIVE_STATUSES.has(latest.status)) return settled(latest, 'predecessor_not_live');
  throw new SupersessionError('predecessor_changed', 409, { retryable: true, predecessor: latest || predecessor });
}
