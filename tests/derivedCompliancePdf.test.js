import { describe, expect, it } from 'vitest';
import {
  buildDerivedCompliancePdf,
  derivedComplianceAvailability,
  hasAuthoritativeCompletionEvidence,
} from '../api/_lib/derivedCompliancePdf.js';

function completedRow(overrides = {}) {
  return {
    id: 'ROA-11111111-1111-4111-8111-111111111111',
    roa_type: 'Personal',
    advisor_email: 'broker@example.com',
    signing_provider: 'documenso',
    signing_envelope_id: 'envelope_test',
    completed_at: '2026-10-05T10:00:00.000Z',
    signed_pdf_storage_path: 'signed.pdf',
    certificate_storage_path: 'certificate.pdf',
    audit_log_storage_path: 'audit.pdf',
    snapshot_json: {
      title: 'Mr',
      firstName: 'Test',
      surname: 'Client',
      brokerName: 'Test Broker',
      ackBrokerAppointment: true,
      changingBroker: 'yes',
      ackLetterOfInvestigation: true,
    },
    ...overrides,
  };
}

describe('derived compliance PDFs', () => {
  it('only enables downloads after authoritative completion evidence exists', () => {
    expect(hasAuthoritativeCompletionEvidence(completedRow())).toBe(true);
    expect(derivedComplianceAvailability(completedRow())).toEqual({
      brokerAppointment: true,
      letterInvestigation: true,
    });

    const incomplete = completedRow({ audit_log_storage_path: null });
    expect(hasAuthoritativeCompletionEvidence(incomplete)).toBe(false);
    expect(derivedComplianceAvailability(incomplete)).toEqual({
      brokerAppointment: false,
      letterInvestigation: false,
    });
  });

  it('does not offer a letter of investigation when the broker is not changing', () => {
    const row = completedRow({
      snapshot_json: {
        ...completedRow().snapshot_json,
        changingBroker: 'no',
        ackLetterOfInvestigation: false,
      },
    });
    expect(derivedComplianceAvailability(row).letterInvestigation).toBe(false);
    expect(() => buildDerivedCompliancePdf(row, 'letter-investigation'))
      .toThrow('letter_investigation_not_available');
  });

  it('generates broker appointment and investigation PDFs from frozen submission data', () => {
    const appointment = buildDerivedCompliancePdf(completedRow(), 'broker-appointment');
    const investigation = buildDerivedCompliancePdf(completedRow(), 'letter-investigation');

    expect(appointment.filename).toBe('Broker Appointment – Mr Test Client.pdf');
    expect(investigation.filename).toBe('Letter of Investigation – Mr Test Client.pdf');
    expect(appointment.bytes.subarray(0, 4).toString()).toBe('%PDF');
    expect(investigation.bytes.subarray(0, 4).toString()).toBe('%PDF');
    expect(appointment.bytes.length).toBeGreaterThan(1000);
    expect(investigation.bytes.length).toBeGreaterThan(1000);
  });
});
