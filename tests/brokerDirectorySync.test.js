// Broker directory stays in one place (Phase ROA-0).
//
// hrsConstants.js used to hold BROKER_EMAIL_MAP directly. It now re-exports
// from src/lib/brokerDirectory.js so the serverless auth layer can share the
// same table without a duplicate risk. This test guarantees the re-export is
// still wired and that isHrsBrokerEmail is case-insensitive.

import { describe, expect, it } from 'vitest';
import {
  BROKER_EMAIL_MAP as DIR_MAP,
  EMAIL_TO_BROKER as DIR_EMAIL_TO_BROKER,
  DEFAULT_BROKER_EMAIL as DIR_DEFAULT,
  MANAGER_NAME as DIR_MANAGER,
  isHrsBrokerEmail,
} from '../src/lib/brokerDirectory.js';
import {
  BROKER_EMAIL_MAP as CONST_MAP,
  EMAIL_TO_BROKER as CONST_EMAIL_TO_BROKER,
  DEFAULT_BROKER_EMAIL as CONST_DEFAULT,
  MANAGER_NAME as CONST_MANAGER,
} from '../src/lib/hrsConstants.js';

describe('brokerDirectory ↔ hrsConstants re-exports', () => {
  it('hrsConstants.BROKER_EMAIL_MAP is the same object as brokerDirectory.BROKER_EMAIL_MAP', () => {
    expect(CONST_MAP).toBe(DIR_MAP);
  });

  it('hrsConstants.EMAIL_TO_BROKER is the same object as brokerDirectory.EMAIL_TO_BROKER', () => {
    expect(CONST_EMAIL_TO_BROKER).toBe(DIR_EMAIL_TO_BROKER);
  });

  it('DEFAULT_BROKER_EMAIL and MANAGER_NAME are re-exported', () => {
    expect(CONST_DEFAULT).toBe(DIR_DEFAULT);
    expect(CONST_MANAGER).toBe(DIR_MANAGER);
  });
});

describe('isHrsBrokerEmail', () => {
  it('is case-insensitive across the directory', () => {
    expect(isHrsBrokerEmail('andrew@hrsinsurance.co.za')).toBe(true);
    expect(isHrsBrokerEmail('ANDREW@HRSINSURANCE.CO.ZA')).toBe(true);
  });

  it('rejects a non-HRS email', () => {
    expect(isHrsBrokerEmail('stranger@example.com')).toBe(false);
  });

  it('rejects blanks, non-strings and undefined', () => {
    expect(isHrsBrokerEmail('')).toBe(false);
    expect(isHrsBrokerEmail(null)).toBe(false);
    expect(isHrsBrokerEmail(undefined)).toBe(false);
    expect(isHrsBrokerEmail(123)).toBe(false);
  });
});
