import { describe, it, expect } from 'vitest';
import { getBrokerFeeSummary } from '../src/lib/brokerFee.js';

function fd(overrides = {}) {
  return { brokerFeeType: 'percent', brokerFeePercent: '', prem2: '2000', ...overrides };
}

describe('getBrokerFeeSummary', () => {
  it('requires consent for a positive percentage fee', () => {
    const s = getBrokerFeeSummary(fd({ brokerFeeType: 'percent', brokerFeePercent: '5', prem2: '2000' }));
    expect(s.consentRequired).toBe(true);
    expect(s.type).toBe('percent');
    expect(s.calculatedAmount).toBeCloseTo(100, 2);
    expect(s.displayValue).toContain('%');
  });

  it('requires consent for a positive fixed fee', () => {
    const s = getBrokerFeeSummary(fd({ brokerFeeType: 'fixed', brokerFeePercent: '350' }));
    expect(s.consentRequired).toBe(true);
    expect(s.type).toBe('fixed');
    expect(s.calculatedAmount).toBe(350);
    expect(s.displayValue).toBe('R 350.00');
  });

  it('does not require consent for a zero percentage fee', () => {
    const s = getBrokerFeeSummary(fd({ brokerFeeType: 'percent', brokerFeePercent: '0', prem2: '2000' }));
    expect(s.consentRequired).toBe(false);
    expect(s.type).toBe('none');
    expect(s.displayValue).toBe('No broker fee applicable');
  });

  it('does not require consent for a blank fixed fee (R0 / not entered)', () => {
    const s = getBrokerFeeSummary(fd({ brokerFeeType: 'fixed', brokerFeePercent: '' }));
    expect(s.consentRequired).toBe(false);
    expect(s.displayValue).toBe('No broker fee applicable');
  });

  it('treats a negative fee as invalid, not as a fee requiring consent', () => {
    const s = getBrokerFeeSummary(fd({ brokerFeeType: 'fixed', brokerFeePercent: '-50' }));
    expect(s.isInvalid).toBe(true);
    expect(s.consentRequired).toBe(false);
    expect(s.displayValue).toBe('Invalid fee value');
  });

  it('treats a non-numeric entry as invalid', () => {
    const s = getBrokerFeeSummary(fd({ brokerFeeType: 'percent', brokerFeePercent: 'abc' }));
    expect(s.isInvalid).toBe(true);
    expect(s.consentRequired).toBe(false);
  });

  it('fixed and percentage displays differ correctly for the same numeric input', () => {
    const pct = getBrokerFeeSummary(fd({ brokerFeeType: 'percent', brokerFeePercent: '10', prem2: '1000' }));
    const fixed = getBrokerFeeSummary(fd({ brokerFeeType: 'fixed', brokerFeePercent: '10' }));
    expect(pct.displayValue).toBe('10% (R 100.00)');
    expect(fixed.displayValue).toBe('R 10.00');
  });

  it('going from a positive fee to zero drops consentRequired (used to clear stale consent)', () => {
    const positive = getBrokerFeeSummary(fd({ brokerFeeType: 'percent', brokerFeePercent: '5', prem2: '2000' }));
    const zero = getBrokerFeeSummary(fd({ brokerFeeType: 'percent', brokerFeePercent: '0', prem2: '2000' }));
    expect(positive.consentRequired).toBe(true);
    expect(zero.consentRequired).toBe(false);
  });
});
