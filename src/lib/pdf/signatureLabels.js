// Single source of truth for the on-page signature block labels used by both PDF
// generators AND by the DocuSign envelope builder. These strings are the anchor
// contract: DocuSign places its signHere / dateSigned tabs by matching this exact
// text inside the generated PDF. If a label ever changes here, the corresponding
// generator's `sigBox()` call and the DocuSign envelope's `anchorString` must both
// update together — which is why they now all read from this file.
//
// Never inline these strings in a generator or in the DocuSign envelope again.

export const SIGNATURE_LABELS = Object.freeze({
  /** Personal Lines ROA — client signature block label. */
  personalClient: 'Client Signature',
  /** Commercial Lines ROA — client / authorised-rep signature block label. */
  commercialClient: 'Client / Authorised Rep.',
  /** Both flows — advisor / broker signature block label. */
  advisor: 'Advisor / Broker Signature',
});

/** Valid `roaType` values the app supports for envelope creation. */
export const ROA_TYPES = Object.freeze(['Personal', 'Commercial']);

/**
 * Resolves the correct client signature anchor for the given ROA type.
 * Throws for unknown values so the envelope builder fails closed rather than
 * silently defaulting to a mismatched anchor.
 * @param {string} roaType
 * @returns {string}
 */
export function getClientSignatureLabel(roaType) {
  if (roaType === 'Personal') return SIGNATURE_LABELS.personalClient;
  if (roaType === 'Commercial') return SIGNATURE_LABELS.commercialClient;
  throw new Error(`Unknown ROA type: ${JSON.stringify(roaType)} — expected one of ${ROA_TYPES.join(', ')}`);
}

/** The advisor / broker signature block label, identical across both ROA flows. */
export function getAdvisorSignatureLabel() {
  return SIGNATURE_LABELS.advisor;
}
