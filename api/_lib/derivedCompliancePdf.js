import { jsPDF } from 'jspdf';
import { HRS_COMPLIANCE_CONTENT } from '../../src/lib/hrsComplianceContent.js';
import { HRS_FSP_LINE, HRS_INFO } from '../../src/lib/hrsOrganisation.js';

export const DERIVED_COMPLIANCE_KINDS = ['broker-appointment', 'letter-investigation'];

function clean(value) {
  return String(value ?? '').trim();
}

function clientName(row) {
  const s = row?.snapshot_json || {};
  if (row?.roa_type === 'Commercial') {
    return clean(s.companyName || s.contactPerson || row.client_reference || 'Client');
  }
  return [s.title, s.firstName, s.surname].map(clean).filter(Boolean).join(' ')
    || clean(row?.client_reference)
    || 'Client';
}

function adviserName(row) {
  const s = row?.snapshot_json || {};
  return clean(s.brokerName || row?.advisor_email || 'Adviser');
}

function safeFilenamePart(value) {
  return clean(value)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Client';
}

export function hasAuthoritativeCompletionEvidence(row) {
  if (!row?.completed_at || !row?.signed_pdf_storage_path || !row?.certificate_storage_path) return false;
  const provider = clean(row.signing_provider || (row.docusign_envelope_id ? 'docusign' : '')).toLowerCase();
  return provider !== 'documenso' || Boolean(row.audit_log_storage_path);
}

export function derivedComplianceAvailability(row) {
  const snapshot = row?.snapshot_json || {};
  const complete = hasAuthoritativeCompletionEvidence(row);
  return {
    brokerAppointment: complete && snapshot.ackBrokerAppointment === true,
    letterInvestigation:
      complete
      && clean(snapshot.changingBroker).toLowerCase() === 'yes'
      && snapshot.ackLetterOfInvestigation === true,
  };
}

function block(doc, title, text, y, { bold = false } = {}) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  const lineHeight = 5;
  const lines = doc.splitTextToSize(text, width);
  const needed = 9 + lines.length * lineHeight;
  if (y + needed > pageHeight - 22) {
    doc.addPage();
    y = 22;
  }
  if (title) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(title, margin, y);
    y += 7;
  }
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(9);
  for (const line of lines) {
    doc.text(line, margin, y);
    y += lineHeight;
  }
  return y + 4;
}

function footer(doc, row) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(90);
    doc.text(
      `Derived from completed signed ROA ${row.id} | Page ${i} of ${pages}`,
      105,
      289,
      { align: 'center' },
    );
  }
}

export function buildDerivedCompliancePdf(row, kind) {
  if (!DERIVED_COMPLIANCE_KINDS.includes(kind)) {
    const err = new Error('invalid_derived_compliance_kind');
    err.code = 'invalid_derived_compliance_kind';
    throw err;
  }
  const availability = derivedComplianceAvailability(row);
  if (kind === 'broker-appointment' && !availability.brokerAppointment) {
    const err = new Error('broker_appointment_not_available');
    err.code = 'broker_appointment_not_available';
    throw err;
  }
  if (kind === 'letter-investigation' && !availability.letterInvestigation) {
    const err = new Error('letter_investigation_not_available');
    err.code = 'letter_investigation_not_available';
    throw err;
  }

  const snapshot = row.snapshot_json || {};
  const type = row.roa_type === 'Commercial' ? 'commercial' : 'personal';
  const isAppointment = kind === 'broker-appointment';
  const content = isAppointment
    ? HRS_COMPLIANCE_CONTENT.brokerAppointment[type]
    : HRS_COMPLIANCE_CONTENT.letterOfInvestigation[type];
  const version = isAppointment
    ? HRS_COMPLIANCE_CONTENT.brokerAppointment.version
    : HRS_COMPLIANCE_CONTENT.letterOfInvestigation.version;
  const title = isAppointment
    ? 'Broker Appointment Confirmation (Client Mandate)'
    : 'Letter of Investigation';

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const margin = 18;
  let y = 20;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(title, margin, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(80);
  doc.text(`${HRS_FSP_LINE} | Version ${version}`, margin, y);
  y += 10;
  doc.setTextColor(20);

  y = block(doc, 'Client', clientName(row), y, { bold: true });
  y = block(doc, 'Adviser', adviserName(row), y);
  y = block(doc, 'ROA type', row.roa_type || '—', y);

  if (isAppointment) {
    y = block(doc, null, content.intro, y);
    for (const section of content.sections) {
      y = block(doc, section.heading, section.text, y);
    }
    if (content.closing) y = block(doc, null, content.closing, y);
    y = block(doc, 'Client acknowledgement', content.ackLabel, y, { bold: true });
  } else {
    for (const paragraph of content.paragraphs) y = block(doc, null, paragraph, y);
    y = block(doc, 'Client acknowledgement', content.ackLabel, y, { bold: true });
  }

  y = block(
    doc,
    'Electronic-signature evidence',
    [
      'This document is an authorised derivative of the completed Record of Advice and is not a separate signing ceremony.',
      'The client acknowledgement above formed part of the frozen ROA content completed through the e-signature workflow.',
      'Signature authenticity and completion are evidenced by the retained signed ROA, signing-provider certificate and, for Documenso, the retained signing audit log.',
      `Submission ID: ${row.id}`,
      `Signing provider: ${clean(row.signing_provider || (row.docusign_envelope_id ? 'docusign' : 'unknown'))}`,
      `Envelope ID: ${clean(row.signing_envelope_id || row.docusign_envelope_id || '—')}`,
      `Completed: ${clean(row.completed_at || '—')}`,
      `Client: ${clientName(row)} — covered by completed ROA e-signature`,
      `Adviser: ${adviserName(row)} — covered by completed ROA e-signature`,
    ].join('\n'),
    y,
  );

  y = block(
    doc,
    'HRS',
    `${HRS_INFO.legalName} | FSP ${HRS_INFO.fspNumber} | ${HRS_INFO.phone} | ${HRS_INFO.website}`,
    y,
  );

  footer(doc, row);
  const bytes = Buffer.from(doc.output('arraybuffer'));
  const label = isAppointment ? 'Broker Appointment' : 'Letter of Investigation';
  return {
    bytes,
    filename: `${label} – ${safeFilenamePart(clientName(row))}.pdf`,
  };
}
