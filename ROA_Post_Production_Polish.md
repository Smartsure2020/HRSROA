# ROA post-production polish — rollout notes

Branch: `feat/roa-post-prod-polish` (HRSROA) + `feat/roa-crm-evidence-polish` (HRS CRM).
Strong identity matching (ID number / company registration only) is untouched.

## Deployment order (CRM first)

The CRM `roa-sync` schema is strict. An HRSROA build that sends `signingProvider` /
`evidence.auditLog` to an un-updated CRM is rejected with `invalid_payload`, so:

1. **CRM**: apply `supabase/migrations/020_add_roa_audit_log_evidence.sql` (staging, then production).
2. **CRM**: deploy the branch. Old HRSROA payloads (two documents, no `signingProvider`) keep working.
3. **HRSROA**: apply `supabase/migrations/20261005_crm_audit_log_document.sql`.
4. **HRSROA**: deploy the branch.

No secrets, Supabase URLs or env vars change for items 1–5.

## Item 4 — why no checklist / combined PDF is synced to the CRM

The "ROA + Checklist" download is `generateCombinedPDF` / `generateCommercialCombinedPDF`. It is
generated **in the browser** at click time from live wizard data plus the on-screen checklist
state (commissions, tracking dates, comments). It is not stored server-side, has no hash, is not
stamped with the submission id and can differ on every download, so it is not an authoritative
artefact. Its ROA half is the unsigned draft that the stored **signed ROA** already supersedes.
The CRM therefore receives only the authoritative stored artefacts: signed ROA, certificate and
(Documenso) audit log. To get the checklist into the CRM, it must first be persisted
server-side as a frozen, hashed artefact (new storage + columns); that was out of scope here.

## Item 6 — signing-email sender is provider configuration (no code change)

The HRSROA payload already sets `meta.emailReplyTo` to the broker on envelope create and
distribute, and the subject/body (now built server-side) name the inviting broker. It does not
and must not set the From identity. The visible sender display name/address is controlled by
the **Documenso deployment**:

| What | Where | Production value |
| --- | --- | --- |
| From display name | `NEXT_PRIVATE_SMTP_FROM_NAME` on the Documenso instance | `HRS Record of Advice` (or `HRS Insurance`) |
| From address | `NEXT_PRIVATE_SMTP_FROM_ADDRESS` on the Documenso instance | a mailbox on an HRS domain whose SPF/DKIM/DMARC are aligned with the SMTP provider |

Notes:

- Self-hosted Documenso only; restart/redeploy the Documenso instance after changing them.
  The address must be authorised by the SMTP provider or delivery fails.
- Hosted Documenso: a custom sender requires an organisation Email Domain (Enterprise) and the
  per-envelope `meta.emailId`; without it the sender is Documenso's default. Not used here.
- If "HRS ROA Staging" appears only in the email **body** (not the `From:` header), it is the
  Documenso organisation/team name — rename it under Organisation/Team settings. Check the raw
  `From:` header of a test email to tell the two apart.
- The production Documenso instance must not reuse the staging SMTP/branding variables.
- Individual broker From addresses are intentionally not used (SPF/DKIM/DMARC alignment).

## Other notes

- Reminders use Documenso v2 `POST /envelope/redistribute` (`envelopeId`, `recipients: [ids]`),
  limited to the client recipient while the envelope is `PENDING`, with a 5-minute per-submission
  cooldown stored in `signing_meta` (no migration).
- Existing CRM documents keep their old UUID names; only newly filed documents use the clean
  names. Rows linked before audit logs were synced can be backfilled with **Retry CRM sync** in
  the ROA register (idempotent: nothing is duplicated).
- Vercel function count rises by one (`api/roa-submissions/send-reminder.js`): 12 functions in
  total, which is the Hobby-plan ceiling.
