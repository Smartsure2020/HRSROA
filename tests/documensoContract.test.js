import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SIGNATURE_LABELS,
  SIGNATURE_MARKERS,
} from '../src/lib/pdf/signatureLabels.js';
import {
  getDocumensoConfig,
  mapDocumensoEnvelopeState,
} from '../api/_lib/documensoClient.js';

const originalUrl = process.env.DOCUMENSO_API_URL;
const originalToken = process.env.DOCUMENSO_API_TOKEN;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.DOCUMENSO_API_URL;
  else process.env.DOCUMENSO_API_URL = originalUrl;
  if (originalToken === undefined) delete process.env.DOCUMENSO_API_TOKEN;
  else process.env.DOCUMENSO_API_TOKEN = originalToken;
});

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const personalPdfSource = read('src/lib/hrsPdfGenerator.js');
const commercialPdfSource = read('src/lib/hrsCommercialPdfGenerator.js');

describe('Documenso configuration', () => {
  it('requires an explicit API URL and server-side token', () => {
    delete process.env.DOCUMENSO_API_URL;
    delete process.env.DOCUMENSO_API_TOKEN;
    expect(() => getDocumensoConfig()).toThrow(/DOCUMENSO_API_URL.*DOCUMENSO_API_TOKEN/);

    process.env.DOCUMENSO_API_URL = 'https://sign.example/api/v2/';
    process.env.DOCUMENSO_API_TOKEN = 'api_test';
    expect(getDocumensoConfig()).toEqual({
      apiUrl: 'https://sign.example/api/v2',
      apiToken: 'api_test',
    });
  });
});

describe('Documenso lifecycle mapping', () => {
  it.each([
    ['DRAFT', 'draft', 'awaiting_signature'],
    ['PENDING', 'pending', 'awaiting_signature'],
    ['COMPLETED', 'completed', 'completed'],
    ['REJECTED', 'rejected', 'declined'],
    ['CANCELLED', 'cancelled', 'voided'],
  ])('%s maps truthfully', (status, providerStatus, lifecycleStatus) => {
    expect(mapDocumensoEnvelopeState({ status })).toEqual({
      providerStatus,
      lifecycleStatus,
    });
  });

  it('does not invent a lifecycle state for an unknown provider status', () => {
    expect(mapDocumensoEnvelopeState({ status: 'SOMETHING_NEW' })).toEqual({
      providerStatus: 'something_new',
      lifecycleStatus: null,
    });
  });
});

describe('canonical PDF ↔ Documenso placement contract', () => {
  it('keeps the existing visible signature labels', () => {
    expect(SIGNATURE_LABELS.personalClient).toBe('Client Signature');
    expect(SIGNATURE_LABELS.commercialClient).toBe('Client / Authorised Rep.');
    expect(SIGNATURE_LABELS.advisor).toBe('Advisor / Broker Signature');
  });

  it('uses four unique, PII-free hidden markers', () => {
    const markers = Object.values(SIGNATURE_MARKERS);
    expect(markers).toHaveLength(4);
    expect(new Set(markers).size).toBe(4);
    for (const marker of markers) {
      expect(marker).toMatch(/^HRS_ROA_[A-Z]{2}$/);
      expect(marker).not.toMatch(/@|\s|client|advisor/i);
    }
  });

  it('renders client + advisor signature/date markers in Personal', () => {
    expect(personalPdfSource).toContain('SIGNATURE_MARKERS.clientSignature');
    expect(personalPdfSource).toContain('SIGNATURE_MARKERS.clientDate');
    expect(personalPdfSource).toContain('SIGNATURE_MARKERS.advisorSignature');
    expect(personalPdfSource).toContain('SIGNATURE_MARKERS.advisorDate');
  });

  it('renders client + advisor signature/date markers in Commercial', () => {
    expect(commercialPdfSource).toContain('SIGNATURE_MARKERS.clientSignature');
    expect(commercialPdfSource).toContain('SIGNATURE_MARKERS.clientDate');
    expect(commercialPdfSource).toContain('SIGNATURE_MARKERS.advisorSignature');
    expect(commercialPdfSource).toContain('SIGNATURE_MARKERS.advisorDate');
  });

  it('renders machine markers in background colour at tiny font size', () => {
    for (const source of [personalPdfSource, commercialPdfSource]) {
      expect(source).toContain("d.setFontSize(1.1)");
      expect(source).toContain("d.setTextColor(...C.lightBg)");
    }
  });
});
