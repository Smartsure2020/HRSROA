// DocuSign environment selection (Phase ROA-0).
//
// Verifies the explicit-config replacement for the old comment/uncomment
// switch: sandbox is the safe default when the env var is missing, an
// explicit "production" resolves to production endpoints, and anything else
// throws so a deploy fails loudly rather than silently defaulting.

import { afterEach, describe, expect, it } from 'vitest';
import { DOCUSIGN_ENVIRONMENTS, getDocusignConfig } from '../api/_lib/docusignConfig.js';

const originalEnv = process.env.DOCUSIGN_ENVIRONMENT;

afterEach(() => {
  if (originalEnv === undefined) delete process.env.DOCUSIGN_ENVIRONMENT;
  else process.env.DOCUSIGN_ENVIRONMENT = originalEnv;
});

describe('getDocusignConfig', () => {
  it('advertises exactly two supported environments', () => {
    expect(DOCUSIGN_ENVIRONMENTS).toEqual(['sandbox', 'production']);
  });

  it('defaults to sandbox when DOCUSIGN_ENVIRONMENT is unset', () => {
    delete process.env.DOCUSIGN_ENVIRONMENT;
    const config = getDocusignConfig();
    expect(config).toEqual({
      environment: 'sandbox',
      authServer: 'account-d.docusign.com',
      baseUrl: 'https://demo.docusign.net/restapi',
    });
  });

  it('resolves production endpoints when explicitly requested', () => {
    const config = getDocusignConfig('production');
    expect(config).toEqual({
      environment: 'production',
      authServer: 'account.docusign.com',
      baseUrl: 'https://na4.docusign.net/restapi',
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
});
