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
//       PENDING / DRAFT                         see "cancelling" below
//       404                                     proof only if the provider ACKNOWLEDGED our
//                                               own delete; otherwise manual resolution
//   live DocuSign (legacy) envelope           block — this app cannot cancel it
//
// Cancelling a PENDING / DRAFT envelope (cancelLiveEnvelope), in this order:
//   1. persist the INTENT (a marker only — it proves nothing about the provider);
//   2. if anyone may already have signed: preserve the provider's audit log — downloaded,
//      stored, read back and hash-verified — BEFORE anything is deleted. If that cannot be
//      done the request is left exactly as it is (retryable, then manual resolution);
//   3. re-read the envelope immediately before the delete, so the cancellation acts on a
//      fresh observation, not the one taken before the (slow) backup;
//   4. persist that the delete is being DISPATCHED, then send it;
//   5. persist the provider's ACKNOWLEDGEMENT (a 2xx) of that delete;
//   6. VERIFY by re-reading: only "gone"/"cancelled" after an acknowledged delete, or an
//      explicit CANCELLED, counts; a 404 with no acknowledgement does not;
//   7. compare-and-swap the row to voided (open + no completion time + linked successor).
//
// Every status write on the predecessor is conditional on its CURRENT lifecycle (open and
// not completed) and scoped to the broker, so a stale observation or a stale cancellation
// can never overwrite a concurrently completed record: that write simply matches nothing.
// Every step is safe to repeat; a double click, a second tab or a retry after a timeout
// converges on the same result and never produces two live signing requests.
//
// "Manual resolution" (predecessor_manual_resolution_required) is the explicit end state for
// everything automation cannot prove safe: nothing is cancelled, nothing is sent, the row is
// flagged in signing_meta.supersession.manualResolution, and the broker is told to contact
// HRS compliance. See ROA_Amend_Deployment_and_Acceptance.md for the operator runbook.

import {
  deleteDocumensoEnvelope,
  downloadDocumensoAuditLog,
  findDocumensoEnvelopeByExternalId,
  getDocumensoEnvelope,
  isDocumensoConfigured,
} from './documensoClient.js';
import {
  providerAcknowledgedOurDelete,
  refreshViaDocumenso,
  reservationMayStillBeInFlight,
} from './documensoSigning.js';
import {
  adoptRecoveredEnvelope,
  applyProviderObservation,
  downloadPdf,
  ensurePdfStored,
  loadSubmissionForBroker,
  markSupersededVoided,
  recordSupersessionState,
  releaseSigningReservation,
  StoragePaths,
  SUPERSEDABLE_STATUSES,
} from './submissionRepo.js';
import { sha256HexOfBytes } from './sha256.js';
import { hasSigningEnvelope, signingProviderFor } from './signingLifecycle.js';

const NOT_LIVE_STATUSES = new Set(['completed', 'declined', 'voided', 'expired']);
const SUPERSEDABLE = new Set(SUPERSEDABLE_STATUSES);

/** Consecutive failed audit-log backups before the broker is sent to manual resolution. */
export const AUDIT_BACKUP_MAX_ATTEMPTS = 3;
/** How long a dispatched delete may still be being acknowledged by a concurrent request. */
export const DELETE_IN_FLIGHT_GRACE_MS = 60 * 1000;

export class SupersessionError extends Error {
  constructor(code, status, extra = {}) {
    super(code);
    this.name = 'SupersessionError';
    this.code = code;
    this.status = status;
    Object.assign(this, extra);
  }
}

/** Control flow only: a step found the row already settled, so the gate ends with that result. */
class SettledEarly {
  constructor(result) {
    this.result = result;
  }
}

function settled(predecessor, outcome) {
  return { required: true, outcome, predecessor };
}

const upper = (value) => String(value || '').toUpperCase();
const nowIso = () => new Date().toISOString();

function withinDeleteGrace(dispatchedAt) {
  const at = Date.parse(dispatchedAt || '');
  if (!Number.isFinite(at)) return false;
  const age = Date.now() - at;
  return age >= 0 && age < DELETE_IN_FLIGHT_GRACE_MS;
}

/** Recipient progress without any personal data: order, role and signing state only. */
function summariseRecipients(envelope) {
  const recipients = Array.isArray(envelope?.recipients) ? envelope.recipients : [];
  return recipients.map((recipient) => ({
    signingOrder: Number.isFinite(Number(recipient?.signingOrder)) ? Number(recipient.signingOrder) : null,
    role: recipient?.role ? String(recipient.role) : null,
    signingStatus: upper(recipient?.signingStatus) || null,
  }));
}

const KNOWN_SIGNING_STATES = new Set(['NOT_SIGNED', 'SIGNED', 'REJECTED']);

/**
 * Has anybody signed? Answers conservatively: a PENDING request whose recipients cannot be
 * read, or are in a state we do not recognise, is treated as possibly signed — the evidence
 * is preserved first or the request is left alone. A DRAFT was never distributed, so
 * nobody can have signed it.
 *
 * `signedKey` identifies WHICH signatures exist, so a backup is only reused while the
 * signing progress is the one it was taken at.
 */
function signingProgress(envelope, observed) {
  const recipients = summariseRecipients(envelope);
  if (observed === 'DRAFT') return { recipients, mayHaveSigned: false, signedKey: 'none' };

  const readable = recipients.length > 0
    && recipients.every((recipient) => KNOWN_SIGNING_STATES.has(recipient.signingStatus));
  if (!readable) return { recipients, mayHaveSigned: true, signedKey: 'unknown' };

  const signed = recipients
    .map((recipient, index) => ({ ...recipient, index }))
    .filter((recipient) => recipient.signingStatus === 'SIGNED')
    .map((recipient) => String(recipient.signingOrder ?? `i${recipient.index}`))
    .sort();
  return { recipients, mayHaveSigned: signed.length > 0, signedKey: signed.length ? signed.join(',') : 'none' };
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
  try {
    return await settlePredecessor({ predecessor, replacement, broker });
  } catch (err) {
    if (err instanceof SettledEarly) return err.result;
    throw err;
  }
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

  const adopted = await adoptRecoveredEnvelope(predecessor.id, broker, {
    signing_provider: 'documenso',
    signing_envelope_id: found.id,
    signing_status: String(found.status || 'pending').toLowerCase(),
    signing_meta: { ...(predecessor.signing_meta || {}), externalId: predecessor.id },
  });
  if (!adopted) {
    // The reservation moved on while we looked (envelope recorded, voided, completed…).
    const latest = await loadSubmissionForBroker(predecessor.id, broker);
    throw new SupersessionError('predecessor_changed', 409, { retryable: true, predecessor: latest || predecessor });
  }
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
    return recordProviderTerminal(predecessor, observed, broker);
  }
  if (observed === 'PENDING' || observed === 'DRAFT') {
    return cancelLiveEnvelope({ predecessor, replacement, broker, envelope, observed });
  }
  throw new SupersessionError('predecessor_status_unrecognised', 409, { predecessor });
}

/**
 * The provider no longer knows the envelope. By itself that proves nothing: it is also what
 * a wrong environment, a deletion done by someone else, or a completed request that was
 * soft-deleted looks like. It is accepted as "our cancellation succeeded" only when the
 * provider ACKNOWLEDGED the delete we sent (persisted before this attempt). Our recorded
 * intent is not evidence: it is written before the delete exists.
 *
 *   acknowledged delete                  → verified, finalise
 *   delete dispatched a moment ago       → a concurrent request may still be acknowledging
 *                                           it: retryable, nothing changed
 *   anything else                        → manual resolution
 */
async function settleMissingEnvelope({ predecessor, replacement, broker }) {
  const fresh = (await loadSubmissionForBroker(predecessor.id, broker)) || predecessor;
  if (NOT_LIVE_STATUSES.has(fresh.status)) return settled(fresh, 'predecessor_not_live');

  const state = fresh.signing_meta?.supersession;
  const ours = Boolean(state) && state.replacementId === replacement.id;

  if (ours && state.deleteAcknowledgedAt) {
    return finaliseVoided({
      ctx: makeContext({ row: fresh, broker, replacement }),
      verifiedBy: 'not_found_after_acknowledged_delete',
      outcome: 'predecessor_already_cancelled',
    });
  }
  if (ours && state.deleteDispatchedAt && withinDeleteGrace(state.deleteDispatchedAt)) {
    throw new SupersessionError('predecessor_cancel_unverified', 503, { retryable: true, predecessor: fresh });
  }

  let reason = 'envelope_missing_unexplained';
  if (ours && state.cancelRequestedAt) {
    reason = state.deleteDispatchedAt ? 'delete_unacknowledged' : 'delete_not_dispatched';
  }
  return requireManualResolution(makeContext({ row: fresh, broker, replacement }), reason);
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

/**
 * A conditional write that the row no longer matched: someone else moved it first. Decide
 * from its CURRENT state; a completion always wins and is never overwritten.
 */
async function resolveLostRace(row, broker) {
  const latest = await loadSubmissionForBroker(row.id, broker);
  if (latest && (latest.status === 'completed' || latest.completed_at)) {
    return abortForCompletion({ predecessor: latest, broker });
  }
  if (latest?.status === 'voided') return settled(latest, 'predecessor_already_cancelled');
  if (latest && NOT_LIVE_STATUSES.has(latest.status)) return settled(latest, 'predecessor_not_live');
  throw new SupersessionError('predecessor_changed', 409, { retryable: true, predecessor: latest || row });
}

/**
 * The provider reports the request as declined or cancelled. Recorded with the same
 * conditional write as every other observation: if the row completed or otherwise moved
 * meanwhile, it matches nothing and the current state decides.
 */
async function recordProviderTerminal(predecessor, observed, broker) {
  const status = observed === 'REJECTED' ? 'declined' : 'voided';
  const updated = await applyProviderObservation(
    predecessor.id,
    broker,
    { status, signing_status: observed.toLowerCase() },
    { completion: false },
  );
  if (updated) return settled(updated, 'predecessor_not_live');
  return resolveLostRace(predecessor, broker);
}

async function observeEnvelope(envelopeId) {
  try {
    const envelope = await getDocumensoEnvelope(envelopeId);
    const status = upper(envelope?.status);
    if (status === 'CANCELLED') return { state: 'cancelled' };
    if (status === 'COMPLETED') return { state: 'completed' };
    if (status === 'REJECTED') return { state: 'rejected' };
    if (status === 'PENDING' || status === 'DRAFT') return { state: 'live', envelope };
    return { state: 'unknown' };
  } catch (err) {
    if (err?.status === 404) return { state: 'gone' };
    return { state: 'unknown' };
  }
}

// ---------------------------------------------------------------------------------------
// Cancellation state machine. `ctx` carries the broker, the replacement, the latest row we
// persisted and the accumulated signing_meta.supersession state.

function makeContext({ row, broker, replacement }) {
  return { row, broker, replacement, state: { ...(row.signing_meta?.supersession || {}) } };
}

/**
 * Persists a patch of the supersession state. Returns true when it was written; false when
 * the row no longer matched (it moved on — the caller decides). The in-memory state always
 * advances, so a step that could not be persisted is still reasoned about correctly.
 */
async function commit(ctx, patch) {
  ctx.state = { ...ctx.state, ...patch };
  const next = await recordSupersessionState(ctx.row.id, ctx.broker, {
    ...(ctx.row.signing_meta || {}),
    supersession: ctx.state,
  });
  if (!next) return false;
  ctx.row = next;
  return true;
}

/** Commit that must land: if the row moved on, the gate ends with the row's current state. */
async function commitOrSettle(ctx, patch) {
  if (await commit(ctx, patch)) return;
  throw new SettledEarly(await resolveLostRace(ctx.row, ctx.broker));
}

/**
 * Automation cannot prove it is safe to continue. Flags the row (best effort — failing to
 * flag never changes the outcome), changes nothing else and refuses the send.
 */
async function requireManualResolution(ctx, reason) {
  const flaggedAt = nowIso();
  try {
    await commit(ctx, { manualResolution: { required: true, reason, flaggedAt } });
  } catch (err) {
    console.error('supersession: could not persist the manual-resolution flag', err?.message);
  }
  console.error('supersession: manual resolution required', reason);
  throw new SupersessionError('predecessor_manual_resolution_required', 409, {
    reason,
    retryable: false,
    predecessor: ctx.row,
  });
}

// ---------------------------------------------------------------------------------------
// Evidence preservation for a partially signed request.

function looksLikePdf(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length >= 64 && bytes.subarray(0, 5).toString('latin1') === '%PDF-';
}

/** A 4xx other than "slow down / try later" will not fix itself; everything else may. */
function isPermanentFailure(err) {
  const status = Number(err?.status);
  return Number.isFinite(status) && status >= 400 && status < 500 && ![408, 425, 429].includes(status);
}

/**
 * Downloads the provider's audit log, stores it, reads it back and verifies the hash. Only
 * a copy that has been proven durable counts. Throws on any shortfall.
 */
async function downloadAndVerifyAuditLog(submissionId, envelopeId) {
  const bytes = await downloadDocumensoAuditLog(envelopeId);
  if (!looksLikePdf(bytes)) {
    const err = new Error('audit_log_not_a_pdf');
    err.backupCode = 'not_a_pdf';
    throw err;
  }
  const sha256 = sha256HexOfBytes(bytes);
  const path = StoragePaths.supersededAuditLog(submissionId, sha256);
  await ensurePdfStored(path, bytes, { expectedSha256: sha256 });
  const stored = await downloadPdf(path);
  if (sha256HexOfBytes(stored) !== sha256) {
    const err = new Error('stored_audit_log_mismatch');
    err.backupCode = 'stored_copy_mismatch';
    throw err;
  }
  return { path, sha256, byteLength: bytes.length };
}

/**
 * A signed recipient must never lose the signing audit trail because a backup failed. The
 * delete is not sent until a verified copy for THIS signing progress exists. Anything less
 * leaves the request untouched: retryable at first, manual resolution once it keeps failing
 * or the provider says it will never be available.
 */
async function preserveAuditTrail(ctx, envelopeId, progress) {
  const kept = ctx.state.auditLog;
  if (kept?.verifiedAt && kept.signedKey === progress.signedKey) return; // already preserved

  const attempts = Number(ctx.state.auditBackup?.attempts || 0);
  let copy;
  try {
    copy = await downloadAndVerifyAuditLog(ctx.row.id, envelopeId);
  } catch (err) {
    const permanent = isPermanentFailure(err);
    const failure = Number.isFinite(Number(err?.status)) ? `http_${Number(err.status)}` : (err?.backupCode || 'unavailable');
    console.error('supersession: audit-log backup failed', failure);
    try {
      await commit(ctx, {
        auditBackup: { attempts: attempts + 1, lastFailedAt: nowIso(), lastFailure: failure, permanent },
      });
    } catch (persistErr) {
      console.error('supersession: could not persist the backup failure', persistErr?.message);
    }
    if (permanent || attempts + 1 >= AUDIT_BACKUP_MAX_ATTEMPTS) {
      await requireManualResolution(ctx, 'audit_backup_unavailable'); // always throws
    }
    throw new SupersessionError('predecessor_audit_backup_failed', 503, { retryable: true, predecessor: ctx.row });
  }

  const verifiedAt = nowIso();
  await commitOrSettle(ctx, {
    auditLog: {
      ...copy,
      signedKey: progress.signedKey,
      capturedAt: verifiedAt,
      verifiedAt,
    },
    auditBackup: { attempts: 0, lastSucceededAt: verifiedAt },
  });
}

// ---------------------------------------------------------------------------------------

async function cancelLiveEnvelope({ predecessor, replacement, broker, envelope, observed }) {
  const ctx = makeContext({ row: predecessor, broker, replacement });
  try {
    return await runCancellation(ctx, { envelope, observed });
  } catch (err) {
    if (err instanceof SettledEarly) return err.result;
    throw err;
  }
}

async function runCancellation(ctx, { envelope, observed }) {
  const { broker, replacement } = ctx;
  const envelopeId = ctx.row.signing_envelope_id;
  const initial = signingProgress(envelope, observed);

  // 1. The INTENT. A marker so a crash is diagnosable — never evidence about the provider.
  await commitOrSettle(ctx, {
    replacementId: replacement.id,
    cancelRequestedAt: ctx.state.cancelRequestedAt || nowIso(),
    observedStatus: observed,
    recipients: initial.recipients,
  });

  // 2. Preserve what the provider can tell us about a partially signed request, first.
  if (initial.mayHaveSigned) await preserveAuditTrail(ctx, envelopeId, initial);

  // 3. Act on a FRESH observation: the backup above may have taken seconds.
  let fresh;
  try {
    fresh = await getDocumensoEnvelope(envelopeId);
  } catch (err) {
    if (err?.status === 404) {
      // Vanished between our read and now, before we sent any delete: nothing of ours to
      // credit it to.
      throw new SettledEarly(await settleMissingEnvelope({ predecessor: ctx.row, replacement, broker }));
    }
    throw new SupersessionError('predecessor_status_unavailable', 503, { retryable: true, predecessor: ctx.row });
  }
  const freshStatus = upper(fresh?.status);
  if (freshStatus === 'COMPLETED') return abortForCompletion({ predecessor: ctx.row, broker });
  if (freshStatus === 'REJECTED' || freshStatus === 'CANCELLED') {
    return recordProviderTerminal(ctx.row, freshStatus, broker);
  }
  if (freshStatus !== 'PENDING' && freshStatus !== 'DRAFT') {
    throw new SupersessionError('predecessor_status_unrecognised', 409, { predecessor: ctx.row });
  }
  const current = signingProgress(fresh, freshStatus);
  if (current.mayHaveSigned) {
    const kept = ctx.state.auditLog;
    if (!kept?.verifiedAt || kept.signedKey !== current.signedKey) {
      // Someone signed after the backup was taken: the copy no longer covers everything.
      throw new SupersessionError('predecessor_changed', 409, { retryable: true, predecessor: ctx.row });
    }
  }

  // 4. Record that the delete is being sent, then send it.
  await commitOrSettle(ctx, {
    deleteDispatchedAt: nowIso(),
    deleteAttempts: Number(ctx.state.deleteAttempts || 0) + 1,
    observedStatus: freshStatus,
    recipients: current.recipients,
  });

  let deleteError = null;
  let acknowledgedAt = null;
  try {
    await deleteDocumensoEnvelope(envelopeId);
    acknowledgedAt = nowIso();
  } catch (err) {
    deleteError = err;
  }
  const definitelyRejected = Boolean(deleteError)
    && Number.isFinite(deleteError.status)
    && deleteError.status < 500
    && deleteError.status !== 404;

  // 5. The provider's acknowledgement of THIS delete. Persisted at once: it is what lets a
  //    later request accept a 404. A failure to persist keeps it in memory for this attempt.
  if (acknowledgedAt) {
    try {
      await commit(ctx, { deleteAcknowledgedAt: acknowledgedAt });
    } catch (err) {
      console.error('supersession: could not persist the delete acknowledgement', err?.message);
    }
  }

  // 6. VERIFY by re-reading. A success response is never taken as proof on its own.
  const verdict = await observeEnvelope(envelopeId);

  if (verdict.state === 'completed') {
    // Completed concurrently: abandon the stale cancellation, keep it as the signed record.
    return abortForCompletion({ predecessor: ctx.row, broker });
  }
  if (verdict.state === 'rejected') return recordProviderTerminal(ctx.row, 'REJECTED', broker);
  if (verdict.state === 'live') {
    throw new SupersessionError(
      definitelyRejected ? 'predecessor_cancel_rejected' : 'predecessor_cancel_unverified',
      definitelyRejected ? 502 : 503,
      { retryable: true, predecessor: ctx.row },
    );
  }
  if (verdict.state === 'unknown' || definitelyRejected) {
    throw new SupersessionError('predecessor_cancel_unverified', 503, { retryable: true, predecessor: ctx.row });
  }
  if (verdict.state === 'gone' && !acknowledgedAt) {
    // It is gone, but the provider never confirmed OUR delete (an error response, a lost
    // reply, or a deletion by someone else). That alone is not proof of our cancellation.
    // The one thing that settles it is the acknowledgement of a concurrent request of ours
    // (a second tab): the winner records it, and this request then follows it.
    const latest = await loadSubmissionForBroker(ctx.row.id, broker);
    if (latest?.status === 'voided') return settled(latest, 'predecessor_already_cancelled');
    if (latest && SUPERSEDABLE.has(latest.status) && !latest.completed_at && providerAcknowledgedOurDelete(latest)) {
      ctx.row = latest;
      ctx.state = { ...latest.signing_meta.supersession };
      return finaliseVoided({ ctx, verifiedBy: 'gone_after_acknowledged_delete', outcome: 'predecessor_cancelled' });
    }
    // Otherwise: retryable inside the grace window (settleMissingEnvelope), manual after it.
    throw new SupersessionError('predecessor_cancel_unverified', 503, { retryable: true, predecessor: ctx.row });
  }

  // 'cancelled' (explicit) or 'gone' after an acknowledged delete: verified.
  return finaliseVoided({
    ctx,
    verifiedBy: verdict.state === 'cancelled' ? 'cancelled' : 'gone_after_acknowledged_delete',
    outcome: 'predecessor_cancelled',
  });
}

async function finaliseVoided({ ctx, verifiedBy, outcome }) {
  const { broker, replacement } = ctx;
  const finishedAt = nowIso();
  const supersession = {
    ...ctx.state,
    cancelledAt: finishedAt,
    verifiedBy,
    ...(ctx.state.manualResolution ? { manualResolution: { ...ctx.state.manualResolution, resolvedAt: finishedAt } } : {}),
  };
  const voided = await markSupersededVoided(
    ctx.row.id,
    broker,
    { ...(ctx.row.signing_meta || {}), supersession },
    replacement.id,
  );
  if (voided) return settled(voided, outcome);
  // The compare-and-swap found the row already moved on (e.g. completed).
  return resolveLostRace(ctx.row, broker);
}
