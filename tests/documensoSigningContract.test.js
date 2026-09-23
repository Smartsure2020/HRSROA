import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SIGNING_MARKERS } from '../src/lib/pdf/signingMarkers.js';
import {
  addRoaSigningFields,
  findDocumensoEnvelopeByExternalId,
} from '../api/_lib/documensoClient.js';

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.DOCUMENSO_BASE_URL = 'https://sign.example.test';
  process.env.DOCUMENSO_API_TOKEN = 'api_test';
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(process.env)) if (!(k in originalEnv)) delete process.env[k];
  Object.assign(process.env, originalEnv);
});

describe('Documenso ROA signing contract', () => {
  it('uses stable distinct provider-neutral anchors', () => {
    expect(new Set(Object.values(SIGNING_MARKERS)).size).toBe(4);
    expect(SIGNING_MARKERS.clientSignature).toContain('CLIENT_SIGNATURE');
    expect(SIGNING_MARKERS.advisorSignature).toContain('ADVISOR_SIGNATURE');
    expect(SIGNING_MARKERS.clientDate).toContain('CLIENT_DATE');
    expect(SIGNING_MARKERS.advisorDate).toContain('ADVISOR_DATE');
  });

  it('creates client then advisor signature/date fields from the machine anchors', async () => {
    let captured;
    vi.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
      captured = { url: String(url), options };
      return {
        ok: true,
        status: 200,
        async json() { return { data: [] }; },
      };
    });

    await addRoaSigningFields({
      envelopeId: 'envelope_test',
      envelope: {
        recipients: [
          { id: 11, signingOrder: 1 },
          { id: 22, signingOrder: 2 },
        ],
        envelopeItems: [{ id: 'item_1' }],
      },
    });

    expect(captured.url).toBe('https://sign.example.test/api/v2/envelope/field/create-many');
    const body = JSON.parse(captured.options.body);
    expect(body.envelopeId).toBe('envelope_test');
    expect(body.data).toHaveLength(4);
    expect(body.data.map((f) => [f.type, f.recipientId, f.placeholder])).toEqual([
      ['SIGNATURE', 11, SIGNING_MARKERS.clientSignature],
      ['DATE', 11, SIGNING_MARKERS.clientDate],
      ['SIGNATURE', 22, SIGNING_MARKERS.advisorSignature],
      ['DATE', 22, SIGNING_MARKERS.advisorDate],
    ]);
  });

  it('reconciles by exact ROA externalId rather than creating blindly', async () => {
    let requestedUrl = '';
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      requestedUrl = String(url);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            data: [
              { id: 'envelope_wrong', externalId: 'ROA-other' },
              { id: 'envelope_exact', externalId: 'ROA-123' },
            ],
          };
        },
      };
    });

    const found = await findDocumensoEnvelopeByExternalId('ROA-123');
    expect(found.id).toBe('envelope_exact');
    expect(requestedUrl).toContain('/api/v2/envelope?');
    expect(requestedUrl).toContain('query=ROA-123');
  });
});
