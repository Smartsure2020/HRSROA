import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { jsPDF } from 'jspdf';
import { bankingConfirmationPdf, bankingFields, validSchedulePosition } from '../api/_lib/followupDocuments.js';
import { addFollowupFields } from '../api/_lib/documensoClient.js';

const oldEnv = { ...process.env };
beforeEach(() => { process.env.DOCUMENSO_BASE_URL = 'https://sign.example.test'; process.env.DOCUMENSO_API_TOKEN = 'api_test'; });
afterEach(() => { vi.restoreAllMocks(); Object.assign(process.env, oldEnv); });

describe('follow-up signing documents', () => {
  it('generates a blank confirmation without premium or debit authority and offers exactly five dates', async () => {
    const bytes = bankingConfirmationPdf({ submissionId: 'ROA-11111111-1111-4111-8111-111111111111', signerName: 'Synthetic Client' });
    const document = await getDocument({ data: new Uint8Array(bytes) }).promise;
    const page = await document.getPage(1);
    const text = (await page.getTextContent()).items.map(item => item.str).join(' ');
    expect(text).toContain('Banking Details Confirmation');
    expect(text).toContain('Account number');
    expect(text).toContain('Branch code');
    expect(text).not.toMatch(/premium|amount|mandate|authority to debit/i);
    const fields = bankingFields({ recipientId: 7, envelopeItemId: 'item_1' });
    expect(fields).toHaveLength(8);
    expect(fields.find(field => field.fieldMeta.label === 'Monthly collection date').fieldMeta.values.map(item => item.value))
      .toEqual(['1st', '5th', '7th', '15th', '25th']);
    expect(fields.filter(field => ['Account number', 'Branch code'].includes(field.fieldMeta.label)).every(field => field.type === 'TEXT')).toBe(true);
    expect(fields.find(field => field.fieldMeta.label === 'Branch name').fieldMeta.required).toBe(false);
    await document.destroy();
  });

  it('places one signature on the selected page and exact percentage of a multi-page schedule', async () => {
    const syntheticSchedule = new jsPDF();
    for (let index = 2; index <= 4; index += 1) { syntheticSchedule.addPage(); syntheticSchedule.text(`Synthetic schedule page ${index}`, 20, 20); }
    const scheduleBytes = new Uint8Array(syntheticSchedule.output('arraybuffer'));
    const opened = await getDocument({ data: scheduleBytes }).promise;
    expect(opened.numPages).toBe(4);
    const calls = [];
    vi.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/envelope/e1')) return { ok: true, json: async () => ({
        recipients: [{ id: 7 }], envelopeItems: [{ id: 'item_1' }], fields: [],
      }) };
      return { ok: true, json: async () => ({ data: [{ id: 99 }] }) };
    });
    expect(validSchedulePosition({ page: 3, x: 41.25, y: 82.5, pageCount: opened.numPages })).toBe(true);
    expect(validSchedulePosition({ page: 5, x: 41.25, y: 82.5, pageCount: opened.numPages })).toBe(false);
    await addFollowupFields({ envelopeId: 'e1', request: { kind: 'schedule', signature_page: 3,
      signature_x: 41.25, signature_y: 82.5 } });
    const field = JSON.parse(calls[1].options.body).data[0];
    expect(field).toMatchObject({ type: 'SIGNATURE', page: 3, positionX: 41.25, positionY: 82.5, envelopeItemId: 'item_1' });
    await opened.destroy();
  });
});
