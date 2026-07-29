import { describe, expect, it } from 'vitest';
import {
  COMMERCIAL_STEPS,
  PERSONAL_STEPS,
  getActiveSteps,
  getNextButtonText,
  getNextStep,
} from '../src/lib/flowSteps';

function matrix(steps) {
  const active = getActiveSteps(steps, {});
  return active.map((current, index) => ({
    current: current.label,
    displayed: getNextButtonText(active, current.id, {}),
    destination: active[index + 1]?.label || (current.action === 'submit' ? 'Submit Advice Record' : 'Review Advice Record'),
  }));
}

describe('authoritative wizard navigation', () => {
  it.each([
    ['Personal', PERSONAL_STEPS, ['Insurance History', 'Products & Advice', 'Risk Categories', 'Principles & Disclosures', 'Banking & Debit Order', 'Signatures', 'Review', 'Review Advice Record']],
    ['Commercial', COMMERCIAL_STEPS, ['Insurance History', 'Products & Advice', 'Replacement Policy', 'Principles & Disclosures', 'Risk Categories', 'Signatures', 'Review', 'Submit Advice Record']],
  ])('%s labels match the actual destination for every step', (_name, steps, expectedDestinations) => {
    const rows = matrix(steps);
    expect(rows.map((row) => row.destination)).toEqual(expectedDestinations);
    rows.forEach((row, index) => {
      const expectedLabel = index < rows.length - 1 ? `Next: ${row.destination}` : row.destination;
      expect(row.displayed).toBe(expectedLabel);
    });
  });

  it('keeps Personal and Commercial step orders independent', () => {
    expect(PERSONAL_STEPS.map((step) => step.id)).not.toEqual(COMMERCIAL_STEPS.map((step) => step.id));
    expect(getNextStep(PERSONAL_STEPS, 'principles-disclosures')?.label).toBe('Banking & Debit Order');
    expect(getNextStep(COMMERCIAL_STEPS, 'principles-disclosures')?.label).toBe('Risk Categories');
  });

  it.each([
    ['new placement', 'New placement'],
    ['renewal', 'Renewal'],
    ['replacement', 'Replacement'],
    ['restored draft', 'Renewal'],
  ])('recalculates labels for %s without stale step labels', (_name, policyType) => {
    const formData = { policyType };
    expect(getNextButtonText(PERSONAL_STEPS, 'principles-disclosures', formData)).toBe('Next: Banking & Debit Order');
    expect(getNextButtonText(COMMERCIAL_STEPS, 'principles-disclosures', formData)).toBe('Next: Risk Categories');
  });
});
