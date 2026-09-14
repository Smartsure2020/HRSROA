// DocuSign envelope-payload builder (Phase ROA-0).
//
// Extracted from api/send-for-signature.js so the anchor contract, the fail-
// closed signHere semantics and the routing order can be unit-tested without
// touching DocuSign or shelling out through a serverless handler.
//
// Fail-closed guarantees enforced here:
//   • `anchorIgnoreIfNotPresent: 'false'` on every required signHere tab, so
//     DocuSign rejects envelope creation if the PDF is ever regenerated without
//     the expected label instead of quietly issuing a signature-less document.
//   • `anchorString` is resolved from the shared SIGNATURE_LABELS source of
//     truth via `getClientSignatureLabel(roaType)` — no local literals.
//   • `getClientSignatureLabel` throws for an unknown roaType (see
//     src/lib/pdf/signatureLabels.js).
//
// dateSigned tabs remain tolerant (`anchorIgnoreIfNotPresent: 'true'`) because
// the visible date is optional evidence — the DocuSign completion certificate
// is the legal date of signing.

import { getAdvisorSignatureLabel, getClientSignatureLabel } from '../../src/lib/pdf/signatureLabels.js';
import { HRS_INFO } from '../../src/lib/hrsOrganisation.js';

const DEFAULT_EMAIL_SUBJECT = (signerName) => `Please sign your Record of Advice – ${signerName} | HRS Insurance`;
const DEFAULT_EMAIL_BLURB = (signerName, roaType) =>
  `Dear ${signerName},\n\nPlease review and sign your ${roaType} Lines Record of Advice from ${HRS_INFO.legalName}. This document is required under the Financial Advisory and Intermediary Services (FAIS) Act.\n\nKind regards,\n${HRS_INFO.legalName}\nFSP No. ${HRS_INFO.fspNumber}`;

/**
 * @param {object} args
 * @param {string} args.roaType 'Personal' | 'Commercial'
 * @param {string} args.signerName
 * @param {string} args.signerEmail
 * @param {string} args.brokerName
 * @param {string} args.brokerEmail
 * @param {string} args.pdfBase64
 * @param {string} args.pdfFilename
 * @param {string} [args.subject]
 * @param {string} [args.message]
 * @returns {object} DocuSign envelope definition
 */
export function buildEnvelope({
  roaType,
  signerName,
  signerEmail,
  brokerName,
  brokerEmail,
  pdfBase64,
  pdfFilename,
  subject,
  message,
}) {
  const clientAnchor = getClientSignatureLabel(roaType); // throws for unknown roaType
  const advisorAnchor = getAdvisorSignatureLabel();

  return {
    emailSubject: subject || DEFAULT_EMAIL_SUBJECT(signerName),
    emailBlurb: message || DEFAULT_EMAIL_BLURB(signerName, roaType),
    status: 'sent',
    documents: [
      {
        documentBase64: pdfBase64,
        name: pdfFilename.replace(/\.pdf$/i, ''),
        fileExtension: 'pdf',
        documentId: '1',
      },
    ],
    recipients: {
      signers: [
        {
          name: signerName,
          email: signerEmail,
          recipientId: '1',
          routingOrder: '1',
          tabs: {
            signHereTabs: [
              {
                documentId: '1',
                anchorString: clientAnchor,
                anchorUnits: 'pixels',
                anchorXOffset: '0',
                // Anchor text sits in the blue box header (~5mm from box top).
                // 40px @ 72dpi ≈ 14mm — places the tab in the middle of the blank signature area.
                anchorYOffset: '40',
                // Required signHere: DocuSign MUST reject envelope creation if the
                // anchor is missing from the PDF (fail-closed).
                anchorIgnoreIfNotPresent: 'false',
              },
            ],
            dateSignedTabs: [
              {
                documentId: '1',
                anchorString: clientAnchor,
                anchorUnits: 'pixels',
                anchorXOffset: '0',
                // 90px ≈ 32mm below anchor — aligns with the date line near the bottom of the box.
                anchorYOffset: '90',
                // The visible date is optional evidence — the Certificate of
                // Completion carries the legal date of signing.
                anchorIgnoreIfNotPresent: 'true',
              },
            ],
          },
        },
        {
          name: brokerName,
          email: brokerEmail,
          recipientId: '2',
          routingOrder: '2',
          tabs: {
            signHereTabs: [
              {
                documentId: '1',
                anchorString: advisorAnchor,
                anchorUnits: 'pixels',
                anchorXOffset: '0',
                anchorYOffset: '40',
                anchorIgnoreIfNotPresent: 'false',
              },
            ],
            dateSignedTabs: [
              {
                documentId: '1',
                anchorString: advisorAnchor,
                anchorUnits: 'pixels',
                anchorXOffset: '0',
                anchorYOffset: '90',
                anchorIgnoreIfNotPresent: 'true',
              },
            ],
          },
        },
      ],
    },
    notification: {
      useAccountDefaults: false,
      reminders: {
        reminderEnabled: 'true',
        reminderDelay: '1',
        reminderFrequency: '2',
      },
      expirations: {
        expireEnabled: 'true',
        expireAfter: '14',
        expireWarn: '2',
      },
    },
  };
}
