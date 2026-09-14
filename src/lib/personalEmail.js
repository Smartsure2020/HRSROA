// Personal Lines ROA notification email body (Phase ROA-0 — data minimisation).
//
// The old body duplicated ID/passport number, cell, full residential address,
// occupation, marital status, bank name, account number, account type,
// deduction date and deduction amount into the email transport — even though
// the attached signed PDF already contains all of that information. Copying
// sensitive personal / banking data into plain-text email content expands the
// number of places it needs to be protected and forwarded, for zero
// operational benefit to the broker.
//
// The new body is a short, non-sensitive summary that references the attached
// PDF for the complete record. Anything a broker legitimately needs to act on
// (which client, which broker, which insurer, was the fee applicable, were all
// the required acknowledgements captured) is still visible; PII and banking
// data are not.

import { getBrokerFeeSummary } from './brokerFee';
import { HRS_INFO } from './hrsOrganisation';

/** Ordered list of Personal-flow acknowledgement flags used by the ROA. */
const PERSONAL_ACK_FIELDS = [
  'ackPrinciples',
  'ackAdvisor',
  'ackClient',
  'ackPopia',
  'ackTermination',
  'ackBrokerFee',
  'ackBrokerAppointment',
  'ackBrokerAuth',
];

/** Fields that MUST NOT appear in the notification email body. */
export const PERSONAL_EMAIL_REDACTED_FIELDS = Object.freeze([
  'idNumber',
  'cell',
  'workNumber',
  'streetNumber',
  'streetName',
  'complexName',
  'suburb',
  'city',
  'province',
  'postalCode',
  'occupation',
  'maritalStatus',
  'bankName',
  'accountNumber',
  'accountType',
  'branchCode',
  'deductionDate',
  'deductionAmount',
  'doInsurer',
  'inceptionDate',
]);

/**
 * Builds the internal notification email subject + body sent to the broker
 * whose ROA was submitted. Never includes banking data, ID/passport numbers,
 * cell numbers or full address — those live in the attached PDF only.
 *
 * @param {object} formData
 * @returns {{ subject: string, body: string }}
 */
export function buildPersonalNotificationEmail(formData) {
  const clientName = [formData?.firstName, formData?.surname].filter(Boolean).join(' ') || 'Client';
  const brokerName = formData?.brokerName || 'Unassigned';
  const fee = getBrokerFeeSummary(formData);
  const feeStr = fee.consentRequired ? fee.displayValue : 'No broker fee applicable';

  const allAcks = PERSONAL_ACK_FIELDS.every((k) => Boolean(formData?.[k]));

  const subject = `New Advice Record – ${clientName} (${brokerName})`;

  const body = `New Personal Lines Advice Record Submitted
============================================
Broker / Advisor: ${brokerName}
Client: ${clientName}
Recommended Insurer: ${formData?.recInsurer || '-'}
Broker Fee: ${feeStr}

All required acknowledgements captured: ${allAcks ? 'Yes' : 'No — some acknowledgements outstanding'}

The complete signed Record of Advice — including the client's contact,
address, banking and full acknowledgement detail — is in the PDF attached to
this email. Do not treat this email body as the record; treat the attachment
as the authoritative document.

---
${HRS_INFO.legalName} – FSP ${HRS_INFO.fspNumber}`.trim();

  return { subject, body };
}
