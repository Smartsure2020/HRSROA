// DocuSign auth-environment selection (Phase ROA-0.1).
//
// The base URI is no longer returned here — it now comes from DocuSign's
// UserInfo response, keyed by DOCUSIGN_ACCOUNT_ID. This module owns the
// OAuth / auth server choice only.
//
// A DOCUSIGN_BASE_URL escape hatch remains available for internal test
// harnesses; unset by default.

import { afterEach, describe, expect, it } from 'vitest';
import {
  DOCUSIGN_ENVIRONMENTS,
  getConfiguredBaseUrlOverride,
  getDocusignConfig,
} from '../api/_lib/docusignConfig.js';

const originalEnv = process.env.DOCUSIGN_ENVIRONMENT;
const originalBaseUrl = process.env.DOCUSIGN_BASE_URL;

afterEach(() => {
  if (originalEnv === undefined) delete process.env.DOCUSIGN_ENVIRONMENT;
  else process.env.DOCUSIGN_ENVIRONMENT = originalEnv;
  if (originalBaseUrl === undefined) delete process.env.DOCUSIGN_BASE_URL;
  else process.env.DOCUSIGN_BASE_URL = originalBaseUrl;
});

describe('getDocusignConfig — auth-server selection only', () => {
  it('advertises exactly two supported environments', () => {
    expect(DOCUSIGN_ENVIRONMENTS).toEqual(['sandbox', 'production']);
  });

  it('defaults to the sandbox auth server when DOCUSIGN_ENVIRONMENT is unset', () => {
    delete process.env.DOCUSIGN_ENVIRONMENT;
    expect(getDocusignConfig()).toEqual({
      environment: 'sandbox',
      authServer: 'account-d.docusign.com',
    });
  });

  it('resolves the production auth server when explicitly requested', () => {
    expect(getDocusignConfig('production')).toEqual({
      environment: 'production',
      authServer: 'account.docusign.com',
    });
  });

  it('accepts case-insensitive values', () => {
    expect(getDocusignConfig('SANDBOX').environment).toBe('sandbox');
    expect(getDocusignConfig('  Production  ').environment).toBe('production');
  });

  it('throws for an unsupported value — never silently falls back', () => {
    expect(() => getDocusignConfig('staging')).toThrow(/Unsupported DOCUSIGN_ENVIRONMENT/);
    expect(() => getDocusignConfig('')).toThrow(/Unsupported DOCUSIGN_ENVIRONMENT/);
    expect(() => getDocusignConfig('prod')).toThrow(/Unsupported DOCUSIGN_ENVIRONMENT/);
  });

  it('reads from process.env when no explicit override is passed', () => {
    process.env.DOCUSIGN_ENVIRONMENT = 'production';
    expect(getDocusignConfig().environment).toBe('production');
    process.env.DOCUSIGN_ENVIRONMENT = 'sandbox';
    expect(getDocusignConfig().environment).toBe('sandbox');
  });

  it('does not return a hard-coded baseUrl any more', () => {
    // baseUrl comes from account UserInfo now; the config object must not
    // silently re-introduce a shard-hardcoded field.
    const config = getDocusignConfig('production');
    expect(config).not.toHaveProperty('baseUrl');
  });
});

describe('getConfiguredBaseUrlOverride — DOCUSIGN_BASE_URL escape hatch', () => {
  it('returns null when the env var is unset', () => {
    delete process.env.DOCUSIGN_BASE_URL;
    expect(getConfiguredBaseUrlOverride()).toBeNull();
  });

  it('returns null when the env var is blank', () => {
    process.env.DOCUSIGN_BASE_URL = '   ';
    expect(getConfiguredBaseUrlOverride()).toBeNull();
  });

  it('returns the trimmed value when set', () => {
    process.env.DOCUSIGN_BASE_URL = '  https://internal-docusign-proxy.example/restapi  ';
    expect(getConfiguredBaseUrlOverride()).toBe('https://internal-docusign-proxy.example/restapi');
  });
});
