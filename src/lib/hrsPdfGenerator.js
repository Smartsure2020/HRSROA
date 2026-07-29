import { jsPDF } from 'jspdf';
import { RISK_CATEGORIES, PRINCIPLES } from './hrsConstants';
import logoUrl from '../assets/hrs-logo.png';
import { HRS_COMPLIANCE_CONTENT, getStatutoryDisclosureEvidence } from './hrsComplianceContent';
import { getBrokerFeeSummary } from './brokerFee';
import { HRS_PDF_THEME, drawDocumentHeader, drawPageFooter, drawSectionHeader, drawClientSummary, ensurePageSpace } from './pdf/hrsPdfTheme';

const APPOINTMENT = HRS_COMPLIANCE_CONTENT.brokerAppointment.personal;
const FEE_CONTENT = HRS_COMPLIANCE_CONTENT.brokerFeeConsent;
const INVESTIGATION_CONTENT = HRS_COMPLIANCE_CONTENT.letterOfInvestigation.personal;
const DECLARATION_CONTENT = HRS_COMPLIANCE_CONTENT.clientDeclaration.personal;
const ELECTION_WARNING_CONTENT = HRS_COMPLIANCE_CONTENT.electionWarning.personal;

function yn(val) {
  return val === 'yes' ? 'Yes' : val === 'no' ? 'No' : 'Not answered';
}
function fmt(val) {
  return (val !== null && val !== undefined && val !== '') ? String(val) : '-';
}
async function loadImgAsDataURL(src) {
  if (!src) return null;
  if (src.startsWith('data:')) return src;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      try { resolve(canvas.toDataURL('image/png')); } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

const C = {
  blue:    HRS_PDF_THEME.colors.accent,
  orange:  HRS_PDF_THEME.colors.warmAccent,
  green:   HRS_PDF_THEME.colors.success,
  red:     HRS_PDF_THEME.colors.danger,
  white:   HRS_PDF_THEME.colors.white,
  black:   HRS_PDF_THEME.colors.text,
  grey:    HRS_PDF_THEME.colors.muted,
  lightBg: HRS_PDF_THEME.colors.light,
  border:  HRS_PDF_THEME.colors.border,
  gold:    HRS_PDF_THEME.colors.warning,
  goldTxt: [70, 50, 5],
};

const PAGE_W = HRS_PDF_THEME.page.width, PAGE_H = HRS_PDF_THEME.page.height;
const ML = HRS_PDF_THEME.margin.left, MR = HRS_PDF_THEME.margin.right;
const CW = PAGE_W - ML - MR;
const LW = 60;

function getPdfMetadata(formData) {
  const disclosure = getStatutoryDisclosureEvidence(formData);
  return {
    productLine: 'Short-term Insurance: Personal Lines',
    clientName: [formData.title, formData.firstName, formData.surname].filter(Boolean).join(' ') || 'Client',
    advisorName: formData.brokerName,
    policyType: formData.policyType,
    documentDate: formData.sigDate || formData.inceptionDate,
    disclosureVersion: disclosure.version,
    documentType: 'Personal Lines ROA',
  };
}

class PDFBuilder {
  constructor(logoDataURL, metadata = {}) {
    this.doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    this.logo = logoDataURL;
    this.metadata = metadata;
    this.ml = ML;
    this.cw = CW;
    this.pageNum = 1;
    this.cy = 0;
    this._drawHeader();
    this._drawFooter();
    this.cy = HRS_PDF_THEME.headerHeight + 19;
  }

  _needSpace(h) {
    ensurePageSpace(this, h);
  }

  _newPage() {
    this.doc.addPage();
    this.pageNum++;
    this._drawHeader();
    this._drawFooter();
    this.cy = 18;
  }

  _drawHeader() {
    drawDocumentHeader(this.doc, { ...this.metadata, logo: this.logo, firstPage: this.pageNum === 1 });
  }

  _drawTextLogo(d) {
    d.setFont('helvetica', 'bold'); d.setFontSize(10); d.setTextColor(...C.blue);
    d.text('HRS', ML + 25, 18, { align: 'center' });
  }

  _drawFooter() {
    drawPageFooter(this.doc, { pageNumber: this.pageNum, documentType: this.metadata.documentType });
  }

  _finalizeFooters() {
    const totalPages = this.doc.getNumberOfPages();
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      this.doc.setPage(pageNumber);
      drawPageFooter(this.doc, { pageNumber, totalPages, documentType: this.metadata.documentType });
    }
  }

  // keepWithH: minimum height of first content block that must fit with the heading
  sectionHeading(title, keepWithH = 14) {
    const match = String(title).match(/^\s*(\d+)\.\s*(.*)$/);
    drawSectionHeader(this, match?.[2] || title, match?.[1] || '', keepWithH);
  }

  clientSummary(items) { drawClientSummary(this, items); }

  subHeading(title, keepWithH = 12) {
    this._needSpace(9 + keepWithH);
    const d = this.doc;
    d.setFillColor(...C.lightBg); d.rect(ML, this.cy, CW, 7, 'F');
    d.setFillColor(...C.orange); d.rect(ML, this.cy, 2.5, 7, 'F');
    d.setFont('helvetica', 'bold'); d.setFontSize(7.5); d.setTextColor(...C.blue);
    d.text(title.toUpperCase(), ML + 6, this.cy + 5);
    this.cy += 9;
  }

  dataRow(label, value, shade = false) {
    const d = this.doc;
    const valStr = fmt(value);
    const lines = d.splitTextToSize(valStr, CW - LW - 4);
    const rh = Math.max(7, lines.length * 4.8 + 2.5);
    this._needSpace(rh);
    if (shade) d.setFillColor(...C.lightBg).rect(ML, this.cy, CW, rh, 'F');
    d.setDrawColor(...C.border); d.setLineWidth(0.2);
    d.line(ML, this.cy + rh, ML + CW, this.cy + rh);
    d.line(ML + LW, this.cy, ML + LW, this.cy + rh);
    d.setFont('helvetica', 'normal'); d.setFontSize(7.3); d.setTextColor(...C.grey);
    d.text(label, ML + 3, this.cy + rh / 2 + 1.5);
    d.setFont('helvetica', lines.length > 1 ? 'normal' : 'bold');
    d.setFontSize(7.6); d.setTextColor(...C.black);
    lines.forEach((l, i) => d.text(l, ML + LW + 3, this.cy + 4.5 + i * 4.8));
    this.cy += rh;
  }

  multiLineDataRow(label, value, shade = false) {
    const d = this.doc;
    const valStr = fmt(value);
    const lines = d.splitTextToSize(valStr, CW - 8);
    const rh = Math.max(14, lines.length * 5 + 6);
    this._needSpace(rh);
    if (shade) d.setFillColor(...C.lightBg).rect(ML, this.cy, CW, rh, 'F');
    d.setDrawColor(...C.border); d.setLineWidth(0.2);
    d.line(ML, this.cy + rh, ML + CW, this.cy + rh);
    d.setFont('helvetica', 'normal'); d.setFontSize(7.3); d.setTextColor(...C.grey);
    d.text(label, ML + 3, this.cy + 6);
    d.setFont('helvetica', 'normal'); d.setFontSize(7.5); d.setTextColor(...C.black);
    lines.forEach((line, i) => d.text(line, ML + 3, this.cy + 13 + i * 5));
    this.cy += rh;
  }

  twoColRow(left, right, shade = false) {
    const d = this.doc;
    const half = CW / 2;
    const lw = 38;
    const rh = 7;
    this._needSpace(rh);
    if (shade) d.setFillColor(...C.lightBg).rect(ML, this.cy, CW, rh, 'F');
    d.setDrawColor(...C.border); d.setLineWidth(0.2);
    d.line(ML, this.cy + rh, ML + CW, this.cy + rh);
    d.line(ML + half, this.cy, ML + half, this.cy + rh);
    d.setFont('helvetica', 'normal'); d.setFontSize(7.2); d.setTextColor(...C.grey);
    d.text(left.label, ML + 3, this.cy + 5);
    d.text(right.label, ML + half + 3, this.cy + 5);
    d.setFont('helvetica', 'bold'); d.setFontSize(7.6); d.setTextColor(...C.black);
    d.text(fmt(left.value), ML + lw, this.cy + 5);
    d.text(fmt(right.value), ML + half + lw, this.cy + 5);
    this.cy += rh;
  }

  ackRow(label, checked, shade = false) {
    const d = this.doc;
    const rh = 7;
    this._needSpace(rh);
    if (shade) d.setFillColor(...C.lightBg).rect(ML, this.cy, CW, rh, 'F');
    d.setDrawColor(...C.border); d.setLineWidth(0.2);
    d.line(ML, this.cy + rh, ML + CW, this.cy + rh);
    if (checked) {
      d.setFillColor(...C.green); d.roundedRect(ML + 3, this.cy + 1.8, 4, 4, 0.5, 0.5, 'F');
      d.setFont('helvetica', 'bold'); d.setFontSize(7); d.setTextColor(...C.white);
      d.text('v', ML + 4.3, this.cy + 5.2);
    } else {
      d.setDrawColor(...C.red); d.setLineWidth(0.5); d.rect(ML + 3, this.cy + 1.8, 4, 4);
    }
    const col = checked ? C.green : C.red;
    d.setFont('helvetica', 'bold'); d.setFontSize(7.2); d.setTextColor(...col);
    d.text(checked ? 'Acknowledged' : 'Not acknowledged', ML + 10, this.cy + 5);
    d.setFont('helvetica', 'normal'); d.setTextColor(...C.black);
    d.text(label, ML + 48, this.cy + 5);
    this.cy += rh;
  }

  // Print a principle with its full text
  principleRow(number, text, checked, shade) {
    const d = this.doc;
    const lines = d.splitTextToSize(`${number}. ${text}`, CW - 20);
    const rh = Math.max(7, lines.length * 4.5 + 3);
    this._needSpace(rh);
    if (shade) d.setFillColor(...C.lightBg).rect(ML, this.cy, CW, rh, 'F');
    d.setDrawColor(...C.border); d.setLineWidth(0.2);
    d.line(ML, this.cy + rh, ML + CW, this.cy + rh);
    if (checked) {
      d.setFillColor(...C.green); d.roundedRect(ML + 3, this.cy + 1.8, 4, 4, 0.5, 0.5, 'F');
      d.setFont('helvetica', 'bold'); d.setFontSize(7); d.setTextColor(...C.white);
      d.text('v', ML + 4.3, this.cy + 5.2);
    } else {
      d.setDrawColor(...C.red); d.setLineWidth(0.5); d.rect(ML + 3, this.cy + 1.8, 4, 4);
    }
    d.setFont('helvetica', 'normal'); d.setFontSize(7.2); d.setTextColor(...C.black);
    lines.forEach((l, i) => d.text(l, ML + 12, this.cy + 5 + i * 4.5));
    this.cy += rh;
  }

  // Print a disclosure block with full text then ack row
  disclosureBlock(title, bodyLines, ackLabel, checked) {
    const d = this.doc;
    const allLines = d.splitTextToSize(bodyLines, CW - 6);
    const bodyH = Math.max(10, allLines.length * 4.5 + 4);
    // Keep subheading + body + ack together; cap at 90mm to avoid excessive white space
    this._needSpace(Math.min(9 + bodyH + 7 + 2, 90));
    // Sub-heading
    d.setFillColor(...C.lightBg); d.rect(ML, this.cy, CW, 7, 'F');
    d.setFillColor(...C.orange); d.rect(ML, this.cy, 2.5, 7, 'F');
    d.setFont('helvetica', 'bold'); d.setFontSize(7.5); d.setTextColor(...C.blue);
    d.text(title.toUpperCase(), ML + 6, this.cy + 5);
    this.cy += 9;
    // Body text
    d.setFont('helvetica', 'normal'); d.setFontSize(7); d.setTextColor(...C.black);
    allLines.forEach((line, i) => {
      d.text(line, ML + 3, this.cy + 5 + i * 4.5);
    });
    this.cy += bodyH;
    // Ack row
    this.ackRow(ackLabel, checked, false);
    this.gap(2);
  }

  riskRow(name, note, cover, sasria, shade, flagged = false) {
    const d = this.doc;
    const rh = note ? 9.5 : 7;
    this._needSpace(rh);
    if (flagged) {
      d.setFillColor(255, 251, 235);
      d.rect(ML, this.cy, CW, rh, 'F');
      d.setFillColor(251, 191, 36);
      d.rect(ML, this.cy, 3, rh, 'F');
    } else if (shade) {
      d.setFillColor(...C.lightBg).rect(ML, this.cy, CW, rh, 'F');
    }
    d.setDrawColor(...C.border); d.setLineWidth(0.2);
    d.line(ML, this.cy + rh, ML + CW, this.cy + rh);
    d.setFont('helvetica', 'bold'); d.setFontSize(7.3); d.setTextColor(...C.black);
    d.text(name, ML + 3, this.cy + 5);
    if (note) {
      d.setFont('helvetica', 'italic'); d.setFontSize(5.8); d.setTextColor(...C.grey);
      d.text(note, ML + 3, this.cy + 8.8);
    }
    const bx = ML + CW - 55;
    if (cover === 'yes') {
      d.setFillColor(...C.green); d.roundedRect(bx, this.cy + 1.5, 24, 5, 1, 1, 'F');
      d.setFont('helvetica', 'bold'); d.setFontSize(6.3); d.setTextColor(...C.white);
      d.text('YES - COVERED', bx + 2.5, this.cy + 5.2);
    } else if (cover === 'no') {
      d.setFillColor(...C.red); d.roundedRect(bx, this.cy + 1.5, 24, 5, 1, 1, 'F');
      d.setFont('helvetica', 'bold'); d.setFontSize(6.3); d.setTextColor(...C.white);
      d.text('NO - EXCLUDED', bx + 2.5, this.cy + 5.2);
    } else {
      d.setDrawColor(...C.border); d.roundedRect(bx, this.cy + 1.5, 24, 5, 1, 1, 'S');
      d.setFont('helvetica', 'normal'); d.setFontSize(6.3); d.setTextColor(...C.grey);
      d.text('Not specified', bx + 2.5, this.cy + 5.2);
    }
    if (cover === 'yes') {
      const sx = bx + 27;
      if (sasria) {
        d.setFillColor(...C.blue); d.roundedRect(sx, this.cy + 1.5, 16, 5, 1, 1, 'F');
        d.setFont('helvetica', 'bold'); d.setFontSize(6); d.setTextColor(...C.white);
        d.text('SASRIA', sx + 2.2, this.cy + 5.2);
      } else {
        d.setDrawColor(...C.border); d.roundedRect(sx, this.cy + 1.5, 16, 5, 1, 1, 'S');
        d.setFont('helvetica', 'normal'); d.setFontSize(6); d.setTextColor(...C.grey);
        d.text('SASRIA', sx + 2.2, this.cy + 5.2);
      }
    }
    this.cy += rh;
  }

  insurerCards(options) {
    this._needSpace(50);
    const d = this.doc;
    const gap = 4;
    const cw = (CW - gap * 2) / 3;
    const ch = 34;
    const badgeH = 7;
    const topY = this.cy + badgeH;
    options.forEach(({ insurer, premium, label, recommended }, idx) => {
      const cx = ML + idx * (cw + gap);
      if (recommended) {
        d.setFillColor(...C.gold);
        d.roundedRect(cx + cw / 2 - 17, topY - badgeH, 34, badgeH - 0.5, 2, 2, 'F');
        d.setFont('helvetica', 'bold'); d.setFontSize(6.5); d.setTextColor(...C.goldTxt);
        d.text('RECOMMENDED', cx + cw / 2, topY - 1.5, { align: 'center' });
        d.setFillColor(...C.blue);
        d.roundedRect(cx, topY, cw, ch, 2, 2, 'F');
        d.setTextColor(...C.white);
      } else {
        d.setFillColor(...C.lightBg);
        d.roundedRect(cx, topY, cw, ch, 2, 2, 'F');
        d.setDrawColor(...C.border); d.setLineWidth(0.3);
        d.roundedRect(cx, topY, cw, ch, 2, 2, 'S');
        d.setTextColor(...C.grey);
      }
      d.setFont('helvetica', 'bold'); d.setFontSize(6.5);
      d.text(label, cx + cw / 2, topY + 7, { align: 'center' });
      d.setDrawColor(recommended ? 70 : C.border[0], recommended ? 90 : C.border[1], recommended ? 140 : C.border[2]);
      d.setLineWidth(0.2);
      d.line(cx + 4, topY + 9, cx + cw - 4, topY + 9);
      d.setFont('helvetica', 'normal'); d.setFontSize(7);
      d.setTextColor(recommended ? C.white[0] : C.black[0], recommended ? C.white[1] : C.black[1], recommended ? C.white[2] : C.black[2]);
      const inLines = d.splitTextToSize(fmt(insurer), cw - 6);
      inLines.slice(0, 2).forEach((l, i) => d.text(l, cx + cw / 2, topY + 14 + i * 4.5, { align: 'center' }));
      d.setFont('helvetica', 'bold'); d.setFontSize(11.5);
      d.setTextColor(recommended ? C.orange[0] : C.blue[0], recommended ? C.orange[1] : C.blue[1], recommended ? C.orange[2] : C.blue[2]);
      d.text(premium ? `R ${premium}` : '-', cx + cw / 2, topY + 27, { align: 'center' });
      d.setFont('helvetica', 'normal'); d.setFontSize(5.8);
      d.setTextColor(recommended ? 175 : C.grey[0], recommended ? 185 : C.grey[1], recommended ? 215 : C.grey[2]);
      d.text('per month', cx + cw / 2, topY + 32, { align: 'center' });
    });
    this.cy = topY + ch + 5;
  }

  sigBox(label, sigDataURL, x, y, w, h) {
    const d = this.doc;
    d.setFillColor(...C.lightBg); d.roundedRect(x, y, w, h, 1.5, 1.5, 'F');
    d.setDrawColor(...C.border); d.setLineWidth(0.4); d.roundedRect(x, y, w, h, 1.5, 1.5, 'S');
    d.setFillColor(...C.blue); d.roundedRect(x, y, w, 6.5, 1.5, 1.5, 'F');
    d.rect(x, y + 3.5, w, 3, 'F');
    d.setFont('helvetica', 'bold'); d.setFontSize(7); d.setTextColor(...C.white);
    d.text(label.toUpperCase(), x + w / 2, y + 5, { align: 'center' });
    if (sigDataURL) {
      try {
        const props = d.getImageProperties(sigDataURL);
        const scale = Math.min((w - 10) / props.width, (h - 18) / props.height);
        const imageW = props.width * scale;
        const imageH = props.height * scale;
        d.addImage(sigDataURL, 'PNG', x + (w - imageW) / 2, y + 9 + ((h - 18) - imageH) / 2, imageW, imageH, undefined, 'MEDIUM');
      } catch {
        d.setFont('helvetica', 'italic'); d.setFontSize(6.5); d.setTextColor(...C.grey);
        d.text('Signature image unavailable', x + w / 2, y + 20, { align: 'center' });
      }
    } else {
      d.setDrawColor(...C.border); d.setLineWidth(0.3); d.setLineDash([1.5, 1.5]);
      d.line(x + 8, y + h - 9, x + w - 8, y + h - 9);
      d.setLineDash([]);
      d.setFont('helvetica', 'italic'); d.setFontSize(6.5); d.setTextColor(...C.grey);
      d.text('Sign here', x + w / 2, y + h - 5, { align: 'center' });
    }
    d.setFont('helvetica', 'normal'); d.setFontSize(6.5); d.setTextColor(...C.grey);
    d.text('Date: ________________________', x + 4, y + h - 1.5);
  }

  gap(n = 5) { this.cy += n; }
  save(filename) { this.doc.save(filename); }
}

function buildROA(pdf, formData, clientSig, advisorSig) {
  const fullName = [formData.title, formData.firstName, formData.surname].filter(Boolean).join(' ').trim() || 'Client';
  const address = [formData.streetNumber, formData.streetName, formData.complexName, formData.suburb, formData.city, formData.province, formData.postalCode]
    .filter(Boolean).join(', ') || '-';
  const feeSummary = getBrokerFeeSummary(formData);
  const feeStr = feeSummary.consentRequired ? feeSummary.displayValue : 'No broker fee applicable';
  const disclosureEvidence = getStatutoryDisclosureEvidence(formData);

  let sh = false;

  pdf.clientSummary([
    { label: 'Client', value: fullName },
    { label: 'ID / Passport', value: formData.idNumber },
    { label: 'Contact', value: formData.cell },
    { label: 'Email', value: formData.email },
    { label: 'Risk address', value: address },
    { label: 'Policy type', value: formData.policyType },
    { label: 'Existing insurer / policy', value: formData.existingPolicyRef },
    { label: 'Advisor', value: formData.brokerName },
  ]);

  // 1. CLIENT DETAILS
  pdf.sectionHeading('1.  CLIENT DETAILS');
  pdf.dataRow('Broker / Advisor', formData.brokerName, sh = !sh);
  pdf.twoColRow({ label: 'Title', value: formData.title }, { label: 'Initial(s)', value: formData.initials }, sh = !sh);
  pdf.twoColRow({ label: 'First Name', value: formData.firstName }, { label: 'Surname', value: formData.surname }, sh = !sh);
  pdf.twoColRow({ label: 'ID / Passport', value: formData.idNumber }, { label: 'Marital Status', value: formData.maritalStatus }, sh = !sh);
  pdf.twoColRow({ label: 'Email', value: formData.email }, { label: 'Cell', value: formData.cell }, sh = !sh);
  pdf.twoColRow({ label: 'Work / Home', value: formData.workNumber }, { label: 'Occupation', value: formData.occupation }, sh = !sh);
  pdf.dataRow('Risk Address', address, sh = !sh);
  pdf.dataRow('FAIS Disclosure Provided', yn(formData.faisProvided), sh = !sh);
  pdf.twoColRow({ label: 'Policy Type', value: formData.policyType }, { label: 'Existing Insurer / Policy No.', value: formData.existingPolicyRef }, sh = !sh);
  pdf.gap();

  // 2. INSURANCE HISTORY
  pdf.sectionHeading('2.  INSURANCE HISTORY');
  sh = false;
  pdf.twoColRow({ label: 'Uninterrupted STI', value: yn(formData.uninterruptedInsurance) }, { label: 'Years Insured', value: formData.yearsInsured }, sh = !sh);
  pdf.dataRow('Special Terms / Cover Refused', yn(formData.specialTerms), sh = !sh);
  if (formData.specialTerms === 'yes') pdf.dataRow('Reason', formData.cancelReasonText, sh = !sh);
  pdf.dataRow('Client Declined to Provide Information', yn(formData.clientDeclinedInfo), sh = !sh);
  pdf.multiLineDataRow('Client Needs and Objectives', formData.clientNeeds);
  pdf.gap();

  // 3. PRODUCTS AND ADVICE
  // heading(11) + gap(8) + cards(50) = 69mm minimum needed together
  pdf.sectionHeading('3.  PRODUCTS AND ADVICE', 65);
  pdf.gap(8);
  pdf.insurerCards([
    { insurer: formData.ins0, premium: formData.prem0, label: 'OPTION 1', recommended: false },
    { insurer: formData.ins1, premium: formData.prem1, label: 'OPTION 2', recommended: false },
    { insurer: formData.ins2, premium: formData.prem2, label: 'OPTION 3', recommended: true },
  ]);
  sh = false;
  pdf.dataRow('Recommended Insurer', formData.recInsurer, sh = !sh);
  pdf.dataRow('Broker Fee', feeStr, sh = !sh);
  pdf.multiLineDataRow('Reasons for Recommendation', formData.recReasons);
  pdf.gap(2);
  // keepWithH=20 ensures the subheading stays with the first content block
  pdf.subHeading('Basis of Advice', 20);
  pdf.multiLineDataRow('Information Considered', formData.basisInfo);
  pdf.multiLineDataRow('Recommendations Made', formData.basisRec);
  pdf.multiLineDataRow('Client Decision', formData.basisDecision);
  pdf.gap();

  // 4. NEEDS ANALYSIS
  pdf.sectionHeading('4.  NEEDS ANALYSIS', 22);
  sh = false;
  pdf.dataRow('Perils to be Insured', (formData.perilsSelected || []).join(', ') || (formData.perilsSelected?.includes('Other') ? formData.perilsOther : ''), sh = !sh);
  pdf.dataRow('Value to be Insured', formData.valueToBeInsured, sh = !sh);
  pdf.twoColRow({ label: 'Compulsory Excess', value: yn(formData.compulsoryExcess) }, { label: 'Voluntary Excess', value: formData.voluntaryExcess }, sh = !sh);
  pdf.dataRow('No Claims Bonus', yn(formData.noClaimsBonus), sh = !sh);
  if (formData.riskProfileNotes) pdf.multiLineDataRow('Risks / Items to be Included or Excluded', formData.riskProfileNotes);
  pdf.gap();

  // 5. RISK CATEGORIES
  // heading(11) + column-header row(8) + first risk row(~9) = ~28mm minimum
  pdf.sectionHeading('5.  RISK CATEGORIES', 22);
  pdf._needSpace(8);
  const d = pdf.doc;
  d.setFillColor(...C.blue); d.rect(ML, pdf.cy, CW, 7, 'F');
  d.setFont('helvetica', 'bold'); d.setFontSize(7); d.setTextColor(...C.white);
  d.text('RISK CATEGORY', ML + 3, pdf.cy + 5);
  d.text('COVER', ML + CW - 42, pdf.cy + 5);
  d.text('SASRIA', ML + CW - 14, pdf.cy + 5);
  pdf.cy += 8;
  sh = false;
  RISK_CATEGORIES.forEach((cat, i) => {
    const s = formData.riskState?.[i];
    pdf.riskRow(cat.name, cat.note, s?.cover, s?.cover === 'yes' && s?.sasria, sh = !sh, !!s?.flagged);
  });
  if (formData.additionalComments) {
    pdf.gap(2);
    pdf.multiLineDataRow('Additional Comments', formData.additionalComments);
  }
  pdf.gap();

  // 6. BANKING & DEBIT ORDER
  // heading(11) + first dataRow(7) = 18mm; use 22 for comfortable buffer
  pdf.sectionHeading('6.  BANKING & DEBIT ORDER', 22);
  sh = false;
  pdf.dataRow('Bank Name', formData.bankName, sh = !sh);
  pdf.twoColRow({ label: 'Account Holder', value: formData.bankHolder }, { label: 'Account Type', value: formData.accountType }, sh = !sh);
  pdf.twoColRow({ label: 'Branch Name', value: formData.branchName }, { label: 'Branch Code', value: formData.branchCode }, sh = !sh);
  pdf.dataRow('Account Number', formData.accountNumber, sh = !sh);
  pdf.twoColRow({ label: 'Deduction Date', value: formData.deductionDate }, { label: 'Deduction Amount', value: formData.deductionAmount ? `R ${formData.deductionAmount}` : '-' }, sh = !sh);
  pdf.twoColRow({ label: 'Inception Date', value: formData.inceptionDate }, { label: 'Insurer (Debit Order)', value: formData.doInsurer }, sh = !sh);
  if (formData.apptHolder || formData.apptInsurer || formData.apptPolicyNo) {
    pdf.gap(2);
    pdf.subHeading('Broker Appointment');
    sh = false;
    pdf.twoColRow({ label: 'Policy Holder', value: formData.apptHolder }, { label: 'Insurance Company', value: formData.apptInsurer }, sh = !sh);
    pdf.dataRow('Policy Number', formData.apptPolicyNo, sh = !sh);
  }
  pdf.gap();

  // 7. COMPLIANCE ACKNOWLEDGEMENTS
  // heading(11) + column-header row(8) + first principle row(~10) = ~29mm minimum
  pdf.sectionHeading('7.  COMPLIANCE ACKNOWLEDGEMENTS', 22);
  pdf._needSpace(8);
  d.setFillColor(...C.blue); d.rect(ML, pdf.cy, CW, 7, 'F');
  d.setFont('helvetica', 'bold'); d.setFontSize(7); d.setTextColor(...C.white);
  d.text('NO', ML + 3, pdf.cy + 5);
  d.text('SHORT-TERM INSURANCE PRINCIPLES', ML + 12, pdf.cy + 5);
  pdf.cy += 8;
  PRINCIPLES.forEach((text, i) => {
    pdf.principleRow(i + 1, text, formData.ackPrinciples, i % 2 === 1);
  });
  pdf.ackRow('I confirm that I understand the above short-term insurance principles.', formData.ackPrinciples, false);
  pdf.gap(3);

  pdf.disclosureBlock(
    "Advice & Intermediary Services Agreement – Advisor's Obligations",
    "Holistic Risk Services (Pty) Ltd & the Adviser undertake to: provide all statutory disclosure information and advice records; determine the Short-term Insurance goals and objectives of the Client; explain product features, restrictions, exclusions, terms and conditions; render ongoing intermediary service, including assistance with claims; renegotiate adequate cover and ensure competitive premiums during renewal; keep accurate records of discussions with the Client; treat the Client's information with the utmost confidentiality; notify the client in writing should they wish to terminate this agreement.",
    "I acknowledge the advisor's obligations as set out above.",
    formData.ackAdvisor
  );

  pdf.disclosureBlock(
    "Client Obligations",
    "The Client agrees to: offer full cooperation and acknowledge ultimate responsibility for informed decisions; disclose all information that is factually true, accurate and material; instruct the Intermediary in writing when wishing to effect any changes or additions; study the policy schedule, wording and accompanying documentation upon receipt; notify Holistic Risk Services of any change of contact details or banking details in writing; ensure that premiums and applicable fees are paid timeously; respond timeously to requests for cooperation when the annual review is due.",
    "I confirm and accept my obligations as the client.",
    formData.ackClient
  );

  pdf.disclosureBlock(
    "POPIA Requirements",
    "In order to provide you with insurance, we have to process your personal information. We will share your personal information with other insurers, industry bodies, credit agencies and service providers. This includes information about your insurance, claims and premium payments. We do this to provide insurance services, prevent fraud, assess claims and conduct surveys. We will treat your personal information with caution and have put reasonable security measures in place to protect it.",
    "I consent to the processing and sharing of my personal information as described above.",
    formData.ackPopia
  );

  pdf.disclosureBlock(
    "Termination of Agreement",
    "Any party may terminate this agreement with 30 days' written notice. Holistic Risk Services (Pty) Ltd and the Adviser are from such date no longer responsible to provide the Client with any services or annual reports/statements.",
    "I understand the termination terms of this agreement.",
    formData.ackTermination
  );

  if (feeSummary.consentRequired) {
    pdf.disclosureBlock(
      "Broker (Intermediary) Fee Consent",
      [FEE_CONTENT.important, FEE_CONTENT.general, FEE_CONTENT.feesIntro, ...FEE_CONTENT.additionalServices.map(s => `• ${s}`), FEE_CONTENT.amount, FEE_CONTENT.consentIntro].join('  '),
      `${FEE_CONTENT.ackLabel} Fee applicable: ${feeSummary.displayValue}.`,
      formData.ackBrokerFee
    );
  } else {
    pdf.disclosureBlock(
      "Broker (Intermediary) Fee Consent",
      `${FEE_CONTENT.important}  No broker fee has been quoted for this placement (recommended premium / broker fee value is zero or blank).`,
      `${FEE_CONTENT.noFeeApplicableLabel} No consent is required and none is implied by this record.`,
      true
    );
  }

  pdf.disclosureBlock(
    "Broker Appointment Confirmation (Client Mandate)",
    [APPOINTMENT.intro, ...APPOINTMENT.sections.map(s => `${s.heading}: ${s.text}`), APPOINTMENT.closing].filter(Boolean).join('  '),
    APPOINTMENT.ackLabel,
    formData.ackBrokerAppointment
  );

  pdf.disclosureBlock(
    "Broker Authorisation to Act",
    "I/We hereby authorise Holistic Risk Services (Pty) Ltd to act as my/our intermediary and to render financial services on my/our behalf, including but not limited to: obtaining quotations, submitting applications, managing claims, and liaising with insurers on my/our behalf. This authorisation is given freely and voluntarily and shall remain in force until revoked in writing.",
    "I authorise Holistic Risk Services (Pty) Ltd to act as my intermediary and access my insurance portfolio information.",
    formData.ackBrokerAuth
  );

  // Statutory Disclosure — approved Phase 3 evidence model: the complete disclosure is not
  // repeated in full here (it is shown in-app and available as a separate controlled
  // download); this concise evidence block records the version and acknowledgement status,
  // and confirms the acknowledgement is covered by the general signed ROA declaration below.
  pdf.subHeading(`Statutory Disclosure (Section 13) — Version ${disclosureEvidence.version}`, 20);
  d.setFont('helvetica', 'normal'); d.setFontSize(7); d.setTextColor(...C.black);
  [
    HRS_COMPLIANCE_CONTENT.statutoryDisclosure.pdfEvidenceIntro,
    `Reviewed and acknowledged by client: ${disclosureEvidence.acknowledged ? 'Yes' : 'No'}.`,
    `A complete copy of the disclosure (source: ${HRS_COMPLIANCE_CONTENT.statutoryDisclosure.sourceDocumentName}) was made available separately to the client.`,
  ].forEach((line) => {
    d.splitTextToSize(line, CW - 6).forEach((wrapped) => {
      pdf._needSpace(5);
      d.text(wrapped, ML + 3, pdf.cy + 4);
      pdf.cy += 4.5;
    });
  });
  pdf.gap(3);
  pdf.ackRow(disclosureEvidence.evidenceLine, disclosureEvidence.acknowledged, false);
  pdf.gap(2);

  if (formData.changingBroker === 'yes') {
    pdf.disclosureBlock(
      "Letter of Investigation",
      INVESTIGATION_CONTENT.paragraphs.join('  '),
      INVESTIGATION_CONTENT.ackLabel,
      formData.ackLetterOfInvestigation
    );
  }
  pdf.gap();

  // 8. CLIENT DECLARATION
  pdf.sectionHeading('8.  CLIENT DECLARATION', 25);
  sh = false;
  pdf.dataRow('Elects to conclude transaction differing from recommendation', formData.electionDiffers ? 'Yes' : 'No', sh = !sh);
  pdf.dataRow('Elects not to follow the advice furnished', formData.electionNotFollow ? 'Yes' : 'No', sh = !sh);
  pdf.dataRow('Elects to receive more limited information/advice', formData.electionLimitedInfo ? 'Yes' : 'No', sh = !sh);
  const electedAlt = formData.electionDiffers || formData.electionNotFollow || formData.electionLimitedInfo;
  if (electedAlt) {
    pdf.multiLineDataRow('Risk Warning Acknowledged', ELECTION_WARNING_CONTENT.join(' '));
    pdf.dataRow('Client Initials', formData.electionInitials, sh = !sh);
  }
  pdf.gap(2);
  pdf.disclosureBlock(
    formData.declarationChoice === 'decline' ? DECLARATION_CONTENT.declineTitle : DECLARATION_CONTENT.acceptTitle,
    formData.declarationChoice === 'decline' ? DECLARATION_CONTENT.decline : DECLARATION_CONTENT.accept,
    formData.declarationChoice === 'decline' ? DECLARATION_CONTENT.pdfDeclineEvidence : DECLARATION_CONTENT.pdfAcceptEvidence,
    true
  );
  pdf.gap();

  // 9. SIGNATURES — heading(11) + legal text start(~20mm) = 31mm minimum
  pdf.sectionHeading('9.  SIGNATURES', 25);
  pdf.gap(3);
  d.setFont('helvetica', 'italic'); d.setFontSize(7); d.setTextColor(...C.grey);
  const legal = 'By signing below, the client confirms that all information provided is true and accurate, and that they have read and accepted all terms and disclosures contained in this Record of Advice, including the Client Declaration above. Holistic Risk Services (Pty) Ltd - Authorised FSP No. 28582.';
  d.splitTextToSize(legal, CW).forEach(line => {
    pdf._needSpace(5);
    d.text(line, ML, pdf.cy);
    pdf.cy += 4.5;
  });
  pdf.gap(4);
  pdf.dataRow('Signature Date', formData.sigDate);
  pdf.gap(6);
  pdf._needSpace(42);
  const hw = (CW - 8) / 2;
  pdf.sigBox('Client Signature', clientSig, ML, pdf.cy, hw, 38);
  pdf.sigBox('Advisor / Broker Signature', advisorSig, ML + hw + 8, pdf.cy, hw, 38);
  pdf.cy += 42;
  d.setFont('helvetica', 'bold'); d.setFontSize(7.5); d.setTextColor(...C.blue);
  d.text(fullName, ML + hw / 2, pdf.cy, { align: 'center' });
  d.text(formData.brokerName || 'Advisor', ML + hw + 8 + hw / 2, pdf.cy, { align: 'center' });
  pdf.cy += 5;
  d.setFont('helvetica', 'normal'); d.setFontSize(6.5); d.setTextColor(...C.grey);
  d.text('Client', ML + hw / 2, pdf.cy, { align: 'center' });
  d.text('Broker / Financial Advisor', ML + hw + 8 + hw / 2, pdf.cy, { align: 'center' });
}

function buildChecklist(pdf, formData, checklistState) {
  pdf._newPage();
  const d = pdf.doc;
  const { smartsure, directInsurer, complianceDocs, additionalDocs, comments, trackDates, businessType, acctExec, commissions } = checklistState || {};
  const fullName = [formData.title, formData.firstName, formData.surname].filter(Boolean).join(' ') || '-';

  d.setFillColor(...C.orange); d.rect(ML, pdf.cy, CW, 8.5, 'F');
  d.setFillColor(...C.blue); d.rect(ML, pdf.cy, 3.5, 8.5, 'F');
  d.setFont('helvetica', 'bold'); d.setFontSize(8.5); d.setTextColor(...C.white);
  d.text('HRS - NEW BUSINESS CHECKLIST', ML + 8, pdf.cy + 6);
  pdf.cy += 12;

  let sh = false;
  pdf.twoColRow({ label: 'Insured', value: fullName }, { label: 'Insurer', value: formData.recInsurer }, sh = !sh);
  pdf.twoColRow({ label: 'ID Number', value: formData.idNumber }, { label: 'Inception Date', value: formData.inceptionDate }, sh = !sh);
  pdf.twoColRow({ label: 'Business Type', value: businessType }, { label: 'Accounts Executive', value: acctExec }, sh = !sh);
  pdf.twoColRow(
    { label: 'Smartsure Facility', value: smartsure === 'yes' ? 'Yes' : smartsure === 'no' ? 'No' : '-' },
    { label: 'Direct Insurer', value: directInsurer === 'yes' ? 'Yes' : directInsurer === 'no' ? 'No' : '-' },
    sh = !sh
  );
  pdf.gap(3);

  pdf.subHeading('Premium Summary & Commission');
  sh = false;
  const netPrem = parseFloat(formData.prem2) || 0;
  const feeVal = parseFloat(formData.brokerFeePercent) || 0;
  const feeAmount = formData.brokerFeeType === 'fixed' ? feeVal : (netPrem * feeVal / 100);
  const totalPrem = netPrem + feeAmount;
  pdf.dataRow('NET Premium', netPrem ? `R ${netPrem.toFixed(2)}` : '-', sh = !sh);
  pdf.dataRow('HRS Fee', feeAmount ? `R ${feeAmount.toFixed(2)}` : '-', sh = !sh);
  pdf.dataRow('Total Premium', totalPrem ? `R ${totalPrem.toFixed(2)}` : '-', sh = !sh);
  if (commissions) {
    Object.entries(commissions).forEach(([label, val]) => {
      if (val) pdf.dataRow(`Commission – ${label}`, `${val}%`, sh = !sh);
    });
  }
  pdf.gap(3);

  pdf.subHeading('Compliance Documentation');
  sh = false;
  ['PROPOSAL','BROKER APPOINTMENT','DEBIT ORDER AUTHORITY','ROA | RECORD OF ADVICE',
   'CURRENT POLICY SCHEDULE','PROOF OF PREVIOUS INSURANCE','SEC 13 CERTIFICATE AND DISCLOSURE',
   'CLIENT CONSENT TO CHARGE BROKER FEE']
    .forEach(item => pdf.ackRow(item, !!complianceDocs?.[item], sh = !sh));
  pdf.gap(3);

  pdf.subHeading('Additional Confirmation');
  sh = false;
  ["CELLPHONES | MAKE | MODEL | IMEI NO'S","ELECTRONICS | MAKE | MODEL | SERIAL NO'S",
   'VEHICLE REGISTRATION CERTIFICATES','VEHICLE REGISTRATION - ENGINE AND VIN NOS',
   'PROOF OF TRACKING DEVICE INSTALLATIONS','PROOF OF PURCHASES ON HIGH VALUE ITEMS',
   'VALUATION CERTIFICATES ON HIGH VALUE JEWELLERY']
    .forEach(item => pdf.ackRow(item, !!additionalDocs?.[item], sh = !sh));
  pdf.gap(3);

  pdf.subHeading('Tracking and Admin');
  sh = false;
  [
    { label: 'Full documentation handed in to upload', key: 'docs' },
    { label: 'Documentation submitted to insurer / UMA', key: 'submitted' },
    { label: 'Email to commissions@hrsinsurance.co.za', key: 'email' },
  ].forEach(({ label, key }) => pdf.dataRow(label, trackDates?.[key] || '-', sh = !sh));

  if (comments) {
    pdf.gap(3);
    pdf.subHeading('Comments');
    pdf.multiLineDataRow('', comments);
  }
}

export async function generatePDF(formData) {
  const [logo, clientSig, advisorSig] = await Promise.all([
    loadImgAsDataURL(logoUrl),
    loadImgAsDataURL(formData.clientSig),
    loadImgAsDataURL(formData.advisorSig),
  ]);
  const pdf = new PDFBuilder(logo, getPdfMetadata(formData));
  buildROA(pdf, formData, clientSig, advisorSig);
  pdf._finalizeFooters();
  const name = [formData.firstName, formData.surname].filter(Boolean).join('_').replace(/[^a-zA-Z0-9_]/g, '') || 'Client';
  pdf.save(`HRS_ROA_${name}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

export async function generateROABase64(formData) {
  const [logo, clientSig, advisorSig] = await Promise.all([
    loadImgAsDataURL(logoUrl),
    loadImgAsDataURL(formData.clientSig),
    loadImgAsDataURL(formData.advisorSig),
  ]);
  const pdf = new PDFBuilder(logo, getPdfMetadata(formData));
  buildROA(pdf, formData, clientSig, advisorSig);
  pdf._finalizeFooters();
  const name = [formData.firstName, formData.surname].filter(Boolean).join('_').replace(/[^a-zA-Z0-9_]/g, '') || 'Client';
  const filename = `HRS_ROA_${name}_${new Date().toISOString().slice(0, 10)}.pdf`;
  const base64 = pdf.doc.output('datauristring').split(',')[1];
  return { base64, filename };
}

export async function generateCombinedPDF(formData, checklistState) {
  const [logo, clientSig, advisorSig] = await Promise.all([
    loadImgAsDataURL(logoUrl),
    loadImgAsDataURL(formData.clientSig),
    loadImgAsDataURL(formData.advisorSig),
  ]);
  const pdf = new PDFBuilder(logo, getPdfMetadata(formData));
  buildROA(pdf, formData, clientSig, advisorSig);
  buildChecklist(pdf, formData, checklistState);
  pdf._finalizeFooters();
  const name = [formData.firstName, formData.surname].filter(Boolean).join('_').replace(/[^a-zA-Z0-9_]/g, '') || 'Client';
  pdf.save(`HRS_ROA_Checklist_${name}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
