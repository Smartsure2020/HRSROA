// Operator tooling for the CRM-auth cutover: the configuration preflight and the
// broker-identity reconciliation. Fabricated data only — no real accounts, no network.

import { describe, expect, it } from 'vitest';
import {
  describeKey,
  evaluateAuthEnvironment,
  evaluateAuthSettings,
} from '../scripts/lib/authPreflight.mjs';
import {
  formatReconciliation,
  maskEmail,
  reconcileBrokerIdentities,
} from '../scripts/lib/brokerReconciliation.mjs';
import { BROKER_EMAIL_MAP } from '../src/lib/brokerDirectory.js';

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwtKey = (claims) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.${Buffer.from('sig').toString('base64url')}`;

const CRM_REF = 'mgqelduyralkdbsbwqcu';
const ROA_REF = 'rylfshngbafldisqrhec';
const crmAnon = jwtKey({ role: 'anon', ref: CRM_REF });
const roaService = jwtKey({ role: 'service_role', ref: ROA_REF });

function goodEnv(overrides = {}) {
  return {
    AUTH_SUPABASE_URL: `https://${CRM_REF}.supabase.co`,
    AUTH_SUPABASE_ANON_KEY: crmAnon,
    VITE_AUTH_SUPABASE_URL: `https://${CRM_REF}.supabase.co`,
    VITE_AUTH_SUPABASE_ANON_KEY: crmAnon,
    ROA_SUPABASE_URL: `https://${ROA_REF}.supabase.co`,
    ROA_SUPABASE_SERVICE_ROLE_KEY: roaService,
    CRM_INTEGRATION_SECRET: 'x'.repeat(40),
    ...overrides,
  };
}
const failing = (result) => result.checks.filter((c) => c.status === 'FAIL').map((c) => c.name);

describe('config preflight', () => {
  it('passes a correct cutover configuration', () => {
    const result = evaluateAuthEnvironment(goodEnv(), { expectedAuthRef: CRM_REF, expectedDataRef: ROA_REF });
    expect(result.ok).toBe(true);
    expect(failing(result)).toEqual([]);
  });

  it('fails when the browser and server point at different auth projects', () => {
    const result = evaluateAuthEnvironment(goodEnv({ VITE_AUTH_SUPABASE_URL: `https://${ROA_REF}.supabase.co` }));
    expect(failing(result)).toContain('Browser and server use the same AUTH project');
  });

  it('fails when the auth URL is paired with the other project\'s key', () => {
    const result = evaluateAuthEnvironment(goodEnv({ AUTH_SUPABASE_ANON_KEY: jwtKey({ role: 'anon', ref: ROA_REF }) }));
    expect(failing(result)).toContain('AUTH key belongs to the AUTH URL');
  });

  it('fails when a privileged key is used for token validation or exposed to the browser', () => {
    expect(failing(evaluateAuthEnvironment(goodEnv({ AUTH_SUPABASE_ANON_KEY: jwtKey({ role: 'service_role', ref: CRM_REF }) }))))
      .toContain('AUTH key is an anon (public) key');
    expect(failing(evaluateAuthEnvironment(goodEnv({ VITE_ROA_SERVICE_ROLE_KEY: 'oops' }))))
      .toContain('No privileged key exposed through a VITE_ variable');
  });

  it('fails when the data key is not the service-role key', () => {
    const result = evaluateAuthEnvironment(goodEnv({ ROA_SUPABASE_SERVICE_ROLE_KEY: jwtKey({ role: 'anon', ref: ROA_REF }) }));
    expect(failing(result)).toContain('DATA key is the service-role key');
  });

  it('fails a partial pair and a missing pair rather than silently mixing', () => {
    const partial = evaluateAuthEnvironment(goodEnv({ AUTH_SUPABASE_ANON_KEY: undefined }));
    expect(failing(partial)).toContain('Server AUTH pair');
    const unset = evaluateAuthEnvironment({});
    expect(failing(unset)).toEqual(expect.arrayContaining(['Server AUTH pair', 'Browser AUTH pair', 'ROA data pair']));
  });

  it('treats auth == data as a failure for cutover and a warning for rollback validation', () => {
    const same = goodEnv({ AUTH_SUPABASE_URL: `https://${ROA_REF}.supabase.co`, AUTH_SUPABASE_ANON_KEY: jwtKey({ role: 'anon', ref: ROA_REF }),
      VITE_AUTH_SUPABASE_URL: `https://${ROA_REF}.supabase.co`, VITE_AUTH_SUPABASE_ANON_KEY: jwtKey({ role: 'anon', ref: ROA_REF }) });
    expect(failing(evaluateAuthEnvironment(same))).toContain('Auth and data are separate projects');
    const rollback = evaluateAuthEnvironment(same, { requireSplit: false });
    expect(rollback.checks.find((c) => c.name === 'Auth and data are separate projects').status).toBe('WARN');
  });

  it('flags the CRM integration secret being reused as an auth/data key', () => {
    const result = evaluateAuthEnvironment(goodEnv({ CRM_INTEGRATION_SECRET: crmAnon }));
    expect(failing(result)).toContain('CRM integration secret is distinct from auth/data keys');
  });

  it('never echoes key material', () => {
    const output = JSON.stringify(evaluateAuthEnvironment(goodEnv()));
    expect(output).not.toContain(crmAnon);
    expect(output).not.toContain(roaService);
  });

  it('classifies key formats without verifying them', () => {
    expect(describeKey(crmAnon)).toEqual({ kind: 'jwt', role: 'anon', ref: CRM_REF });
    expect(describeKey('sb_publishable_abc').kind).toBe('publishable');
    expect(describeKey('sb_secret_abc').kind).toBe('secret');
    expect(describeKey('')).toEqual({ kind: 'missing' });
    expect(describeKey('garbage').kind).toBe('unknown');
  });
});

describe('AUTH project settings (live check interpretation)', () => {
  it('passes only when email confirmation is required; warns while public sign-up is open', () => {
    const open = evaluateAuthSettings({ mailer_autoconfirm: false, disable_signup: false });
    expect(open.ok).toBe(true);
    expect(open.checks.find((c) => c.name === 'Public sign-up is disabled').status).toBe('WARN');

    expect(evaluateAuthSettings({ mailer_autoconfirm: false, disable_signup: true }).checks.every((c) => c.status === 'PASS')).toBe(true);
  });

  it('fails when autoconfirm is on — an approved broker\'s address could then be registered by anyone', () => {
    const result = evaluateAuthSettings({ mailer_autoconfirm: true, disable_signup: false });
    expect(result.ok).toBe(false);
    expect(failing(result)).toContain('Email confirmation is required (autoconfirm off)');
  });

  it('fails when settings are unreadable', () => {
    expect(evaluateAuthSettings(null).ok).toBe(false);
  });
});

// ---- reconciliation ------------------------------------------------------

const MISSING_IN_CRM = ['Andrew Penney', 'Charmaine Brogden', 'Jaryd Browne', 'Timothy Simpson'];
const emailOf = (name) => BROKER_EMAIL_MAP[name];

function crmUsersFor(names, extra = {}) {
  return names.map((name, i) => ({
    id: `crm-${i}`, email: emailOf(name), email_confirmed_at: '2026-01-01T00:00:00Z', banned_until: null, is_anonymous: false, ...extra,
  }));
}
const withCrm = Object.keys(BROKER_EMAIL_MAP).filter((name) => !MISSING_IN_CRM.includes(name));

function rowsFor(name, count, legacyId) {
  return Array.from({ length: count }, (_, i) => ({
    id: `ROA-${name}-${i}`, advisor_user_id: legacyId, advisor_email: emailOf(name),
  }));
}

describe('broker identity reconciliation', () => {
  it('reproduces the briefed picture: 13 approved brokers, 9 with CRM accounts, 4 without', () => {
    const result = reconcileBrokerIdentities({
      crmUsers: [
        ...crmUsersFor(withCrm),
        { id: 'crm-staff', email: 'accounts@hrsinsurance.co.za', email_confirmed_at: '2026-01-01T00:00:00Z' },
      ],
      roaRows: [
        ...rowsFor('Werner Joubert', 5, 'legacy-werner'),
        ...rowsFor('Timothy Simpson', 3, 'legacy-timothy'),
      ],
    });

    expect(result.summary).toMatchObject({
      directoryBrokers: 13,
      crmAccountsReady: 9,
      crmAccountsMissing: 4,
      crmAccountsOutsideDirectory: 1,
      submissionsTotal: 8,
      submissionsReachableAtCutover: 5,
      submissionsAwaitingCrmAccount: 3,
    });
    expect(result.accounts.missing.sort()).toEqual([...MISSING_IN_CRM].sort());
    expect(result.needsAttention).toBe(false); // missing accounts delay access; nothing is lost
  });

  it('matches case-insensitively and counts several historic ids for one broker', () => {
    const rows = [
      { id: 'a', advisor_user_id: 'legacy-1', advisor_email: 'WERNER@HRSInsurance.co.za' },
      { id: 'b', advisor_user_id: 'legacy-2', advisor_email: 'werner@hrsinsurance.co.za' },
    ];
    const result = reconcileBrokerIdentities({ crmUsers: crmUsersFor(withCrm), roaRows: rows });
    const werner = result.perBroker.find((b) => b.name === 'Werner Joubert');
    expect(werner).toMatchObject({ submissions: 2, distinctLegacyIds: 2, crmStatus: 'ready' });
    expect(result.needsAttention).toBe(false);
  });

  it('classifies unconfirmed, banned, anonymous and duplicate CRM accounts without guessing', () => {
    const now = Date.parse('2026-10-14T00:00:00Z');
    const users = [
      { id: 'u1', email: emailOf('Aedan Doubell'), email_confirmed_at: null },
      { id: 'u2', email: emailOf('Daniel Pottier'), email_confirmed_at: '2026-01-01', banned_until: '2026-12-01T00:00:00Z' },
      { id: 'u3', email: emailOf('Brian Hodges'), email_confirmed_at: '2026-01-01', is_anonymous: true },
      { id: 'u4', email: emailOf('Faizel Patel'), email_confirmed_at: '2026-01-01' },
      { id: 'u5', email: emailOf('Faizel Patel').toUpperCase(), email_confirmed_at: '2026-01-01' },
      { id: 'u6', email: emailOf('Steve Pickstock'), email_confirmed_at: '2026-01-01', banned_until: '2025-01-01T00:00:00Z' },
    ];
    const result = reconcileBrokerIdentities({ crmUsers: users, roaRows: [], now });

    expect(result.accounts.unconfirmed).toEqual(['Aedan Doubell']);
    expect(result.accounts.banned).toEqual(['Daniel Pottier']);
    expect(result.accounts.anonymous).toEqual(['Brian Hodges']);
    expect(result.accounts.duplicate).toEqual(['Faizel Patel']);
    expect(result.accounts.ready).toEqual(['Steve Pickstock']); // lapsed ban no longer blocks
    expect(result.needsAttention).toBe(true); // duplicates need a human decision
  });

  it('surfaces ownership exceptions instead of repairing them', () => {
    const rows = [
      ...rowsFor('Werner Joubert', 1, 'legacy-werner'),
      { id: 'foreign', advisor_user_id: 'legacy-x', advisor_email: 'someone.else@example.com' },
      { id: 'blank', advisor_user_id: 'legacy-y', advisor_email: '' },
      { id: 'nulled', advisor_user_id: 'legacy-z', advisor_email: null },
      // one historic id recorded under two different approved emails
      { id: 'amb1', advisor_user_id: 'legacy-dup', advisor_email: emailOf('Aedan Doubell') },
      { id: 'amb2', advisor_user_id: 'legacy-dup', advisor_email: emailOf('Daniel Pottier') },
      // a row stamped with a CRM user id whose email is someone else's
      { id: 'conflict', advisor_user_id: 'crm-0', advisor_email: emailOf('Werner Joubert') },
    ];
    const result = reconcileBrokerIdentities({ crmUsers: crmUsersFor(withCrm), roaRows: rows });

    expect(result.summary.submissionsWithForeignOwner).toBe(1);
    expect(result.summary.submissionsWithMalformedOwner).toBe(2);
    expect(result.exceptions.ambiguousLegacyIds).toHaveLength(1);
    expect(result.exceptions.idEmailConflicts.map((c) => c.rowId)).toEqual(['conflict']);
    expect(result.needsAttention).toBe(true);
  });

  it('flags a directory with duplicate or invalid mailboxes', () => {
    const result = reconcileBrokerIdentities({
      directory: { A: 'same@hrsinsurance.co.za', B: 'SAME@hrsinsurance.co.za', C: 'not an email' },
      crmUsers: [],
      roaRows: [],
    });
    expect(result.exceptions.directoryIssues.map((i) => i.issue).sort()).toEqual(['duplicate_email', 'invalid_email']);
    expect(result.summary.directoryBrokers).toBe(1);
    expect(result.needsAttention).toBe(true);
  });

  it('prints aggregates and masked third-party addresses only', () => {
    const report = formatReconciliation(reconcileBrokerIdentities({
      crmUsers: crmUsersFor(withCrm),
      roaRows: [{ id: 'foreign', advisor_user_id: 'legacy-x', advisor_email: 'private.person@example.com' }],
    }));
    expect(report).toContain('p***@example.com');
    expect(report).not.toContain('private.person');
    expect(report).toContain('Exceptions needing a decision');
    expect(maskEmail('jane.doe@x.co')).toBe('j***@x.co');
    expect(maskEmail('nonsense')).toBe('(unreadable)');
  });
});
