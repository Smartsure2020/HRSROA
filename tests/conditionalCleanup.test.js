import { describe, it, expect } from 'vitest';
import { applySharedConditionalCleanup, clearStaleReplacementFields } from '../src/lib/conditionalCleanup.js';
import { applyConditionalCleanup as applyPersonalCleanup, getInitialFormData } from '../src/lib/hrsConstants.js';
import { applyConditionalCleanup as applyCommercialCleanup, getCommercialInitialFormData } from '../src/lib/hrsCommercialConstants.js';

describe('applySharedConditionalCleanup — Letter of Investigation (changingBroker)', () => {
  it('clears the investigation ack when changingBroker is not "yes"', () => {
    const data = { changingBroker: 'no', ackLetterOfInvestigation: true };
    const next = applySharedConditionalCleanup(data);
    expect(next.ackLetterOfInvestigation).toBe(false);
  });

  it('preserves the investigation ack while changingBroker is "yes"', () => {
    const data = { changingBroker: 'yes', ackLetterOfInvestigation: true };
    const next = applySharedConditionalCleanup(data);
    expect(next.ackLetterOfInvestigation).toBe(true);
  });

  it('clears any future/unknown investigation-specific field once not applicable', () => {
    const data = { changingBroker: 'no', ackLetterOfInvestigation: false, investigationNotes: 'some notes', investigationDate: '2026-01-01' };
    const next = applySharedConditionalCleanup(data);
    expect(next.investigationNotes).toBe('');
    expect(next.investigationDate).toBe('');
  });
});

describe('applySharedConditionalCleanup — broker fee', () => {
  it('clears stale ackBrokerFee once the fee is zero', () => {
    const data = { brokerFeeType: 'percent', brokerFeePercent: '0', prem2: '2000', ackBrokerFee: true };
    const next = applySharedConditionalCleanup(data);
    expect(next.ackBrokerFee).toBe(false);
  });

  it('preserves ackBrokerFee while the fee is genuinely positive', () => {
    const data = { brokerFeeType: 'percent', brokerFeePercent: '5', prem2: '2000', ackBrokerFee: true };
    const next = applySharedConditionalCleanup(data);
    expect(next.ackBrokerFee).toBe(true);
  });
});

describe('applySharedConditionalCleanup — Policy Type', () => {
  it('clears existingPolicyRef once Policy Type is New placement', () => {
    const data = { policyType: 'New placement', existingPolicyRef: 'Santam / P123' };
    const next = applySharedConditionalCleanup(data);
    expect(next.existingPolicyRef).toBe('');
  });

  it('keeps existingPolicyRef for Renewal', () => {
    const data = { policyType: 'Renewal', existingPolicyRef: 'Santam / P123' };
    const next = applySharedConditionalCleanup(data);
    expect(next.existingPolicyRef).toBe('Santam / P123');
  });

  it('keeps existingPolicyRef for Replacement', () => {
    const data = { policyType: 'Replacement', existingPolicyRef: 'Santam / P123' };
    const next = applySharedConditionalCleanup(data);
    expect(next.existingPolicyRef).toBe('Santam / P123');
  });
});

describe('applySharedConditionalCleanup — cancelReasonText (Phase ROA-0)', () => {
  it('clears cancelReasonText once specialTerms is no longer "yes"', () => {
    const data = { specialTerms: 'no', cancelReasonText: 'Previously cancelled by Old Mutual for late payment' };
    const next = applySharedConditionalCleanup(data);
    expect(next.cancelReasonText).toBe('');
  });

  it('clears cancelReasonText when specialTerms is null / undefined', () => {
    const data = { specialTerms: null, cancelReasonText: 'stale text' };
    const next = applySharedConditionalCleanup(data);
    expect(next.cancelReasonText).toBe('');
  });

  it('preserves cancelReasonText while specialTerms is "yes"', () => {
    const data = { specialTerms: 'yes', cancelReasonText: 'Cancelled due to policy claims' };
    const next = applySharedConditionalCleanup(data);
    expect(next.cancelReasonText).toBe('Cancelled due to policy claims');
  });
});

describe('applySharedConditionalCleanup — removed local evidence fields', () => {
  it('drops stale perils, local-signature, and removed generic needs-analysis fields safely', () => {
    const data = {
      perilsSelected: ['Fire', 'Other'],
      perilsOther: 'Cyber incident',
      clientSig: 'data:image/png;base64,AAA',
      advisorSig: 'data:image/png;base64,BBB',
      sigDate: '2026-09-30',
      valueToBeInsured: 'Replacement Value',
      compulsoryExcess: 'yes',
      voluntaryExcess: 'High',
      noClaimsBonus: 'yes',
      riskProfileNotes: 'Keep this detailed risk note',
    };
    const next = applySharedConditionalCleanup(data);
    expect(next).not.toHaveProperty('perilsSelected');
    expect(next).not.toHaveProperty('perilsOther');
    expect(next).not.toHaveProperty('clientSig');
    expect(next).not.toHaveProperty('advisorSig');
    expect(next).not.toHaveProperty('sigDate');
    expect(next).not.toHaveProperty('valueToBeInsured');
    expect(next).not.toHaveProperty('compulsoryExcess');
    expect(next).not.toHaveProperty('voluntaryExcess');
    expect(next).not.toHaveProperty('noClaimsBonus');
    expect(next.riskProfileNotes).toBe('Keep this detailed risk note');
  });
});

describe('applySharedConditionalCleanup — client election limitations', () => {
  it('clears electionInitials once every election flag is false', () => {
    const data = { electionDiffers: false, electionNotFollow: false, electionLimitedInfo: false, electionInitials: 'J.S.' };
    const next = applySharedConditionalCleanup(data);
    expect(next.electionInitials).toBe('');
  });

  it('preserves electionInitials while one election flag remains true', () => {
    const data = { electionDiffers: true, electionNotFollow: false, electionLimitedInfo: false, electionInitials: 'J.S.' };
    const next = applySharedConditionalCleanup(data);
    expect(next.electionInitials).toBe('J.S.');
  });
});

describe('clearStaleReplacementFields — Commercial replacement policy', () => {
  const filled = {
    replacingExisting: 'no',
    likeForLike: 'no',
    mainDifferences: 'text',
    exclusions: 'text',
    replacementReason: 'text',
    currentInsurer: 'Old Co',
    newInsurer: 'New Co',
  };

  it('clears all replacement child fields once replacingExisting is not "yes"', () => {
    const next = clearStaleReplacementFields(filled);
    expect(next.likeForLike).toBe('');
    expect(next.mainDifferences).toBe('');
    expect(next.exclusions).toBe('');
    expect(next.replacementReason).toBe('');
    expect(next.currentInsurer).toBe('');
    expect(next.newInsurer).toBe('');
  });

  it('preserves replacement child fields while replacingExisting is "yes"', () => {
    const next = clearStaleReplacementFields({ ...filled, replacingExisting: 'yes' });
    expect(next.currentInsurer).toBe('Old Co');
    expect(next.newInsurer).toBe('New Co');
  });
});

describe('Personal vs Commercial applyConditionalCleanup wiring', () => {
  it('Personal initial form data is a no-op under cleanup (nothing stale to clear)', () => {
    const initial = getInitialFormData();
    const cleaned = applyPersonalCleanup(initial);
    expect(cleaned.ackLetterOfInvestigation).toBe(false);
    expect(cleaned.ackBrokerFee).toBe(false);
  });

  it('Commercial cleanup also clears replacement fields that Personal does not have', () => {
    const initial = getCommercialInitialFormData();
    const withStale = { ...initial, replacingExisting: 'no', currentInsurer: 'Stale Co' };
    const cleaned = applyCommercialCleanup(withStale);
    expect(cleaned.currentInsurer).toBe('');
  });
});
