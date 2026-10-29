// Amend ROA (Issue #8) — shared rules, lineage presentation, wizard prefill and draft isolation.
// Pure logic: no network, no DOM.

import { beforeEach, describe, expect, it } from 'vitest';
import { createMemorySessionStorage } from './testUtils/memorySessionStorage.js';
import {
  AMEND_REASONS,
  AMEND_REASON_CODES,
  SUBMISSION_STATUSES,
  amendReasonLabel,
  amendmentBlockReason,
  amendmentWillCancelSigningRequest,
  buildRevisionChains,
  chainRootId,
  isAmendReason,
  lineageSummary,
  revisionLabel,
  revisionStateLabel,
  summariseChain,
  validateAmendmentReason,
  withAmendmentNotice,
} from '../src/lib/roaAmendment.js';
import { prefillFormDataFromSnapshot } from '../src/lib/roaAmendmentPrefill.js';
import {
  clearRoaDraft,
  getDraftStatus,
  saveRoaDraft,
} from '../src/lib/roaDraftStorage.js';
import { getInitialFormData, getStepErrors, applyConditionalCleanup as personalCleanup } from '../src/lib/hrsConstants.js';
import {
  getCommercialInitialFormData,
  getCommercialStepErrors,
  applyConditionalCleanup as commercialCleanup,
} from '../src/lib/hrsCommercialConstants.js';
import { createSubmissionSnapshot, generateSubmissionId } from '../src/lib/roaSubmissionSnapshot.js';
import { describeSignatureSendError } from '../src/lib/signatureSendFeedback.js';
import { describeCrmSyncError, isCrmSyncDeferred } from '../src/lib/crmAdapter.js';

describe('amendment reasons', () => {
  it('offers exactly the six reasons the issue specifies, in order', () => {
    expect(AMEND_REASONS.map((r) => r.label)).toEqual([
      'Incorrect contact details',
      'Incorrect email',
      'Spelling correction',
      'Change in cover or recommendation',
      'Client information changed',
      'Other',
    ]);
    expect(AMEND_REASON_CODES).toEqual([
      'incorrect_contact_details', 'incorrect_email', 'spelling_correction',
      'change_in_cover_or_recommendation', 'client_information_changed', 'other',
    ]);
    expect(isAmendReason('other')).toBe(true);
    expect(isAmendReason('Other')).toBe(false);
    expect(isAmendReason(undefined)).toBe(false);
    expect(amendReasonLabel('incorrect_email')).toBe('Incorrect email');
    expect(amendReasonLabel('nope')).toBeNull();
  });

  it('requires a reason, and a note for "Other"; trims and bounds the note', () => {
    expect(validateAmendmentReason({})).toEqual({ ok: false, error: 'invalid_amendment_reason' });
    expect(validateAmendmentReason({ reason: 'nope' }).ok).toBe(false);
    expect(validateAmendmentReason({ reason: 'other' })).toEqual({ ok: false, error: 'amendment_reason_detail_required' });
    expect(validateAmendmentReason({ reason: 'other', reasonDetail: ' ab ' }).ok).toBe(false);
    expect(validateAmendmentReason({ reason: 'other', reasonDetail: '  abc  ' })).toEqual({ ok: true, reason: 'other', reasonDetail: 'abc' });
    expect(validateAmendmentReason({ reason: 'incorrect_email' })).toEqual({ ok: true, reason: 'incorrect_email', reasonDetail: null });
    expect(validateAmendmentReason({ reason: 'incorrect_email', reasonDetail: '  ' }).reasonDetail).toBeNull();
    expect(validateAmendmentReason({ reason: 'incorrect_email', reasonDetail: 'x'.repeat(501) }).ok).toBe(false);
    expect(validateAmendmentReason({ reason: 'incorrect_email', reasonDetail: 42 }).ok).toBe(false);
  });

  it('keeps the free-text note out of the notification email', () => {
    const email = withAmendmentNotice(
      { subject: 'New ROA – Jane Doe', body: 'Body.' },
      { nextRevisionNo: 3, reason: 'other' },
    );
    expect(email.subject).toBe('AMENDED (Revision 3) – New ROA – Jane Doe');
    expect(email.body).toContain('REVISION 3');
    expect(email.body).toContain('Reason: Other');
    expect(email.body.endsWith('Body.')).toBe(true);
  });
});

describe('amendment eligibility — every status', () => {
  it('knows all seven statuses', () => {
    expect([...SUBMISSION_STATUSES].sort()).toEqual([
      'awaiting_signature', 'completed', 'declined', 'expired', 'signature_failed', 'submitted', 'voided',
    ]);
  });

  it.each(SUBMISSION_STATUSES)('allows amending the head of the chain when %s (no live legacy envelope)', (status) => {
    expect(amendmentBlockReason({ status, hasEnvelope: false })).toBeNull();
    expect(amendmentBlockReason({ status, hasEnvelope: true, signingProvider: 'documenso' })).toBeNull();
  });

  it.each(SUBMISSION_STATUSES)('never allows amending a superseded %s revision', (status) => {
    expect(amendmentBlockReason({ status, supersededBySubmissionId: 'ROA-x' })).toBe('already_superseded');
  });

  it('refuses unknown statuses and live legacy DocuSign envelopes, but not final ones', () => {
    expect(amendmentBlockReason({ status: 'weird' })).toBe('status_not_amendable');
    expect(amendmentBlockReason({})).toBe('status_not_amendable');
    for (const status of ['submitted', 'awaiting_signature', 'signature_failed']) {
      expect(amendmentBlockReason({ status, hasEnvelope: true, signingProvider: 'docusign' }))
        .toBe('legacy_provider_manual_void_required');
    }
    for (const status of ['completed', 'declined', 'voided', 'expired']) {
      expect(amendmentBlockReason({ status, hasEnvelope: true, signingProvider: 'docusign' })).toBeNull();
    }
  });

  it('warns about cancellation only when a request could still be live', () => {
    expect(amendmentWillCancelSigningRequest({ status: 'awaiting_signature', hasEnvelope: true })).toBe(true);
    expect(amendmentWillCancelSigningRequest({ status: 'awaiting_signature', hasEnvelope: false })).toBe(false);
    for (const status of ['submitted', 'completed', 'declined', 'voided', 'expired']) {
      expect(amendmentWillCancelSigningRequest({ status, hasEnvelope: true })).toBe(status === 'submitted');
    }
  });
});

describe('revision lineage presentation', () => {
  const item = (no, status, extra = {}) => ({
    submissionId: `ROA-${String(no).padStart(8, '0')}-0000-4000-8000-000000000000`,
    parentSubmissionId: no === 1 ? null : 'ROA-00000001-0000-4000-8000-000000000000',
    revisionNo: no,
    status,
    ...extra,
  });

  it('groups items into chains oldest first and finds the root', () => {
    const items = [item(2, 'awaiting_signature'), item(1, 'completed'), { submissionId: 'ROA-solo', revisionNo: 1, status: 'submitted' }];
    const chains = buildRevisionChains(items);
    expect(chains.size).toBe(2);
    expect(chains.get(chainRootId(items[1])).map((i) => i.revisionNo)).toEqual([1, 2]);
    expect(revisionLabel(items[0])).toBe('Rev 2');
    expect(revisionLabel({})).toBe('Rev 1');
  });

  it('a signed original stays the last signed ROA while its replacement awaits signature', () => {
    const chain = summariseChain([item(1, 'completed'), item(2, 'awaiting_signature')]);
    expect(chain.lastSigned.revisionNo).toBe(1);
    expect(chain.head.revisionNo).toBe(2);
    expect(chain.replacementPending.revisionNo).toBe(2);
    expect(chain.replacementFailed).toBeNull();
  });

  it.each(['declined', 'voided', 'expired'])('a %s replacement leaves the original as the signed ROA', (status) => {
    const chain = summariseChain([item(1, 'completed'), item(2, status)]);
    expect(chain.lastSigned.revisionNo).toBe(1);
    expect(chain.replacementPending).toBeNull();
    expect(chain.replacementFailed.revisionNo).toBe(2);
  });

  it('a signed replacement becomes the last signed ROA; the first stays signed too', () => {
    const chain = summariseChain([item(1, 'completed'), item(2, 'completed'), item(3, 'submitted')]);
    expect(chain.lastSigned.revisionNo).toBe(2);
    expect(chain.replacementPending.revisionNo).toBe(3);
    expect(chain.revisions.filter((r) => r.status === 'completed')).toHaveLength(2);
  });

  it('reports no "last signed" when nothing in the chain was ever signed', () => {
    const chain = summariseChain([item(1, 'voided'), item(2, 'awaiting_signature')]);
    expect(chain.lastSigned).toBeNull();
    expect(chain.replacementPending).toBeNull();
  });

  it('describes signed state separately from lineage', () => {
    const items = [
      item(1, 'completed', { supersededBySubmissionId: 'x' }),
      item(2, 'awaiting_signature'),
    ];
    expect(revisionStateLabel(items[0])).toBe('Signed');
    expect(revisionStateLabel(items[1])).toBe('Awaiting signature');
    expect(lineageSummary(items[0], items)).toBe('Last signed: Rev 1 · Rev 2 replacement: awaiting signature');
    expect(lineageSummary(items[1], items)).toBe('Last signed: Rev 1 · Rev 2 replacement: awaiting signature');
    expect(lineageSummary({ submissionId: 'ROA-solo', revisionNo: 1, status: 'completed' }, [])).toBeNull();
    const failed = [item(1, 'completed', { supersededBySubmissionId: 'x' }), item(2, 'declined')];
    expect(lineageSummary(failed[1], failed)).toBe('Last signed: Rev 1 · Rev 2 replacement declined — Rev 1 remains the signed ROA');
  });

  it('every refusal the send endpoint can give has a plain-language message', () => {
    const codes = [
      'submission_superseded', 'predecessor_completed', 'predecessor_cancel_unverified',
      'predecessor_cancel_rejected', 'predecessor_status_unavailable', 'predecessor_unverifiable',
      'predecessor_send_in_progress', 'predecessor_changed', 'predecessor_provider_unsupported',
      'predecessor_status_unrecognised', 'predecessor_missing', 'revision_chain_inconsistent',
      'replacement_gate_failed',
    ];
    for (const code of codes) {
      const text = describeSignatureSendError({ code, message: code });
      expect(text, code).not.toBe(code);
      expect(text.length, code).toBeGreaterThan(20);
    }
    expect(describeSignatureSendError(new Error('something else'))).toBe('something else');
    expect(describeSignatureSendError({})).toMatch(/Could not send/);
  });

  it('presents the deferred CRM filing of revisions as information, not failure', () => {
    expect(isCrmSyncDeferred('crm_revision_sync_not_enabled')).toBe(true);
    expect(isCrmSyncDeferred('crm_unreachable')).toBe(false);
    expect(describeCrmSyncError('crm_revision_sync_not_enabled')).toMatch(/not switched on yet/);
    expect(describeCrmSyncError('crm_unreachable')).toBe('crm_unreachable');
  });
});

// ---------------------------------------------------------------------------------------
function validPersonal() {
  const form = getInitialFormData();
  Object.assign(form, {
    title: 'Ms', initials: 'J', firstName: 'Jane', surname: 'Doe', idNumber: '8001015009087',
    email: 'jane@example.com', cell: '0821234567', streetNumber: '1', streetName: 'Main Rd', suburb: 'Sea Point',
    city: 'Cape Town', province: 'Western Cape', postalCode: '8005', brokerName: 'Andrew Penney',
    policyType: 'New', uninterruptedInsurance: 'yes', clientDeclinedInfo: 'no',
    ins2: 'Stratsys', prem2: '1500', recInsurer: 'Stratsys', recReasons: 'Best value',
    ackPrinciples: true, ackAdvisor: true, ackClient: true, ackPopia: true, ackTermination: true,
    ackBrokerAppointment: true, ackBrokerAuth: true, ackStatutoryDisclosure: true,
    bankHolder: 'J Doe', accountNumber: '1234567890', additionalComments: 'Has a dog',
  });
  form.riskState = form.riskState.map((r, i) => (i === 0 ? { ...r, cover: 'yes' } : r));
  return form;
}

function validCommercial() {
  const form = getCommercialInitialFormData();
  Object.assign(form, {
    companyName: 'ACME Pty Ltd', registrationNo: '2020/123456/07', vatNo: '4123456789', natureOfBusiness: 'Retail',
    streetNumber: '9', streetName: 'Long St', suburb: 'CBD', city: 'Cape Town', province: 'Western Cape', postalCode: '8001',
    contactTitle: 'Mr', contactFirstName: 'Alex', contactSurname: 'Rivera', contactPerson: 'Alex Rivera',
    email: 'alex@acme.example', contactNo: '0211234567', brokerName: 'Andrew Penney', policyType: 'New',
    uninterruptedInsurance: 'yes', clientDeclinedInfo: 'no', ins2: 'Stratsys', prem2: '9000', recInsurer: 'Stratsys',
    recReasons: 'Best value', replacingExisting: 'no',
    ackPrinciples: true, ackAdvisor: true, ackClient: true, ackPopia: true, ackTermination: true,
    ackBrokerAppointment: true, ackBrokerAuth: true, ackIntermediaryAgreement: true, ackStatutoryDisclosure: true,
  });
  form.riskState = form.riskState.map((r, i) => (i === 0 ? { ...r, cover: 'yes' } : r));
  return form;
}

const FLOWS = [
  { roaType: 'Personal', make: validPersonal, initial: getInitialFormData, cleanup: personalCleanup, errors: getStepErrors, steps: [0, 1, 2, 3, 4, 5, 6], emailField: 'email' },
  { roaType: 'Commercial', make: validCommercial, initial: getCommercialInitialFormData, cleanup: commercialCleanup, errors: getCommercialStepErrors, steps: [0, 1, 2, 3, 4, 5], emailField: 'email' },
];

describe.each(FLOWS)('$roaType wizard prefill', ({ roaType, make, initial, cleanup, errors, steps, emailField }) => {
  const frozen = () => createSubmissionSnapshot(roaType, make(), { applyCleanup: cleanup }).snapshotForDb;
  const allErrors = (formData) => steps.flatMap((s) => errors(s, formData));

  it('starts from a form that is valid, so the fixture is meaningful', () => {
    expect(allErrors(cleanup(make()))).toEqual([]);
  });

  it('carries every answer of the frozen snapshot across, losing nothing', () => {
    const snapshot = frozen();
    const { formData, droppedKeys, warnings } = prefillFormDataFromSnapshot(roaType, snapshot);
    expect(droppedKeys).toEqual([]);
    expect(warnings).toEqual([]);
    for (const [key, value] of Object.entries(snapshot)) {
      expect(formData[key], key).toEqual(value);
    }
  });

  it('opens already valid, and re-validates when the broker changes something', () => {
    const { formData } = prefillFormDataFromSnapshot(roaType, frozen());
    expect(allErrors(formData)).toEqual([]);
    expect(allErrors({ ...formData, [emailField]: '' })).not.toEqual([]);
    expect(allErrors({ ...formData, ackPopia: false })).not.toEqual([]);
  });

  it('never imports signature or local-evidence data, even from an old snapshot that held it', () => {
    const dirty = {
      ...frozen(),
      clientSig: 'data:image/png;base64,AAAA',
      advisorSig: 'data:image/png;base64,BBBB',
      sigDate: '2026-01-01',
      perilsSelected: ['fire'],
      valueToBeInsured: '1',
    };
    const { formData } = prefillFormDataFromSnapshot(roaType, dirty);
    for (const key of ['clientSig', 'advisorSig', 'sigDate', 'perilsSelected', 'valueToBeInsured']) {
      expect(key in formData, key).toBe(false);
    }
  });

  it('gives fields added since the original their CURRENT defaults', () => {
    const snapshot = { ...frozen() }; // the frozen original is deep-frozen; copy to simulate an older shape
    const defaults = initial();
    delete snapshot.clientNeeds; // pretend an older snapshot predates this field
    delete snapshot.basisDecision;
    const { formData } = prefillFormDataFromSnapshot(roaType, snapshot);
    expect(formData.clientNeeds).toBe(defaults.clientNeeds);
    expect(formData.basisDecision).toBe(defaults.basisDecision);
  });

  it('drops (and reports) keys the form no longer has, rather than silently keeping them', () => {
    const { formData, droppedKeys } = prefillFormDataFromSnapshot(roaType, { ...frozen(), legacyField: 'x' });
    expect(droppedKeys).toEqual(['legacyField']);
    expect('legacyField' in formData).toBe(false);
  });

  it('re-applies the conditional-cleanup invariants to stale child answers', () => {
    const stale = { ...frozen(), changingBroker: 'no', ackLetterOfInvestigation: true, specialTerms: 'no', cancelReasonText: 'old reason' };
    const { formData } = prefillFormDataFromSnapshot(roaType, stale);
    expect(formData.ackLetterOfInvestigation).toBe(false);
    expect(formData.cancelReasonText).toBe('');
  });

  it('flags a structured answer whose shape changed so the broker reviews it', () => {
    const { warnings } = prefillFormDataFromSnapshot(roaType, { ...frozen(), riskState: [{ cover: 'yes', flagged: false }] });
    expect(warnings).toContain('riskState_shape_changed');
  });

  it('fills the adviser from the signed-in broker only when the snapshot has none', () => {
    const none = prefillFormDataFromSnapshot(roaType, { ...frozen(), brokerName: '' }, { brokerName: 'Werner Rautenbach' });
    expect(none.formData.brokerName).toBe('Werner Rautenbach');
    const kept = prefillFormDataFromSnapshot(roaType, frozen(), { brokerName: 'Werner Rautenbach' });
    expect(kept.formData.brokerName).toBe('Andrew Penney');
  });

  it('produces a new submission whose snapshot round-trips without data loss', () => {
    const original = frozen();
    const { formData } = prefillFormDataFromSnapshot(roaType, original);
    const edited = { ...formData, [emailField]: 'corrected@example.com' };
    const next = createSubmissionSnapshot(roaType, edited, { applyCleanup: cleanup });
    expect(next.submissionId).not.toBe(generateSubmissionId()); // fresh, never the original's id
    expect({ ...next.snapshotForDb, [emailField]: original[emailField] }).toEqual(original);
    expect(next.snapshotForDb[emailField]).toBe('corrected@example.com');
  });
});

describe('prefill input safety', () => {
  it('rejects unsupported ROA types and missing snapshots', () => {
    expect(() => prefillFormDataFromSnapshot('Marine', {})).toThrow(/Unsupported/);
    expect(() => prefillFormDataFromSnapshot('Personal', null)).toThrow(/snapshot is required/);
    expect(() => prefillFormDataFromSnapshot('Personal', [])).toThrow(/snapshot is required/);
  });

  it('does not mutate the snapshot it was given', () => {
    const snapshot = Object.freeze({ ...createSubmissionSnapshot('Personal', validPersonal(), { applyCleanup: personalCleanup }).snapshotForDb });
    expect(() => prefillFormDataFromSnapshot('Personal', snapshot)).not.toThrow();
  });
});

describe('amendment drafts are stored apart from new-ROA drafts', () => {
  const ORIGINAL_A = 'ROA-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ORIGINAL_B = 'ROA-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  beforeEach(() => {
    globalThis.sessionStorage = createMemorySessionStorage();
  });

  it('an amendment draft never overwrites, restores into, or clears a new-ROA draft', () => {
    saveRoaDraft('personal', { currentStep: 2, formData: { firstName: 'Brand', surname: 'New' } });
    saveRoaDraft('personal', { currentStep: 4, formData: { firstName: 'Amended', surname: 'Copy' } }, ORIGINAL_A);

    expect(getDraftStatus('personal').draft.formData.firstName).toBe('Brand');
    expect(getDraftStatus('personal', ORIGINAL_A).draft.formData.firstName).toBe('Amended');
    expect(getDraftStatus('personal', ORIGINAL_A).draft.currentStep).toBe(4);

    clearRoaDraft('personal', ORIGINAL_A);
    expect(getDraftStatus('personal', ORIGINAL_A).status).toBe('none');
    expect(getDraftStatus('personal').draft.formData.firstName).toBe('Brand');

    saveRoaDraft('personal', { currentStep: 1, formData: { firstName: 'Amended' } }, ORIGINAL_A);
    clearRoaDraft('personal');
    expect(getDraftStatus('personal', ORIGINAL_A).status).toBe('valid');
  });

  it('keeps drafts for different amendments, and for Personal vs Commercial, apart', () => {
    saveRoaDraft('personal', { currentStep: 1, formData: { firstName: 'A' } }, ORIGINAL_A);
    saveRoaDraft('personal', { currentStep: 1, formData: { firstName: 'B' } }, ORIGINAL_B);
    saveRoaDraft('commercial', { currentStep: 1, formData: { companyName: 'C' } }, ORIGINAL_A);
    expect(getDraftStatus('personal', ORIGINAL_A).draft.formData.firstName).toBe('A');
    expect(getDraftStatus('personal', ORIGINAL_B).draft.formData.firstName).toBe('B');
    expect(getDraftStatus('commercial', ORIGINAL_A).draft.formData.companyName).toBe('C');
    expect(getDraftStatus('commercial').status).toBe('none');
  });

  it('refuses a scope that is not a submission id, writing nothing', () => {
    saveRoaDraft('personal', { currentStep: 1, formData: { firstName: 'X' } }, '../../escape');
    saveRoaDraft('personal', { currentStep: 1, formData: { firstName: 'X' } }, 'ROA-short');
    expect(sessionStorage.length).toBe(0);
    expect(getDraftStatus('personal', '../../escape').status).toBe('none');
  });

  it('still strips signature images from an amendment draft', () => {
    saveRoaDraft('personal', { currentStep: 1, formData: { firstName: 'A', clientSig: 'data:image/png;base64,AAA' } }, ORIGINAL_A);
    expect(getDraftStatus('personal', ORIGINAL_A).draft.formData.clientSig).toBeUndefined();
  });
});
