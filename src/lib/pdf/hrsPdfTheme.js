import { HRS_INFO } from '../hrsOrganisation';

export const HRS_PDF_THEME = Object.freeze({
  page: { width: 210, height: 297, unit: 'mm', format: 'a4' },
  margin: { left: 15, right: 15, top: 15, bottom: 18 },
  contentWidth: 180,
  colors: {
    accent: [37, 64, 143],
    accentDark: [29, 49, 111],
    warmAccent: [220, 75, 30],
    text: [20, 20, 30],
    muted: [100, 106, 124],
    light: [246, 248, 252],
    border: [216, 220, 231],
    white: [255, 255, 255],
    success: [30, 140, 80],
    danger: [190, 40, 40],
    warning: [200, 155, 60],
  },
  type: {
    title: 20,
    productLine: 10,
    section: 11,
    subsection: 9.5,
    body: 9,
    legal: 8.5,
    footer: 7.5,
  },
  spacing: { xs: 2, sm: 4, md: 7, lg: 11, xl: 16 },
  footerHeight: 13,
  headerHeight: 42,
});

function formatDate(value) {
  if (!value) return new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' });
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' });
}

function textOrDash(value) {
  return value === null || value === undefined || value === '' ? '-' : String(value);
}

export function drawDocumentHeader(doc, {
  logo = null,
  productLine = 'Short-term Insurance',
  clientName = '-',
  advisorName = '-',
  policyType = '-',
  documentDate = null,
  disclosureVersion = '-',
  firstPage = false,
} = {}) {
  const T = HRS_PDF_THEME;
  const { width: pageW } = T.page;
  const { left: ml, right: mr } = T.margin;
  const C = T.colors;

  doc.setFillColor(...(firstPage ? C.accent : C.light));
  doc.rect(0, 0, pageW, firstPage ? T.headerHeight : 12, 'F');
  if (firstPage) {
    doc.setFillColor(...C.warmAccent);
    doc.rect(0, T.headerHeight, pageW, 1.5, 'F');
    doc.setFillColor(...C.white);
    doc.roundedRect(ml, 4, 48, 28, 1.5, 1.5, 'F');
    if (logo?.startsWith('data:')) {
      try { doc.addImage(logo, 'PNG', ml + 2, 6, 44, 22, undefined, 'MEDIUM'); }
      catch { drawTextLogo(doc, ml + 24, 19, C.accent); }
    } else drawTextLogo(doc, ml + 24, 19, C.accent);

    doc.setFont('helvetica', 'bold'); doc.setFontSize(T.type.title); doc.setTextColor(...C.white);
    doc.text('Record of Advice', pageW - mr, 13, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(T.type.productLine); doc.setTextColor(220, 225, 240);
    doc.text(productLine, pageW - mr, 21, { align: 'right' });
    doc.setFontSize(8); doc.setTextColor(190, 198, 220);
    doc.text(`${HRS_INFO.legalName}  |  FSP ${HRS_INFO.fspNumber}`, pageW - mr, 27, { align: 'right' });
    doc.setFontSize(7.2); doc.setTextColor(180, 188, 210);
    doc.text(`Statutory Disclosure ${textOrDash(disclosureVersion)}  |  ${formatDate(documentDate)}`, pageW - mr, 34, { align: 'right' });

    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...C.accentDark);
    doc.text(textOrDash(clientName), ml + 55, 51);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...C.muted);
    doc.text(`Advisor: ${textOrDash(advisorName)}   |   Policy type: ${textOrDash(policyType)}`, ml + 55, 56);
  } else {
    doc.setFillColor(...C.accent);
    doc.rect(0, 11, pageW, 0.8, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...C.accentDark);
    doc.text('HRS  |  Record of Advice', ml, 8);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.muted);
    doc.text(productLine, pageW - mr, 8, { align: 'right' });
  }
}

function drawTextLogo(doc, x, y, color) {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...color);
  doc.text('HRS', x, y, { align: 'center' });
}

export function drawPageFooter(doc, { pageNumber = 1, totalPages = null, documentType = 'Record of Advice' } = {}) {
  const T = HRS_PDF_THEME;
  const { width: pageW, height: pageH } = T.page;
  const { left: ml, right: mr } = T.margin;
  const C = T.colors;
  const fy = pageH - T.footerHeight;
  doc.setFillColor(...C.light); doc.rect(0, fy, pageW, T.footerHeight, 'F');
  doc.setDrawColor(...C.border); doc.setLineWidth(0.3); doc.line(ml, fy + 0.8, pageW - mr, fy + 0.8);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(T.type.footer); doc.setTextColor(...C.muted);
  doc.text(`${HRS_INFO.legalName}  |  FSP ${HRS_INFO.fspNumber}  |  ${HRS_INFO.phone}`, ml, fy + 5);
  doc.text(`${documentType}  |  Confidential`, ml, fy + 9.5);
  doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.accent);
  doc.text(`Page ${pageNumber}${totalPages ? ` of ${totalPages}` : ''}`, pageW - mr, fy + 7, { align: 'right' });
}

export function ensurePageSpace(builder, requiredHeight) {
  if (builder.cy + requiredHeight > HRS_PDF_THEME.page.height - HRS_PDF_THEME.footerHeight - 2) builder._newPage();
}

export function drawSectionHeader(builder, title, number, keepWithHeight = 14) {
  ensurePageSpace(builder, 12 + keepWithHeight);
  const T = HRS_PDF_THEME;
  const C = T.colors;
  const d = builder.doc;
  d.setFillColor(...C.accent); d.rect(builder.ml, builder.cy, builder.cw, 9, 'F');
  d.setFillColor(...C.warmAccent); d.rect(builder.ml, builder.cy, 3.5, 9, 'F');
  d.setFont('helvetica', 'bold'); d.setFontSize(T.type.section); d.setTextColor(...C.white);
  d.text(`${String(number).padStart(2, '0')}  ${title}`, builder.ml + 8, builder.cy + 6.3);
  builder.cy += 12;
}

export function drawClientSummary(builder, items) {
  const T = HRS_PDF_THEME;
  const C = T.colors;
  const d = builder.doc;
  const gap = 5;
  const colW = (builder.cw - gap) / 2;
  const rows = [];
  for (let i = 0; i < items.length; i += 2) rows.push([items[i], items[i + 1]]);
  const heights = rows.map(([left, right]) => {
    const leftLines = d.splitTextToSize(textOrDash(left?.value), colW - 36);
    const rightLines = right ? d.splitTextToSize(textOrDash(right.value), colW - 36) : [];
    return Math.max(8, Math.max(leftLines.length, rightLines.length) * 4.2 + 3);
  });
  ensurePageSpace(builder, heights.reduce((sum, h) => sum + h, 0) + 16);
  d.setFont('helvetica', 'bold'); d.setFontSize(T.type.subsection); d.setTextColor(...C.accentDark);
  d.text('CLIENT SUMMARY', builder.ml, builder.cy + 5);
  builder.cy += 9;
  rows.forEach(([left, right], index) => {
    const rh = heights[index];
    if (index % 2 === 0) { d.setFillColor(...C.light); d.rect(builder.ml, builder.cy, builder.cw, rh, 'F'); }
    [left, right].filter(Boolean).forEach((item, col) => {
      const x = builder.ml + col * (colW + gap);
      d.setFont('helvetica', 'normal'); d.setFontSize(7.3); d.setTextColor(...C.muted); d.text(item.label, x + 3, builder.cy + 4.7);
      d.setFont('helvetica', 'bold'); d.setFontSize(7.8); d.setTextColor(...C.text);
      d.splitTextToSize(textOrDash(item.value), colW - 38).forEach((line, lineIndex) => d.text(line, x + 38, builder.cy + 4.7 + lineIndex * 4.2));
    });
    d.setDrawColor(...C.border); d.setLineWidth(0.2); d.line(builder.ml, builder.cy + rh, builder.ml + builder.cw, builder.cy + rh);
    builder.cy += rh;
  });
  builder.cy += 4;
}

export function drawSignatureBlock(builder, { label, image, name, date, capacity }) {
  const T = HRS_PDF_THEME;
  const C = T.colors;
  const d = builder.doc;
  const h = 38;
  ensurePageSpace(builder, h + 15);
  d.setDrawColor(...C.border); d.setLineWidth(0.35); d.roundedRect(builder.signatureX, builder.cy, builder.signatureWidth, h, 1.5, 1.5, 'S');
  d.setFont('helvetica', 'bold'); d.setFontSize(8.5); d.setTextColor(...C.accentDark); d.text(label, builder.signatureX + 4, builder.cy + 6);
  if (image) {
    try {
      const props = d.getImageProperties(image);
      const scale = Math.min((builder.signatureWidth - 8) / props.width, 22 / props.height);
      const w = props.width * scale; const ih = props.height * scale;
      d.addImage(image, 'PNG', builder.signatureX + (builder.signatureWidth - w) / 2, builder.cy + 9, w, ih, undefined, 'MEDIUM');
    } catch { d.setFont('helvetica', 'italic'); d.setFontSize(7.5); d.setTextColor(...C.muted); d.text('Signature image unavailable', builder.signatureX + 4, builder.cy + 20); }
  } else {
    d.setFont('helvetica', 'italic'); d.setFontSize(7.5); d.setTextColor(...C.muted); d.text('Signature pending', builder.signatureX + 4, builder.cy + 21);
  }
  d.setDrawColor(...C.border); d.line(builder.signatureX + 4, builder.cy + 28, builder.signatureX + builder.signatureWidth - 4, builder.cy + 28);
  d.setFont('helvetica', 'bold'); d.setFontSize(7.5); d.setTextColor(...C.text); d.text(textOrDash(name), builder.signatureX + 4, builder.cy + 33);
  d.setFont('helvetica', 'normal'); d.setFontSize(6.8); d.setTextColor(...C.muted); d.text(`${textOrDash(date)}${capacity ? `  |  ${capacity}` : ''}`, builder.signatureX + 4, builder.cy + 36.5);
  builder.cy += h;
}

export { formatDate, textOrDash };
