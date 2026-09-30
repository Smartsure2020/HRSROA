# CRM Pass 2 integration seam

The ROA evidence and e-signature lifecycle does not depend on CRM sync. CRM
failures remain visible and retryable, but non-blocking.

## Current browser-side calls

`src/lib/crmSync.js` currently sends the signed-in user's Supabase bearer token
directly from the browser to `https://crm.hrsinsurance.co.za/api`:

- `POST /clients-check-duplicate`
- `POST /clients?action=create`
- `POST /deals?action=create`

No Preview origin has been added to the live CRM CORS allow-list, and no CRM
service credential has been added to this repository or to Production.

## Replacement seam

Checklist screens import CRM operations from `src/lib/crmAdapter.js`. It
currently delegates to the legacy browser implementation so existing
Production behaviour is preserved. Pass 2 should replace that adapter with a
server-side HRSROA endpoint that:

1. authenticates the broker through the existing Supabase authority;
2. derives an idempotency key from the durable ROA submission ID;
3. keeps CRM credentials server-side;
4. writes only returned CRM IDs through the existing `attach-crm` endpoint or
   equivalent broker-owned repository operation; and
5. remains a soft failure that cannot block canonical evidence, signing, or
   evidence reconciliation.

Staging tests must use a non-production CRM tenant or a safe mock. Do not send
acceptance-test client data into the Production CRM.
