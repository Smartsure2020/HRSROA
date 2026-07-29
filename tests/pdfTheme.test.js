import { describe, expect, it } from 'vitest';
import { HRS_PDF_THEME } from '../src/lib/pdf/hrsPdfTheme';
import { HRS_INFO } from '../src/lib/hrsOrganisation';

describe('shared HRS PDF design system', () => {
  it('uses the approved HRS identity and page controls', () => {
    expect(HRS_PDF_THEME.page.format).toBe('a4');
    expect(HRS_PDF_THEME.colors.accent).toEqual([37, 64, 143]);
    expect(HRS_PDF_THEME.colors.warmAccent).toEqual([220, 75, 30]);
    expect(HRS_PDF_THEME.footerHeight).toBeGreaterThan(10);
  });

  it('centralizes the approved phone used by the footer', () => {
    expect(HRS_INFO.phone).toBe('011 447 9800');
  });
});
