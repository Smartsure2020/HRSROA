import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCrmSyncPayload, verifyEvidenceBytes } from '../api/_lib/crmIntegration.js';
import { sha256HexOfBytes } from '../api/_lib/sha256.js';

const SUBMISSION_ID = 'ROA-11111111-1111-4111-8111-111111111111';

function row(overrides = {}) {
  return {
    id: SUBMISSION_ID,
    roa_type: 'Personal',
    advisor_email: 'broker@hrs.test',
    snapshot_json: {
      firstName: 'Jane', initials: 'J', surname: 'Doe', idNumber: '9001010000000',
      email: 'jane@example.test', cell: '0820000000', brokerName: 'Broker One',
      streetNumber: '1', streetName: 'Main Road', suburb: 'Town', city: 'City',
      province: 'Gauteng', postalCode: '2000', recInsurer: 'Insurer', prem2: '1234.50',
    },
    ...overrides,
  };
}

describe('HRSROA server-side CRM integration', () => {
  it('builds the personal payload only from the frozen server snapshot', () => {
    expect(buildCrmSyncPayload(row())).toMatchObject({
      submissionId: SUBMISSION_ID,
      roaType: 'Personal',
      adviser: { email: 'broker@hrs.test', name: 'Broker One' },
      client: {
        displayName: 'J Doe', idNumber: '9001010000000',
        email: 'jane@example.test', streetAddress: '1 Main Road',
      },
      deal: { policyType: 'personal', estimatedPremium: 1234.5, insurer: 'Insurer' },
    });
  });

  it('maps commercial identity without banking or full snapshot fields', () => {
    const payload = buildCrmSyncPayload(row({
      roa_type: 'Commercial',
      snapshot_json: {
        companyName: 'Acme Pty Ltd', registrationNo: '2020/123456/07',
        vatNo: '4000000000', contactPerson: 'A Person', email: 'acme@example.test',
        contactNo: '0110000000', bankAccount: 'must-not-leave', prem2: '4000',
      },
    }));
    expect(payload.client).toMatchObject({
      displayName: 'Acme Pty Ltd', companyRegistration: '2020/123456/07',
      contactPerson: 'A Person', email: 'acme@example.test',
    });
    expect(JSON.stringify(payload)).not.toContain('must-not-leave');
  });

  it('keeps all browser code free of direct CRM URLs, tokens, and arbitrary CRM id attachment', () => {
    const client = readFileSync(new URL('../src/lib/roaSubmissionClient.js', import.meta.url), 'utf8');
    const adapter = readFileSync(new URL('../src/lib/crmAdapter.js', import.meta.url), 'utf8');
    const personal = readFileSync(new URL('../src/components/hrs/steps/StepChecklist.jsx', import.meta.url), 'utf8');
    const commercial = readFileSync(new URL('../src/components/hrs/commercial/steps/CommercialStepChecklist.jsx', import.meta.url), 'utf8');
    const browserSource = [client, adapter, personal, commercial].join('\n');
    expect(browserSource).not.toContain('crm.hrsinsurance.co.za');
    expect(browserSource).not.toContain('access_token');
    expect(browserSource).not.toContain('attachCrmIds');
    expect(client).toContain("postJson('/api/roa-submissions/sync-crm', { submissionId })");
  });

  it('declares the dedicated secret pair only in server modules', () => {
    const server = readFileSync(new URL('../api/_lib/crmIntegration.js', import.meta.url), 'utf8');
    expect(server).toContain('CRM_INTEGRATION_SECRET');
    expect(server).toContain('CRM_BASE_URL');
    expect(server).toContain('evidence_hash_mismatch');
    expect(server).toContain('AbortController');
  });

  it('verifies exact stored evidence bytes and fails closed on hash mismatch', () => {
    const bytes = Buffer.from('%PDF-1.4\n'.padEnd(600, 'x'));
    const hash = sha256HexOfBytes(bytes);
    expect(verifyEvidenceBytes(bytes, hash)).toEqual({
      pdfBase64: bytes.toString('base64'), sha256: hash,
    });
    expect(() => verifyEvidenceBytes(bytes, '0'.repeat(64))).toThrow('evidence_hash_mismatch');
  });
});
