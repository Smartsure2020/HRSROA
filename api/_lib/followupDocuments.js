import { jsPDF } from 'jspdf';
import { BANKS, ACCOUNT_TYPES, FOLLOWUP_COLLECTION_DATES } from '../../src/lib/bankingChoices.js';

export const COLLECTION_DATES = FOLLOWUP_COLLECTION_DATES;

// This is a confirmation of details, not a debit authority. No premium or
// mandate terms are included. The recipient fills Documenso fields before signing.
export function bankingConfirmationPdf({ submissionId, signerName }) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text('Banking Details Confirmation', 20, 24);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.text(`ROA revision: ${submissionId}`, 20, 33);
  pdf.text(`Client: ${signerName}`, 20, 40);
  pdf.text('Please enter or review your banking details and selected monthly collection date.', 20, 49);
  const labels = [
    'Policy Holder Name (as on bank account)', 'Bank name', 'Account type', 'Account number',
    'Branch code', 'Branch name (if applicable)', 'Monthly collection date',
  ];
  labels.forEach((label, index) => {
    const y = 64 + index * 22;
    pdf.setFont('helvetica', 'bold');
    pdf.text(label, 20, y);
    pdf.setDrawColor(150);
    pdf.rect(20, y + 3, 170, 12);
  });
  pdf.setFont('helvetica', 'normal');
  pdf.text('I confirm the banking details and monthly collection date shown above.', 20, 226);
  pdf.text('Signature', 20, 239);
  pdf.rect(20, 243, 90, 22);
  return Buffer.from(pdf.output('arraybuffer'));
}

export function bankingFields({ recipientId, envelopeItemId }) {
  const base = { recipientId, envelopeItemId, page: 1, positionX: 10, width: 79, height: 3.5 };
  const field = (index, type, label, options = {}) => ({
    ...base, type, positionY: 23 + index * 7.4,
    fieldMeta: { type: type.toLowerCase(), label, required: index !== 5, ...options },
  });
  return [
    field(0, 'TEXT', 'Policy Holder Name (as on bank account)', { characterLimit: 100 }),
    field(1, 'DROPDOWN', 'Bank name', { values: BANKS.map(value => ({ value })) }),
    field(2, 'DROPDOWN', 'Account type', { values: ACCOUNT_TYPES.map(value => ({ value })) }),
    field(3, 'TEXT', 'Account number', { characterLimit: 34 }),
    field(4, 'TEXT', 'Branch code', { characterLimit: 16 }),
    field(5, 'TEXT', 'Branch name', { characterLimit: 100 }),
    field(6, 'DROPDOWN', 'Monthly collection date', {
      values: COLLECTION_DATES.map(value => ({ value })),
    }),
    { ...base, type: 'SIGNATURE', positionY: 83, width: 42, height: 7.5,
      fieldMeta: { type: 'signature', required: true } },
  ];
}

export function validSchedulePosition({ page, x, y, pageCount }) {
  return Number.isInteger(page) && page >= 1 && page <= pageCount
    && Number.isFinite(x) && x >= 0 && x <= 58
    && Number.isFinite(y) && y >= 0 && y <= 92;
}
