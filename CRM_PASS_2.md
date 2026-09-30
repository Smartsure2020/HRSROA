# CRM Pass 2 integration seam

The ROA evidence and e-signature lifecycle does not depend on CRM sync. CRM
failures remain visible and retryable, but non-blocking.

## Implemented boundary

The browser now sends only the HRSROA submission ID to the broker-authenticated
`POST /api/roa-submissions/sync-crm` endpoint. Frozen client data and verified
evidence bytes are loaded by the HRSROA server. No CRM URL, CRM credential, or
browser-supplied CRM record ID is used by the checklist flow.

HRSROA requires these server-only variables (never prefix them with `VITE_`):

- `CRM_BASE_URL`: the CRM deployment origin, without `/api`
- `CRM_INTEGRATION_SECRET`: a random value of at least 32 characters

Set the identical secret in CRM as `HRS_ROA_INTEGRATION_SECRET`. CRM also
requires its existing Supabase service-role and private Vercel Blob settings.

## Safe staging order

1. Apply CRM migration `018_add_roa_integration_receipts.sql`.
2. Deploy CRM with `HRS_ROA_INTEGRATION_SECRET`, then verify unauthorized and
   authorized endpoint behavior using a non-production test submission.
3. Apply HRSROA migration `20260930_crm_integration.sql`.
4. Deploy HRSROA with `CRM_BASE_URL` and `CRM_INTEGRATION_SECRET`.
5. Submit and sign a staging ROA, then verify the linked client, one deal, and
   the two private CRM document rows before enabling production traffic.

Staging tests must use a non-production CRM tenant or a safe mock. Do not send
acceptance-test client data into the Production CRM.
