import { jsPDF } from 'jspdf';
import { COMMERCIAL_RISK_CATEGORIES, COMMERCIAL_PRINCIPLES } from './hrsCommercialConstants';
import logoUrl from '../assets/hrs-logo.png';

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
  blue:    [37, 64, 143],
  orange:  [220, 75, 30],
  green:   [30, 140, 80],
  red:     [190, 40, 40],
  white:   [255, 255, 255],
  black:   [20, 20, 30],
  grey:    [110, 115, 135],
  lightBg: [246, 248, 252],
  border:  [210, 215, 230],
  gold:    [200, 155, 60],
  goldTxt: [70, 50, 5],
};

const PAGE_W = 210, PAGE_H = 297;
const ML = 15, MR = 15;
const CW = PAGE_W - ML - MR;
const LW = 65;

class CommercialPDFBuilder {
  constructor(logoDataURL) {
    this.doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    this.logo = logoDataURL;
    this.pageNum = 1;
    this.cy = 0;
    this._drawHeader();
    this._drawFooter();
    this.cy = 44;
  }

  _needSpace(h) {
    if (this.cy + h > PAGE_H - 18) this._newPage();
  }

  _newPage() {
    this.doc.addPage();
    this.pageNum++;
    this._drawHeader();
    this._drawFooter();
    this.cy = 44;
  }

  _drawHeader() {
    const d = this.doc;
    d.setFillColor(...C.blue);
    d.rect(0, 0, PAGE_W, 34, 'F');
    d.setFillColor(...C.orange);
    d.rect(0, 34, PAGE_W, 2.5, 'F');

    d.setFillColor(...C.white);
    d.roundedRect(ML, 3, 54, 28, 2, 2, 'F');

    let logoValid = false;
    if (this.logo && this.logo.startsWith('data:')) {
      const parts = this.logo.split(',');
      if (parts.length > 1 && parts[1].length > 64) logoValid = true;
    }
    if (logoValid) {
      try {
        d.addImage(this.logo, 'PNG', ML + 2, 4, 50, 22, undefined, 'MEDIUM');
      } catch {
        this._drawTextLogo(d);
      }
    } else {
      this._drawTextLogo(d);
    }

    d.setFont('helvetica', 'bold');
    d.setFontSize(13.5);
    d.setTextColor(...C.white);
    d.text('RECORD OF ADVICE', PAGE_W - MR, 13, { align: 'right' });

    d.setFont('helvetica', 'normal');
    d.setFontSize(7.2);
    d.setTextColor(200, 205, 230);
    d.text('New Commercial Insurance  |  Holistic Risk Services (Pty) Ltd  |  FSP 28582', PAGE_W - MR, 20, { align: 'right' });

    d.setFontSize(6.8);
    d.setTextColor(165, 170, 205);
    const dt = new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' });
    d.text(`Generated: ${dt}`, PAGE_W - MR, 27, { align: 'right' });
  }

  _drawTextLogo(d) {
    d.setFont('helvetica', 'bold');
    d.setFontSize(10);
    d.setTextColor(...C.blue);
    d.text('HRS', ML + 25, 18, { align: 'center' });
  }

  _drawFooter() {
    const d = this.doc;
    const fy = PAGE_H - 13;
    d.setFillColor(...C.lightBg);
    d.rect(0, fy, PAGE_W, 13, 'F');
    d.setDrawColor(...C.border);
    d.setLineWidth(0.3);
    d.line(ML, fy + 0.8, PAGE_W - MR, fy + 0.8);
    d.setFont('helvetica', 'normal');
    d.setFontSize(6.3);
    d.setTextColor(...C.grey);
    d.text('Holistic Risk Services (Pty) Ltd  |  FSP 28582  |  16 Monte Carlo Crescent, Kyalami Business Park, Midrand 1684', ML, fy + 5);
    d.text('010 447-9800  |  info@hrsinsurance.co.za  |  www.hrsinsurance.co.za', ML, fy + 9.5);
    d.setFont('helvetica', 'bold');
    d.setFontSize(7.5);
    d.setTextColor(...C.blue);
    d.text(`Page ${this.pageNum}`, PAGE_W - MR, fy + 7, { align: 'right' });
  }

  sectionHeading(title) {
    this._needSpace(14);
    const d = this.doc;
    d.setFillColor(...C.blue); d.rect(ML, this.cy, CW, 8.5, 'F');
    d.setFillColor(...C.orange); d.rect(ML, this.cy, 3.5, 8.5, 'F');
    d.setFont('helvetica', 'bold'); d.setFontSize(8.5); d.setTextColor(...C.white);
    d.text(title, ML + 8, this.cy + 6);
    this.cy += 11;
  }

  subHeading(title) {
    this._needSpace(9);
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

  riskRow(name, note, cover, sasria, shade) {
    const d = this.doc;
    const rh = note ? 9.5 : 7;
    this._needSpace(rh);
    if (shade) d.setFillColor(...C.lightBg).rect(ML, this.cy, CW, rh, 'F');
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
      d.addImage(sigDataURL, 'PNG', x + 5, y + 9, w - 10, h - 18, undefined, 'MEDIUM');
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

function buildCommercialROA(pdf, formData, clientSig, advisorSig) {
  const netPrem = parseFloat(formData.prem2) || 0;
  const feeVal = parseFloat(formData.brokerFeePercent) || 0;
  const feeAmount = formData.brokerFeeType === 'fixed' ? feeVal : (netPrem * feeVal / 100);
  const feeStr = formData.brokerFeePercent
    ? (formData.brokerFeeType === 'fixed' ? `R ${feeVal.toFixed(2)}` : `R ${feeAmount.toFixed(2)} (${feeVal}%)`)
    : '-';

  let sh = false;

  // 1. CLIENT DETAILS
  pdf.sectionHeading('1.  CLIENT DETAILS');
  pdf.dataRow('Broker / Advisor', formData.brokerName, sh = !sh);
  pdf.dataRow('Company Name', formData.companyName, sh = !sh);
  pdf.twoColRow({ label: 'Registration No.', value: formData.registrationNo }, { label: 'VAT No.', value: formData.vatNo }, sh = !sh);
  pdf.dataRow('Nature of Business', formData.natureOfBusiness, sh = !sh);
  pdf.dataRow('Risk Address', formData.riskAddress, sh = !sh);
  pdf.twoColRow({ label: 'Contact Person', value: formData.contactPerson }, { label: 'ID Number', value: formData.idNo }, sh = !sh);
  pdf.twoColRow({ label: 'Email', value: formData.email }, { label: 'Contact No.', value: formData.contactNo }, sh = !sh);
  pdf.twoColRow({ label: 'Inception Date', value: formData.inceptionDate }, { label: 'FAIS Disclosure Provided', value: yn(formData.faisProvided) }, sh = !sh);
  pdf.gap();

  // 2. INSURANCE HISTORY & NEEDS
  pdf.sectionHeading('2.  INSURANCE HISTORY');
  sh = false;
  pdf.twoColRow({ label: 'Uninterrupted STI', value: yn(formData.uninterruptedInsurance) }, { label: 'Years Insured', value: formData.yearsInsured }, sh = !sh);
  pdf.dataRow('Special Terms / Cover Refused', yn(formData.specialTerms), sh = !sh);
  if (formData.specialTerms === 'yes') pdf.dataRow('Reason', formData.cancelReasonText, sh = !sh);
  pdf.multiLineDataRow("Summary of Business Owner's Specific Needs and Objectives", formData.clientNeeds);
  pdf.gap();

  // 3. PRODUCTS & ADVICE
  pdf.sectionHeading('3.  COMPARISON OF PRODUCTS CONSIDERED');
  pdf.gap(8);
  pdf.insurerCards([
    { insurer: formData.ins0, premium: formData.prem0, label: 'OPTION 1', recommended: false },
    { insurer: formData.ins1, premium: formData.prem1, label: 'OPTION 2', recommended: false },
    { insurer: formData.ins2, premium: formData.prem2, label: 'OPTION 3', recommended: true },
  ]);
  sh = false;
  pdf.dataRow('Recommended Insurer', formData.recInsurer, sh = !sh);
  pdf.multiLineDataRow('Reasons Why Suitable', formData.recReasons);
  pdf.gap(2);

  pdf.subHeading('Basis of Advice');
  pdf.multiLineDataRow('Information Considered', formData.basisInfo);
  pdf.multiLineDataRow('Recommendations Made', formData.basisRec);
  pdf.multiLineDataRow('Client Decision', formData.basisDecision);
  pdf.gap(2);

  pdf.subHeading('Commission & Fees');
  sh = false;
  pdf.dataRow('Standard Commission', '12.5% on Motor  |  20% on Non-Motor', sh = !sh);
  pdf.dataRow('Broker Fee', feeStr, sh = !sh);
  if (formData.agreedFees) pdf.dataRow('Agreed Fees', formData.agreedFees, sh = !sh);
  pdf.gap();

  // 4. REPLACEMENT POLICY
  if (formData.replacingExisting === 'yes') {
    pdf.sectionHeading('4.  REPLACEMENT OF AN EXISTING POLICY');
    sh = false;
    pdf.dataRow('Replacing Existing Policy', yn(formData.replacingExisting), sh = !sh);
    pdf.dataRow('Like for Like Basis', yn(formData.likeForLike), sh = !sh);
    if (formData.likeForLike === 'no') {
      pdf.multiLineDataRow('Main Differences', formData.mainDifferences);
      pdf.multiLineDataRow('Exclusions / Uninsured Risks', formData.exclusions);
    }
    pdf.multiLineDataRow('Main Reason for Replacement', formData.replacementReason);
    pdf.twoColRow({ label: 'Current Insurer', value: formData.currentInsurer }, { label: 'New Insurer', value: formData.newInsurer }, false);
    pdf.gap();
  }

  // 5. PRINCIPLES
  pdf.sectionHeading('5.  SHORT-TERM INSURANCE PRINCIPLES');
  pdf._needSpace(8);
  const d = pdf.doc;
  d.setFillColor(...C.blue); d.rect(ML, pdf.cy, CW, 7, 'F');
  d.setFont('helvetica', 'bold'); d.setFontSize(7); d.setTextColor(...C.white);
  d.text('NO', ML + 3, pdf.cy + 5);
  d.text('THE IMPORTANT TERMS & FEATURES OF SHORT-TERM INSURANCE TO UNDERSTAND', ML + 12, pdf.cy + 5);
  pdf.cy += 8;
  COMMERCIAL_PRINCIPLES.forEach((text, i) => {
    pdf.principleRow(i + 1, text, formData.ackPrinciples, i % 2 === 1);
  });
  pdf.gap(2);

  // POPIA
  pdf.subHeading('POPIA Requirements');
  const popiaText = 'In order to provide you with insurance, we have to process your personal information. We will share your personal information with other insurers, industry bodies, credit agencies and service providers. This includes information about your insurance, claims and premium payments. We do this to provide insurance services, prevent fraud, assess claims and conduct surveys. We will treat your personal information with caution and have put reasonable security measures in place to protect it. By signing this form, you agree to the processing and sharing of your personal information.';
  pdf.multiLineDataRow('', popiaText);
  pdf.ackRow('POPIA Consent — I agree to the processing and sharing of my personal information', formData.ackPopia, false);
  pdf.gap();

  // Signatures Page 1
  pdf.sectionHeading('6.  SIGNATURES — DECLARATION');
  pdf.gap(3);
  d.setFont('helvetica', 'italic'); d.setFontSize(7); d.setTextColor(...C.grey);
  const decl1 = 'Declaration by the Adviser: I declare that the advice record is an accurate and complete record of the recommendations and advice that I provided the client with, based upon the information provided by the client.';
  const decl2 = 'Declaration by the Client: I acknowledge that as a client, no product provider or FSP may request or induce me to waive any right or benefit. I confirm having been duly advised and fully understand the course of action I am about to undertake.';
  [decl1, decl2].forEach(text => {
    d.splitTextToSize(text, CW).forEach(line => {
      pdf._needSpace(5);
      d.text(line, ML, pdf.cy);
      pdf.cy += 4.5;
    });
    pdf.cy += 2;
  });
  pdf.gap(4);
  pdf.dataRow('Signature Date', formData.sigDate);
  pdf.gap(6);
  pdf._needSpace(42);
  const hw = (CW - 8) / 2;
  pdf.sigBox('Client / Authorised Rep.', clientSig, ML, pdf.cy, hw, 38);
  pdf.sigBox('Advisor / Broker Signature', advisorSig, ML + hw + 8, pdf.cy, hw, 38);
  pdf.cy += 42;
  d.setFont('helvetica', 'bold'); d.setFontSize(7.5); d.setTextColor(...C.blue);
  d.text(formData.companyName || 'Client', ML + hw / 2, pdf.cy, { align: 'center' });
  d.text(formData.brokerName || 'Advisor', ML + hw + 8 + hw / 2, pdf.cy, { align: 'center' });
  pdf.cy += 5;
  d.setFont('helvetica', 'normal'); d.setFontSize(6.5); d.setTextColor(...C.grey);
  d.text('Client / Authorised Representative', ML + hw / 2, pdf.cy, { align: 'center' });
  d.text('Broker / Financial Advisor', ML + hw + 8 + hw / 2, pdf.cy, { align: 'center' });

  // 7. RISK CATEGORIES (new page)
  pdf._newPage();
  pdf.sectionHeading('7.  INSURED RISKS AND / OR RISKS EXCLUDED FROM INSURANCE POLICY');
  pdf._needSpace(8);
  d.setFillColor(...C.blue); d.rect(ML, pdf.cy, CW, 7, 'F');
  d.setFont('helvetica', 'bold'); d.setFontSize(7); d.setTextColor(...C.white);
  d.text('CATEGORY OF RISK', ML + 3, pdf.cy + 5);
  d.text('COVER', ML + CW - 42, pdf.cy + 5);
  d.text('SASRIA', ML + CW - 14, pdf.cy + 5);
  pdf.cy += 8;
  sh = false;
  COMMERCIAL_RISK_CATEGORIES.forEach((cat, i) => {
    const s = formData.riskState?.[i];
    pdf.riskRow(cat.name, cat.note, s?.cover, s?.cover === 'yes' && s?.sasria, sh = !sh);
  });
  if (formData.additionalComments) {
    pdf.gap(2);
    pdf.multiLineDataRow('Additional Comments', formData.additionalComments);
  }
  pdf.gap(3);

  // Intermediary Agreement Summary
  pdf.subHeading('Advice & Intermediary Services Agreement');
  pdf.ackRow('I have read and agree to the Advice & Intermediary Services Agreement', formData.ackIntermediaryAgreement, false);
  pdf.gap(6);

  // Final signatures on risk page
  pdf._needSpace(42);
  pdf.sigBox('Client / Authorised Rep.', clientSig, ML, pdf.cy, hw, 38);
  pdf.sigBox('Advisor / Broker Signature', advisorSig, ML + hw + 8, pdf.cy, hw, 38);
  pdf.cy += 42;
  d.setFont('helvetica', 'bold'); d.setFontSize(7.5); d.setTextColor(...C.blue);
  d.text(formData.companyName || 'Client', ML + hw / 2, pdf.cy, { align: 'center' });
  d.text(formData.brokerName || 'Advisor', ML + hw + 8 + hw / 2, pdf.cy, { align: 'center' });
  pdf.cy += 5;
  d.setFont('helvetica', 'normal'); d.setFontSize(6.5); d.setTextColor(...C.grey);
  d.text('An authorised FSP No 28582', ML + CW / 2, pdf.cy + 4, { align: 'center' });
}

export async function generateCommercialPDF(formData) {
  const [logo, clientSig, advisorSig] = await Promise.all([
    loadImgAsDataURL(logoUrl),
    loadImgAsDataURL(formData.clientSig),
    loadImgAsDataURL(formData.advisorSig),
  ]);
  const pdf = new CommercialPDFBuilder(logo);
  buildCommercialROA(pdf, formData, clientSig, advisorSig);
  const name = (formData.companyName || 'Commercial').replace(/[^a-zA-Z0-9_]/g, '_');
  pdf.save(`HRS_Commercial_ROA_${name}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

export async function generateCommercialROABase64(formData) {
  const [logo, clientSig, advisorSig] = await Promise.all([
    loadImgAsDataURL(logoUrl),
    loadImgAsDataURL(formData.clientSig),
    loadImgAsDataURL(formData.advisorSig),
  ]);
  const pdf = new CommercialPDFBuilder(logo);
  buildCommercialROA(pdf, formData, clientSig, advisorSig);
  const name = (formData.companyName || 'Commercial').replace(/[^a-zA-Z0-9_]/g, '_');
  const filename = `HRS_Commercial_ROA_${name}_${new Date().toISOString().slice(0, 10)}.pdf`;
  const base64 = pdf.doc.output('datauristring').split(',')[1];
  return { base64, filename };
}