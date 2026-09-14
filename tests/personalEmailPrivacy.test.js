// Personal notification email privacy regression (Phase ROA-0).
//
// Guards against future reintroduction of PII / banking data into the plain-
// text email body. The signed ROA PDF remains the authoritative record and
// still carries all of this detail.

import { describe, expect, it } from 'vitest';
import {
  buildPersonalNotificationEmail,
  PERSONAL_EMAIL_REDACTED_FIELDS,
} from '../src/lib/personalEmail.js';

const RICH_FORM = Object.freeze({
  firstName: 'Jane',
  surname: 'Doe',
  brokerName: 'Andrew Penney',
  recInsurer: 'Stratsys',
  brokerFeeType: 'percent',
  brokerFeePercent: '5',
  prem2: '2000',

  // All of the following must NOT appear in the email body.
  idNumber: '8001015009087',
  cell: '0821234567',
  workNumber: '0111234567',
  streetNumber: '42',
  streetName: 'Sample Road',
  complexName: 'Unit 3, Blossom Court',
  suburb: 'Sandton',
  city: 'Johannesburg',
  province: 'Gauteng',
  postalCode: '2196',
  occupation: 'Software engineer',
  maritalStatus: 'Married',
  bankName: 'ABSA Bank',
  accountNumber: '9012345678',
  accountType: 'Cheque',
  branchCode: '632005',
  deductionDate: '1st',
  deductionAmount: '1750',
  // Sentinel value distinct from recInsurer so the "value must not appear"
  // assertion below can't false-positive on the legitimate `Recommended Insurer`
  // summary line.
  doInsurer: 'DEBIT-ORDER-INSURER-SENTINEL',
  inceptionDate: '2026-10-01',

  // Acks — all true so the "all captured" summary is stable.
  ackPrinciples: true,
  ackAdvisor: true,
  ackClient: true,
  ackPopia: true,
  ackTermination: true,
  ackBrokerFee: true,
  ackBrokerAppointment: true,
  ackBrokerAuth: true,
});

describe('buildPersonalNotificationEmail — data minimisation', () => {
  const { subject, body } = buildPersonalNotificationEmail(RICH_FORM);

  it('subject identifies the client and broker without leaking sensitive data', () => {
    expect(subject).toBe('New Advice Record – Jane Doe (Andrew Penney)');
    for (const value of ['8001015009087', '0821234567', '9012345678', 'ABSA', 'Sample Road']) {
      expect(subject).not.toContain(value);
    }
  });

  it('body does NOT contain any sensitive field value', () => {
    const sensitiveValues = PERSONAL_EMAIL_REDACTED_FIELDS.map((k) => String(RICH_FORM[k]));
    for (const value of sensitiveValues) {
      expect(body, `body must not contain redacted value "${value}"`).not.toContain(value);
    }
  });

  it('body does NOT contain sensitive field labels either (belt-and-braces)', () => {
    for (const label of ['ID/Passport', 'ID Number', 'Account:', 'Account Number', 'Bank:', 'Deduction:', 'Cell:', 'Address:']) {
      expect(body).not.toContain(label);
    }
  });

  it('body retains the safe summary the broker needs', () => {
    expect(body).toContain('Broker / Advisor: Andrew Penney');
    expect(body).toContain('Client: Jane Doe');
    expect(body).toContain('Recommended Insurer: Stratsys');
    expect(body).toContain('All required acknowledgements captured: Yes');
    expect(body).toContain('Holistic Risk Services (Pty) Ltd');
    expect(body).toContain('FSP 28582');
  });

  it('body points the reader to the attached PDF as the authoritative record', () => {
    expect(body.toLowerCase()).toContain('attached');
    expect(body.toLowerCase()).toContain('authoritative');
  });

  it('flags outstanding acknowledgements when some are missing', () => {
    const { body: partial } = buildPersonalNotificationEmail({ ...RICH_FORM, ackPopia: false });
    expect(partial).toContain('some acknowledgements outstanding');
  });

  it('reports "No broker fee applicable" when the fee is zero', () => {
    const { body: noFee } = buildPersonalNotificationEmail({ ...RICH_FORM, brokerFeePercent: '0' });
    expect(noFee).toContain('Broker Fee: No broker fee applicable');
  });
});
