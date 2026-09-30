// HRSROA CRM integration seam.
//
// The current implementation is the legacy browser adapter. Callers import
// only from this module so Pass 2 can replace it with an authenticated
// server-side submission adapter without changing checklist workflow code.
// CRM remains best-effort and never gates ROA evidence or e-signature.
export {
  syncPersonalROAToCRM,
  syncCommercialROAToCRM,
} from './crmSync';

export const CRM_ADAPTER_MODE = 'browser_legacy';
