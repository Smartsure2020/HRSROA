import { describe, it, expect, beforeEach } from 'vitest';
import { createMemorySessionStorage } from './testUtils/memorySessionStorage.js';
import {
  saveRoaDraft,
  getDraftStatus,
  clearRoaDraft,
  isRoaDraftExpired,
  sanitiseDraftFormData,
} from '../src/lib/roaDraftStorage.js';

const PERSONAL_KEY = 'hrs_roa_draft_personal';
const COMMERCIAL_KEY = 'hrs_roa_draft_commercial';
const LEGACY_KEY = 'hrs_roa_draft';

beforeEach(() => {
  globalThis.sessionStorage = createMemorySessionStorage();
});

describe('sanitiseDraftFormData', () => {
  it('strips signature images before storage', () => {
    const clean = sanitiseDraftFormData({ firstName: 'Jane', clientSig: 'data:image/png;base64,AAA', advisorSig: 'data:image/png;base64,BBB' });
    expect(clean.clientSig).toBeUndefined();
    expect(clean.advisorSig).toBeUndefined();
    expect(clean.firstName).toBe('Jane');
  });
});

describe('saveRoaDraft — separate keys per flow', () => {
  it('uses different sessionStorage keys for personal and commercial', () => {
    saveRoaDraft('personal', { currentStep: 1, formData: { firstName: 'Jane' } });
    saveRoaDraft('commercial', { currentStep: 2, formData: { companyName: 'Acme' } });

    expect(sessionStorage.getItem(PERSONAL_KEY)).not.toBeNull();
    expect(sessionStorage.getItem(COMMERCIAL_KEY)).not.toBeNull();

    const personal = JSON.parse(sessionStorage.getItem(PERSONAL_KEY));
    const commercial = JSON.parse(sessionStorage.getItem(COMMERCIAL_KEY));
    expect(personal.formData.firstName).toBe('Jane');
    expect(commercial.formData.companyName).toBe('Acme');
  });

  it('never persists signature images', () => {
    saveRoaDraft('personal', { currentStep: 0, formData: { firstName: 'Jane', clientSig: 'data:image/png;base64,AAA' } });
    const raw = sessionStorage.getItem(PERSONAL_KEY);
    expect(raw).not.toContain('base64,AAA');
  });
});

describe('isRoaDraftExpired / TTL', () => {
  it('is not expired when just saved', () => {
    saveRoaDraft('personal', { currentStep: 0, formData: {} });
    const draft = JSON.parse(sessionStorage.getItem(PERSONAL_KEY));
    expect(isRoaDraftExpired(draft)).toBe(false);
  });

  it('is expired once savedAt is more than 24 hours old', () => {
    const old = { schemaVersion: 1, flowType: 'personal', savedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), currentStep: 0, formData: {} };
    expect(isRoaDraftExpired(old)).toBe(true);
  });

  it('getDraftStatus removes and reports an expired draft rather than restoring it', () => {
    const old = { schemaVersion: 1, flowType: 'personal', savedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), currentStep: 2, formData: { firstName: 'Old' } };
    sessionStorage.setItem(PERSONAL_KEY, JSON.stringify(old));

    const { status, draft } = getDraftStatus('personal');
    expect(status).toBe('expired');
    expect(draft).toBeNull();
    expect(sessionStorage.getItem(PERSONAL_KEY)).toBeNull();
  });
});

describe('clearRoaDraft — flow isolation', () => {
  it('clearing the Personal draft never clears the Commercial draft', () => {
    saveRoaDraft('personal', { currentStep: 0, formData: { firstName: 'Jane' } });
    saveRoaDraft('commercial', { currentStep: 0, formData: { companyName: 'Acme' } });

    clearRoaDraft('personal');

    expect(sessionStorage.getItem(PERSONAL_KEY)).toBeNull();
    expect(sessionStorage.getItem(COMMERCIAL_KEY)).not.toBeNull();
  });
});

describe('legacy Personal draft migration', () => {
  it('migrates a valid old-schema Personal draft into the new key and removes the legacy key', () => {
    sessionStorage.setItem(LEGACY_KEY, JSON.stringify({ firstName: 'Legacy', surname: 'User', idNumber: '123' }));

    const { status, draft } = getDraftStatus('personal');

    expect(status).toBe('valid');
    expect(draft.formData.firstName).toBe('Legacy');
    expect(sessionStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(sessionStorage.getItem(PERSONAL_KEY)).not.toBeNull();
  });

  it('discards a malformed legacy draft rather than guessing at migration', () => {
    sessionStorage.setItem(LEGACY_KEY, JSON.stringify({ someRandomKey: true }));

    const { status, draft } = getDraftStatus('personal');

    expect(status).toBe('none');
    expect(draft).toBeNull();
    expect(sessionStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('never interprets a legacy Personal draft as a Commercial draft', () => {
    sessionStorage.setItem(LEGACY_KEY, JSON.stringify({ firstName: 'Legacy', surname: 'User', idNumber: '123' }));

    const commercialResult = getDraftStatus('commercial');
    expect(commercialResult.status).toBe('none');
  });
});

describe('draft normalisation on restore', () => {
  it('re-applies conditional cleanup so a stale acknowledged Letter of Investigation cannot reappear', () => {
    saveRoaDraft('personal', {
      currentStep: 4,
      formData: { changingBroker: 'no', ackLetterOfInvestigation: true, firstName: 'Jane' },
    });
    const { draft } = getDraftStatus('personal');
    expect(draft.formData.ackLetterOfInvestigation).toBe(false);
  });

  it('drops unknown/deprecated fields and coerces arrays/booleans', () => {
    saveRoaDraft('personal', {
      currentStep: 0,
      formData: { someDeprecatedField: 'gone', ackPrinciples: 'yes', perilsSelected: 'not-an-array' },
    });
    const { draft } = getDraftStatus('personal');
    expect(draft.formData.someDeprecatedField).toBeUndefined();
    expect(draft.formData.ackPrinciples).toBe(true);
    expect(Array.isArray(draft.formData.perilsSelected)).toBe(true);
  });

  it('never restores signatures even if present in stored data', () => {
    sessionStorage.setItem(PERSONAL_KEY, JSON.stringify({
      schemaVersion: 1, flowType: 'personal', savedAt: new Date().toISOString(), currentStep: 0,
      formData: { firstName: 'Jane', clientSig: 'data:image/png;base64,AAA' },
    }));
    const { draft } = getDraftStatus('personal');
    expect(draft.formData.clientSig).toBeNull();
  });
});
