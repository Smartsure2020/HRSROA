# ROA follow-up signing: staging handoff

## Workflow

On a completed, evidenced ROA revision, the broker chooses a policy schedule or Banking Details Confirmation. A schedule is previewed page by page and the broker places the signature box. HRS stores the exact uploaded PDF in the private `roa-pdfs` bucket, freezes the signer from the signed ROA, and creates a separate request. The broker reviews the resolved name and email before sending. Each request has its own UUID, provider external ID, status, reminder history and evidence paths. The original ROA row and files are not changed.

The banking PDF is generated on the server and contains text/dropdown fields and a signature. Account number and branch code are text, preserving leading zeroes. The collection date dropdown has exactly 1st, 5th, 7th, 15th and 25th. There is no amount or new debit authority.

Documenso API v2 has a post-signing redirect. The client signs in Documenso, then arrives at an HRS proof page with an optional private PDF/JPG/PNG upload. This uses the same invitation and no HRS account. The redirect carries a random proof token in the URL fragment; only its SHA-256 is stored. The upload endpoint requires both that token and a signed recipient with the frozen email in the correct Documenso envelope. Proof status changes only after private storage succeeds. A failed upload can be retried or skipped. The proof step currently follows signing, so the requested **upload then continue to signing** order is not achieved by this API flow. Confirm the post-signing redirect behaviour in staging before release.

## Staging order and configuration

1. Apply CRM migration `028_roa_followup_receipts.sql` to staging. Deploy the matching CRM branch. It stores follow-up metadata and content-addressed evidence separately from original ROA documents. The existing CRM integration secret and private Blob token are reused.
2. Apply HRS migration `20261127092302_roa_followup_signing.sql` to staging. Deploy the HRS branch. Keep the `roa-pdfs` bucket private. The existing Documenso and CRM server credentials are reused.
3. Set `HRS_ROA_PUBLIC_URL` to the public **staging** HRS origin. It is needed for the proof redirect. Do not use a production URL for a staging request.
4. Use synthetic broker/client/ROA and schedule documents. Verify recipient, signature page and position, dropdown values, signed PDF, certificate, audit log, proof upload and broker-only download. Test a failed proof upload and a CRM outage/retry. Verify both original ROA and follow-up evidence remain intact.

The code calls `/api/v2/envelope/*`; the actual deployed Documenso application build is not recorded in this repository or local configuration. Its signer-upload field capability and redirect behaviour require a staging check. The implementation uses the HRS proof flow because the published v2 fields API does not document a signer file-upload field. The schedule and CRM sync transport currently send base64 content through server routes; exercise the deployment's request-size limit with a representative insurer PDF before enabling this for real clients.

No production migration, deployment, secret change or real invitation is part of these branches.
