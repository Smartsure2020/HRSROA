import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RISK_CATEGORIES, getInitialFormData } from '../src/lib/hrsConstants.js';
import { COMMERCIAL_RISK_CATEGORIES, getCommercialInitialFormData } from '../src/lib/hrsCommercialConstants.js';
import { isSasriaConfirmed, SASRIA_CLASSES } from '../src/lib/sasriaApplicability.js';
import { SIGNING_MARKERS } from '../src/lib/pdf/signingMarkers.js';
import { buildSignatureSendFeedback } from '../src/lib/signatureSendFeedback.js';

const read = (relativePath) => readFileSync(path.join(process.cwd(), relativePath), 'utf8');
const PERSONAL_PDF = read('src/lib/hrsPdfGenerator.js');
const COMMERCIAL_PDF = read('src/lib/hrsCommercialPdfGenerator.js');
const PERSONAL_RISK_UI = read('src/components/hrs/steps/StepRiskCategories.jsx');
const COMMERCIAL_RISK_UI = read('src/components/hrs/commercial/steps/CommercialStepRiskCategories.jsx');

describe('post-acceptance canonical PDF contract', () => {
  it.each([
    ['Personal', PERSONAL_PDF],
    ['Commercial', COMMERCIAL_PDF],
  ])('%s canonical PDF has no local signature image path', (_name, source) => {
    expect(source).not.toContain('formData.clientSig');
    expect(source).not.toContain('formData.advisorSig');
    expect(source).not.toContain('getImageProperties(sigDataURL)');
    expect(source).not.toContain('Signature image unavailable');
  });

  it('retains all four provider-neutral signing anchors in both generators', () => {
    expect(Object.values(SIGNING_MARKERS)).toEqual([
      '[[HRS_ROA_CLIENT_SIGNATURE]]',
      '[[HRS_ROA_CLIENT_DATE]]',
      '[[HRS_ROA_ADVISOR_SIGNATURE]]',
      '[[HRS_ROA_ADVISOR_DATE]]',
    ]);
    for (const source of [PERSONAL_PDF, COMMERCIAL_PDF]) {
      expect(source).toContain('SIGNING_MARKERS.clientSignature');
      expect(source).toContain('SIGNING_MARKERS.clientDate');
      expect(source).toContain('SIGNING_MARKERS.advisorSignature');
      expect(source).toContain('SIGNING_MARKERS.advisorDate');
    }
  });

  it.each([
    ['Personal', getInitialFormData(), PERSONAL_RISK_UI, PERSONAL_PDF],
    ['Commercial', getCommercialInitialFormData(), COMMERCIAL_RISK_UI, COMMERCIAL_PDF],
  ])('%s removes duplicate Perils state, selector and PDF row', (_name, initial, ui, pdf) => {
    expect(initial).not.toHaveProperty('perilsSelected');
    expect(initial).not.toHaveProperty('perilsOther');
    expect(ui).not.toContain('Perils to be Insured');
    expect(pdf).not.toContain("dataRow('Perils to be Insured'");
  });
});

describe('SASRIA applicability mapping', () => {
  const commercialByName = Object.fromEntries(COMMERCIAL_RISK_CATEGORIES.map((item) => [item.name, item]));
  const personalByName = Object.fromEntries(RISK_CATEGORIES.map((item) => [item.name, item]));

  it('maps known commercial risk classes and excludes liability/theft categories', () => {
    expect(commercialByName.Fire.sasriaClass).toBe(SASRIA_CLASSES.MATERIAL_DAMAGE);
    expect(commercialByName['Business Interruption'].sasriaClass).toBe(SASRIA_CLASSES.BUSINESS_INTERRUPTION);
    expect(commercialByName.Money.sasriaClass).toBe(SASRIA_CLASSES.MONEY);
    expect(commercialByName['Goods in Transit'].sasriaClass).toBe(SASRIA_CLASSES.GOODS_IN_TRANSIT);
    expect(commercialByName.Motor.sasriaClass).toBe(SASRIA_CLASSES.MOTOR);
    expect(commercialByName['Motor Traders'].sasriaClass).toBe(SASRIA_CLASSES.MOTOR);
    for (const name of ['Theft', 'Public Liability', 'Products Liability', 'Employers Liability', 'Personal Liability', 'D&O Liability', 'Professional Indemnity']) {
      expect(commercialByName[name].sasriaClass).toBeNull();
    }
  });

  it('keeps Personal applicability narrow and provider-neutral', () => {
    expect(personalByName['Buildings / Houses'].sasriaClass).toBe(SASRIA_CLASSES.MATERIAL_DAMAGE);
    expect(personalByName['Vehicles (incl. Bikes, Caravans & Trailers)'].sasriaClass).toBe(SASRIA_CLASSES.MOTOR);
    expect(personalByName['Personal Liability'].sasriaClass).toBeNull();
    expect(personalByName['Contents – Full Theft'].sasriaClass).toBeNull();
  });

  it('does not render an eligible-only risk as confirmed SASRIA', () => {
    const category = commercialByName.Fire;
    expect(isSasriaConfirmed(category, { cover: 'yes' }, [])).toBe(false);
    expect(isSasriaConfirmed(category, { cover: 'yes' }, [SASRIA_CLASSES.MATERIAL_DAMAGE])).toBe(true);
    expect(isSasriaConfirmed(category, { cover: 'no' }, [SASRIA_CLASSES.MATERIAL_DAMAGE])).toBe(false);
  });
});

describe('signature send feedback', () => {
  it.each([
    [{}, 'Signature request sent'],
    [{ alreadySent: true }, 'Signature request already sent'],
    [{ recovered: true }, 'Signature request recovered'],
  ])('shows truthful success only from a successful response %#', (result, expectedTitle) => {
    expect(buildSignatureSendFeedback(result, 'client@example.com')).toEqual({
      title: expectedTitle,
      description: 'Sent to client@example.com. This ROA will update automatically as signing progresses.',
    });
  });
});
