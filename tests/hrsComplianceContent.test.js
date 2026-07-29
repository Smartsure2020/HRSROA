import { describe, it, expect } from 'vitest';
import { HRS_COMPLIANCE_CONTENT, getStatutoryDisclosureEvidence } from '../src/lib/hrsComplianceContent.js';
import { HRS_INFO } from '../src/lib/hrsOrganisation.js';

describe('Central HRS configuration', () => {
  it('uses the approved phone number', () => {
    expect(HRS_INFO.phone).toBe('011 447 9800');
  });
});

describe('Broker Appointment content — no 30-day cancellation notice', () => {
  it('Personal variant contains no "30 days" wording', () => {
    const { intro, sections, closing } = HRS_COMPLIANCE_CONTENT.brokerAppointment.personal;
    const all = [intro, ...sections.map(s => s.text), closing].join(' ');
    expect(all).not.toMatch(/30 days/i);
    expect(all).toMatch(/remains in force until cancelled/i);
  });

  it('Commercial variant contains no "30 days" wording', () => {
    const { intro, sections, closing } = HRS_COMPLIANCE_CONTENT.brokerAppointment.commercial;
    const all = [intro, ...sections.map(s => s.text), closing].join(' ');
    expect(all).not.toMatch(/30 days/i);
    expect(all).toMatch(/remains in force until cancelled/i);
  });
});

describe('Statutory Disclosure metadata', () => {
  it('has the approved version identifier', () => {
    expect(HRS_COMPLIANCE_CONTENT.statutoryDisclosure.version).toBe('HRS-STAT-DISC-2026-01');
  });

  it('records a digital version date rather than an invented legal effective date', () => {
    expect(HRS_COMPLIANCE_CONTENT.statutoryDisclosure.digitalVersionDate).toBeTruthy();
  });
});

describe('getStatutoryDisclosureEvidence', () => {
  it('reports "No" when not acknowledged', () => {
    const e = getStatutoryDisclosureEvidence({ ackStatutoryDisclosure: false });
    expect(e.acknowledged).toBe(false);
    expect(e.signatureStatus).toBe('no');
  });

  it('reports pending signature when acknowledged but not yet signed', () => {
    const e = getStatutoryDisclosureEvidence({ ackStatutoryDisclosure: true, clientSig: null });
    expect(e.acknowledged).toBe(true);
    expect(e.signatureStatus).toBe('pending');
  });

  it('reports "yes" only when acknowledged AND the general ROA signature is present', () => {
    const e = getStatutoryDisclosureEvidence({ ackStatutoryDisclosure: true, clientSig: 'data:image/png;base64,AAA' });
    expect(e.signatureStatus).toBe('yes');
  });

  it('always carries the current controlled version', () => {
    const e = getStatutoryDisclosureEvidence({ ackStatutoryDisclosure: true, clientSig: 'x' });
    expect(e.version).toBe(HRS_COMPLIANCE_CONTENT.statutoryDisclosure.version);
  });
});
