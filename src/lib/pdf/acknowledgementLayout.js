// Shared PDF acknowledgement layout for Personal and Commercial ROAs (mm).
// Width 48mm from the content start is reserved for the status label; keep 4mm right margin.
export function layoutAcknowledgement(doc, value, contentWidth) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  const availableWidth = contentWidth - 52;
  if (!(availableWidth > 0)) throw new Error('Acknowledgement text width must be positive');
  const lines = doc.splitTextToSize(String(value ?? ''), availableWidth);
  return { lines, availableWidth, rowHeight: Math.max(7, lines.length * 4.5 + 2.5) };
}
