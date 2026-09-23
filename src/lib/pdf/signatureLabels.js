// Single source of truth for the visible signature block labels and the hidden
// provider-placement markers rendered into both ROA PDFs.
//
// The visible labels are presentation. The hidden markers are machine anchors:
// Documenso locates them in the canonical PDF, whites out the tiny marker text,
// and places the corresponding signature/date field at that position.
//
// Never inline either labels or markers in a PDF generator or provider adapter.

export const SIGNATURE_LABELS = Object.freeze({
  /** Personal Lines ROA — client signature block label. */
  personalClient: 'Client Signature',
  /** Commercial Lines ROA — client / authorised-rep signature block label. */
  commercialClient: 'Client / Authorised Rep.',
  /** Both flows — advisor / broker signature block label. */
  advisor: 'Advisor / Broker Signature',
});

/**
 * PII-free hidden markers. Keep these short, unique and stable: they form the
 * canonical PDF ↔ signing-provider placement contract.
 */
export const SIGNATURE_MARKERS = Object.freeze({
  clientSignature: 'HRS_ROA_CS',
  clientDate: 'HRS_ROA_CD',
  advisorSignature: 'HRS_ROA_AS',
  advisorDate: 'HRS_ROA_AD',
});

/** Valid roaType values the app supports for envelope creation. */
export const ROA_TYPES = Object.freeze(['Personal', 'Commercial']);

export function getClientSignatureLabel(roaType) {
  if (roaType === 'Personal') return SIGNATURE_LABELS.personalClient;
  if (roaType === 'Commercial') return SIGNATURE_LABELS.commercialClient;
  throw new Error(`Unknown ROA type: ${JSON.stringify(roaType)} — expected one of ${ROA_TYPES.join(', ')}`);
}

export function getAdvisorSignatureLabel() {
  return SIGNATURE_LABELS.advisor;
}
