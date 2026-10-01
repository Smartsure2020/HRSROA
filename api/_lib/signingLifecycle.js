const TERMINAL_STATUSES = new Set(['declined', 'voided', 'expired']);

export function signingProviderFor(row) {
  return row?.signing_provider || (row?.docusign_envelope_id ? 'docusign' : null);
}

export function hasSigningEnvelope(row) {
  return Boolean(row?.signing_envelope_id || row?.docusign_envelope_id);
}

export function hasRequiredSigningEvidence(row) {
  if (!row?.signed_pdf_storage_path || !row?.certificate_storage_path) return false;
  return signingProviderFor(row) !== 'documenso' || Boolean(row.audit_log_storage_path);
}

export function isTerminalSigningRecord(row) {
  if (!row) return true;
  if (TERMINAL_STATUSES.has(row.status)) return true;
  return row.status === 'completed' && hasRequiredSigningEvidence(row);
}

export function shouldReconcileSigningRecord(row) {
  if (!hasSigningEnvelope(row) || isTerminalSigningRecord(row)) return false;
  if (row.status === 'awaiting_signature' || row.status === 'completed') return true;
  const observedStatus = String(row.signing_status || row.docusign_status || '').toLowerCase();
  return ['pending', 'draft', 'sent', 'delivered', 'completed'].includes(observedStatus);
}
