import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { getInitialFormData } from '../src/lib/hrsConstants.js';
import { getCommercialInitialFormData } from '../src/lib/hrsCommercialConstants.js';
import { createSubmissionSnapshot } from '../src/lib/roaSubmissionSnapshot.js';

const read = (relativePath) => readFileSync(path.join(process.cwd(), relativePath), 'utf8');
const REMOVED = ['valueToBeInsured', 'compulsoryExcess', 'voluntaryExcess', 'noClaimsBonus'];

describe('Pass 1.1 form and PDF remediation', () => {
  it.each([
    ['Personal', getInitialFormData()],
    ['Commercial', getCommercialInitialFormData()],
  ])('%s initial state keeps risk notes and removes blanket needs-analysis fields', (_name, initial) => {
    REMOVED.forEach((field) => expect(initial).not.toHaveProperty(field));
    expect(initial).toHaveProperty('riskProfileNotes', '');
  });

  it('strips removed fields from a submission snapshot while preserving riskProfileNotes', () => {
    const snapshot = createSubmissionSnapshot('Personal', {
      ...Object.fromEntries(REMOVED.map((field) => [field, 'legacy'])),
      riskProfileNotes: 'Detailed cover note',
    }, { submissionId: 'ROA-00000000-0000-4000-8000-000000000001' });
    REMOVED.forEach((field) => expect(snapshot.snapshot).not.toHaveProperty(field));
    expect(snapshot.snapshot.riskProfileNotes).toBe('Detailed cover note');
  });

  it.each([
    ['Personal', 'src/components/hrs/steps/StepRiskCategories.jsx', 'src/lib/hrsPdfGenerator.js'],
    ['Commercial', 'src/components/hrs/commercial/steps/CommercialStepRiskCategories.jsx', 'src/lib/hrsCommercialPdfGenerator.js'],
  ])('%s UI and PDF re-home notes without a standalone Needs Analysis block', (_name, uiPath, pdfPath) => {
    const ui = read(uiPath);
    const pdf = read(pdfPath);
    expect(ui).not.toContain('<SectionTitle>Needs Analysis</SectionTitle>');
    expect(ui).toContain('Additional Risk / Cover Notes');
    expect(pdf).not.toContain('NEEDS ANALYSIS');
    expect(pdf).toContain('Additional Risk / Cover Notes');
    REMOVED.forEach((field) => expect(pdf).not.toContain(`formData.${field}`));
  });

  it('orders the home cards Personal, Commercial, My ROAs', () => {
    const source = read('src/pages/SelectROA.jsx');
    expect(source.indexOf('Personal Lines')).toBeLessThan(source.indexOf('Commercial Lines'));
    expect(source.indexOf('Commercial Lines')).toBeLessThan(source.indexOf('My ROAs'));
  });

  it.each([
    ['Personal', 'src/components/hrs/steps/StepChecklist.jsx'],
    ['Commercial', 'src/components/hrs/commercial/steps/CommercialStepChecklist.jsx'],
  ])('%s submitted screen exposes Home, My ROAs, and New Advice Record', (_name, file) => {
    const source = read(file);
    expect(source).toContain('Back to Home');
    expect(source).toContain('View My ROAs');
    expect(source).toContain('New Advice Record');
  });
});
