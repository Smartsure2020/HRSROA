import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import { layoutAcknowledgement } from '../src/lib/pdf/acknowledgementLayout.js';

describe('Personal and Commercial ROA acknowledgement layout', () => {
  const samples = [
    'I have read and understood the Broker Fee Consent above and consent to payment of intermediary fees for additional services performed by Holistic Risk Services, including assistance with rejected claims, visits, advice and guidance throughout the insurance policy period.',
    'I acknowledge the commercial obligations to provide underwriting information, to notify the intermediary of changes, and to review policy restrictions and warranties prior to signing.',
  ];
  it.each(samples)('wraps long labels completely within the printable column: %s', text => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const result = layoutAcknowledgement(doc, text, 180);
    expect(result.lines.length).toBeGreaterThan(1);
    expect(result.rowHeight).toBeGreaterThan(7);
    expect(result.lines.join(' ').replace(/\\s+/g, ' ').trim()).toBe(text);
    for (const line of result.lines) {
      expect(doc.getTextWidth(line)).toBeLessThanOrEqual(result.availableWidth + 0.2);
    }
  });
  it('keeps a short label on one row', () => {
    const doc = new jsPDF({ unit: 'mm' });
    const result = layoutAcknowledgement(doc, 'Confirmed', 180);
    expect(result.lines).toEqual(['Confirmed']);
    expect(result.rowHeight).toBe(7);
  });
});
