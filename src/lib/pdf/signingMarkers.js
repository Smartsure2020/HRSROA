// Provider-neutral machine anchors embedded invisibly in canonical ROA PDFs.
// Signing providers may locate these strings and place signature fields over
// the surrounding signature boxes. Keep stable once submissions exist.

export const SIGNING_MARKERS = Object.freeze({
  clientSignature: '[[HRS_ROA_CLIENT_SIGNATURE]]',
  advisorSignature: '[[HRS_ROA_ADVISOR_SIGNATURE]]',
});
