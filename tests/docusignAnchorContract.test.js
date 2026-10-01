// DocuSign ↔ PDF anchor contract (Phase ROA-0).
//
// The Powerhouse review found that the Commercial DocuSign envelope was
// anchoring to a label the Commercial PDF never rendered, and that
// `anchorIgnoreIfNotPresent: 'true'` silently swallowed the mismatch. This
// test proves the contract holds three ways:
//
//   1. The shared SIGNATURE_LABELS constants hold the exact strings that the
//      generated PDFs render (locked at the source-of-truth layer).
//   2. Both PDF generator sources actually reference SIGNATURE_LABELS via the
//      correct key. If somebody bypasses the constants and inlines a literal,
//      the source-read assertion catches it.
//   3. `buildEnvelope({roaType})` resolves the corresponding client anchor
//      and marks signHereTabs fail-closed (`anchorIgnoreIfNotPresent: 'false'`),
//      and throws for an unknown roaType.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SIGNATURE_LABELS,
  ROA_TYPES,
  getClientSignatureLabel,
  getAdvisorSignatureLabel,
} from '../src/lib/pdf/signatureLabels.js';
import { buildEnvelope } from '../api/_lib/buildEnvelope.js';

const REPO_ROOT = process.cwd();

function read(rel) {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

const PERSONAL_GENERATOR = read('src/lib/hrsPdfGenerator.js');
const COMMERCIAL_GENERATOR = read('src/lib/hrsCommercialPdfGenerator.js');

describe('SIGNATURE_LABELS — the anchor source of truth', () => {
  it('holds the exact literal strings the PDFs render', () => {
    expect(SIGNATURE_LABELS.personalClient).toBe('Client Signature');
    expect(SIGNATURE_LABELS.commercialClient).toBe('Client / Authorised Rep.');
    expect(SIGNATURE_LABELS.advisor).toBe('Advisor / Broker Signature');
  });

  it('freezes the map so it cannot be mutated at runtime', () => {
    expect(Object.isFrozen(SIGNATURE_LABELS)).toBe(true);
  });

  it('advertises exactly the ROA types supported by the envelope builder', () => {
    expect(ROA_TYPES).toEqual(['Personal', 'Commercial']);
  });

  it('resolves the correct client label per ROA type', () => {
    expect(getClientSignatureLabel('Personal')).toBe('Client Signature');
    expect(getClientSignatureLabel('Commercial')).toBe('Client / Authorised Rep.');
  });

  it('throws for an unknown ROA type instead of silently defaulting', () => {
    expect(() => getClientSignatureLabel('Motor')).toThrow(/Unknown ROA type/);
    expect(() => getClientSignatureLabel(undefined)).toThrow(/Unknown ROA type/);
  });

  it('returns a single advisor label used by both flows', () => {
    expect(getAdvisorSignatureLabel()).toBe('Advisor / Broker Signature');
  });
});

describe('PDF generators use the shared labels (not inlined literals)', () => {
  it('Personal generator references SIGNATURE_LABELS.personalClient exactly once', () => {
    const occurrences = PERSONAL_GENERATOR.match(/SIGNATURE_LABELS\.personalClient/g) || [];
    expect(occurrences.length).toBe(1);
  });

  it('Personal generator uses SIGNATURE_LABELS.advisor for the box and provider-neutral marker', () => {
    const occurrences = PERSONAL_GENERATOR.match(/SIGNATURE_LABELS\.advisor/g) || [];
    expect(occurrences.length).toBe(2);
  });

  it('Personal generator does not inline the Commercial client label', () => {
    expect(PERSONAL_GENERATOR).not.toContain('Client / Authorised Rep.');
  });

  it('Commercial generator references SIGNATURE_LABELS.commercialClient exactly once', () => {
    const occurrences = COMMERCIAL_GENERATOR.match(/SIGNATURE_LABELS\.commercialClient/g) || [];
    expect(occurrences.length).toBe(1);
  });

  it('Commercial generator uses SIGNATURE_LABELS.advisor for the box and provider-neutral marker', () => {
    const occurrences = COMMERCIAL_GENERATOR.match(/SIGNATURE_LABELS\.advisor/g) || [];
    expect(occurrences.length).toBe(2);
  });

  it('neither generator inlines the raw literal anchor strings for signature boxes', () => {
    // The literal may still appear in comments; anchor them to sigBox( calls to be strict.
    expect(PERSONAL_GENERATOR).not.toMatch(/sigBox\(\s*['"]Client Signature['"]/);
    expect(PERSONAL_GENERATOR).not.toMatch(/sigBox\(\s*['"]Advisor \/ Broker Signature['"]/);
    expect(COMMERCIAL_GENERATOR).not.toMatch(/sigBox\(\s*['"]Client \/ Authorised Rep\.['"]/);
    expect(COMMERCIAL_GENERATOR).not.toMatch(/sigBox\(\s*['"]Advisor \/ Broker Signature['"]/);
  });
});

const BASELINE = Object.freeze({
  signerName: 'Test Client',
  signerEmail: 'client@example.com',
  brokerName: 'Andrew Penney',
  brokerEmail: 'andrew@hrsinsurance.co.za',
  pdfBase64: 'YmFzZTY0LWJvZHk=', // not a real PDF; buildEnvelope never decodes it
  pdfFilename: 'HRS_ROA_Test_2026-09-14.pdf',
  transactionId: 'ROA-11111111-2222-3333-4444-555555555555',
});

describe('buildEnvelope — anchor contract', () => {
  it('includes the stable DocuSign transactionId unchanged', () => {
    const env = buildEnvelope({ ...BASELINE, roaType: 'Personal' });
    expect(env.transactionId).toBe(BASELINE.transactionId);
  });

  it('anchors the Personal client tab to "Client Signature"', () => {
    const env = buildEnvelope({ ...BASELINE, roaType: 'Personal' });
    const clientSigner = env.recipients.signers.find((s) => s.recipientId === '1');
    expect(clientSigner.tabs.signHereTabs[0].anchorString).toBe('Client Signature');
  });

  it('anchors the Commercial client tab to "Client / Authorised Rep."', () => {
    const env = buildEnvelope({ ...BASELINE, roaType: 'Commercial' });
    const clientSigner = env.recipients.signers.find((s) => s.recipientId === '1');
    expect(clientSigner.tabs.signHereTabs[0].anchorString).toBe('Client / Authorised Rep.');
  });

  it('anchors the advisor tab to "Advisor / Broker Signature" for both ROA types', () => {
    for (const roaType of ROA_TYPES) {
      const env = buildEnvelope({ ...BASELINE, roaType });
      const advisor = env.recipients.signers.find((s) => s.recipientId === '2');
      expect(advisor.tabs.signHereTabs[0].anchorString).toBe('Advisor / Broker Signature');
    }
  });

  it('marks every REQUIRED signHere tab fail-closed (anchorIgnoreIfNotPresent: "false")', () => {
    for (const roaType of ROA_TYPES) {
      const env = buildEnvelope({ ...BASELINE, roaType });
      for (const signer of env.recipients.signers) {
        for (const tab of signer.tabs.signHereTabs) {
          expect(tab.anchorIgnoreIfNotPresent).toBe('false');
        }
      }
    }
  });

  it('keeps dateSigned tabs tolerant (Certificate of Completion is the legal date)', () => {
    for (const roaType of ROA_TYPES) {
      const env = buildEnvelope({ ...BASELINE, roaType });
      for (const signer of env.recipients.signers) {
        for (const tab of signer.tabs.dateSignedTabs) {
          expect(tab.anchorIgnoreIfNotPresent).toBe('true');
        }
      }
    }
  });

  it('routes client (order 1) before advisor (order 2)', () => {
    const env = buildEnvelope({ ...BASELINE, roaType: 'Personal' });
    const [client, advisor] = env.recipients.signers;
    expect(client.recipientId).toBe('1');
    expect(client.routingOrder).toBe('1');
    expect(advisor.recipientId).toBe('2');
    expect(advisor.routingOrder).toBe('2');
  });

  it('throws for an unknown roaType — envelope creation cannot silently proceed', () => {
    expect(() => buildEnvelope({ ...BASELINE, roaType: 'Motor' })).toThrow(/Unknown ROA type/);
  });
});
