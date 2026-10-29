# Amend ROA — design, deployment order and staging acceptance (Issue #8)

Status: **draft PR, not merged, not deployed, nothing applied to any database.**
Production needs a separate, explicit approval (see §6).

This document is the reviewer's map. §1–§3 say what was built and where each invariant is
enforced; §4 is the CRM contract the CRM team must meet before revisions are filed there;
§5–§6 are the migration, deployment order and rollback; §7 is the exact staging acceptance
script; §8 lists what is *not* proven by the automated tests.

## 1. Behaviour

My ROAs → detail → **Amend ROA** → mandatory reason (Incorrect contact details / Incorrect
email / Spelling correction / Change in cover or recommendation / Client information changed /
Other — "Other" needs a note) → the existing Personal or Commercial wizard opens pre-populated
from the owner's frozen source snapshot (never from a PDF, never with signature data) →
normal validation → a **new** canonical PDF is generated and submitted as the next revision →
the revision is sent through the normal Documenso client-then-adviser flow.

- A revision is a new row: its own `ROA-<uuid>`, canonical SHA-256, Documenso `externalId`,
  signing lifecycle and CRM evidence. Nothing about an earlier revision is edited.
- Only the **head** of a chain can be amended (linear chain: Rev 1 → Rev 2 → Rev 3 …).
- All seven statuses are amendable (`submitted`, `awaiting_signature`, `signature_failed`,
  `completed`, `declined`, `voided`, `expired`); the status decides what *sending* must do,
  not whether the broker may edit.
- **Opening or even submitting the editor never touches a live signing request** (abandoned
  edit safety). Cancellation happens only at the first attempt to *send the replacement*.
- A revision's signed state is shown separately from lineage: a signed Rev 1 stays "Last
  signed" while Rev 2 awaits signature; every revision's evidence stays downloadable.

## 2. Where each invariant is enforced

| Invariant (Issue #8) | Enforcement | Proven by |
|---|---|---|
| Never mutate an existing submission's snapshot, canonical PDF/hash, signed PDF, certificate, audit log, original signing timestamps | Column-level `UPDATE` grants (unchanged); the **only** new updatable column is `superseded_by_submission_id`; DB trigger makes signed evidence + `completed_at` **write-once**; revision metadata immutable | `tests/amendmentSql.test.js` (real Postgres), `tests/amendmentEndpoints.test.js` (row + storage byte-for-byte) |
| New `ROA-<uuid>`, hash, externalId, lifecycle per revision | Client mints the id; `create` stores a new canonical object at `<id>/canonical.pdf` | endpoint tests |
| Linear chain, unique successor, CAS / transactional creation, safe retry | `roa_create_revision()` (one transaction, `FOR UPDATE` on the predecessor) + unique indexes on `supersedes_submission_id`, `superseded_by_submission_id`, `(parent_submission_id, revision_no)` + insert/update guard triggers | SQL tests; two-tab / double-click / lost-response tests |
| `amended_by` derived from the authenticated broker; `amended_at` server timestamp | Never read from the request; DB `now()` | "derives revision metadata on the server" test |
| Amendment snapshot not exposed by normal list/get; owner-only, no-store | Only `GET get?id=…&view=amendment`, owner-scoped, `Cache-Control: private, no-store`, head-only, never logged | endpoint + contract tests |
| Documenso cancellation safe, idempotent, fail-closed; never two live requests | `api/_lib/supersession.js` (§3) wired into `send-for-signature` before any envelope is reserved/created/distributed | the "replacement gate" block of `tests/amendmentEndpoints.test.js` (mutation-checked, see §9) |
| Broker-level authorisation, CRM Auth, email ownership, server-only evidence access | Every new read/write goes through `loadSubmissionForBroker` / owner-filtered CAS updates; browser roles have no table or function privileges | isolation tests, SQL privilege tests |
| Hobby 12-function ceiling | No new `api/**/*.js`: `get.js` (`view=amendment`), `create.js` (`amendment` body), `send-for-signature.js` (gate) | `tests/amendmentContracts.test.js` |

## 3. Replacement gate (the safety-critical part)

`send-for-signature` for a revision that `supersedes` another calls
`resolvePredecessorForReplacement()` **before** any provider call for the replacement. It
fails closed; the replacement stays `submitted` unless the predecessor is *verified* not live.

| Predecessor state | Result |
|---|---|
| `completed` / `declined` / `voided` / `expired` | nothing live → send proceeds (a signed predecessor is left exactly as is) |
| `submitted` / `signature_failed`, no envelope | never sent → proceeds |
| `awaiting_signature`, no envelope id yet | recent reservation → blocked (`predecessor_send_in_progress`); stale → look up by `externalId`: none → release reservation; found → adopt then cancel |
| live Documenso envelope, provider says `COMPLETED` | **abort**: reconcile it as the signed record (evidence retrieved), nothing cancelled, this send blocked once (`predecessor_completed`); the retry passes |
| `REJECTED` / `CANCELLED` | recorded as `declined` / `voided`, send proceeds |
| `PENDING` / `DRAFT` | persist **intent** → best-effort copy of the audit log if anyone has signed → `POST /envelope/delete` → **re-read the envelope** → 404 or `CANCELLED` = verified → compare-and-swap row to `voided` → send proceeds |
| 404 on the first read | only accepted as "cancelled" if **our own persisted intent** says we asked; otherwise `predecessor_unverifiable` |
| any provider error / ambiguity / delete "succeeds" but envelope still live / cannot re-read | blocked (`predecessor_cancel_unverified` 503, `…_rejected` 502, `…_status_unavailable` 503); safe to retry |
| live legacy DocuSign envelope | blocked — this app cannot cancel DocuSign; void it there, refresh, retry |

Double click / two tabs: both requests may run the gate; the intent marker, the 404-after-intent
rule and the CAS make them converge, and `reserveSigningSlot` lets exactly one create an envelope.

**Documenso API contract used.** Documenso v2 has no separate cancel call: the vendor's
migration guide maps the old document delete to `POST /api/v2/envelope/delete`, and the
vendor's user documentation says deleting a **pending** document is a hard delete, voids
signatures and notifies recipients. The envelope status enum includes `CANCELLED`; recipient
`signingStatus` is `NOT_SIGNED | SIGNED | REJECTED`. The request body shape (`{ envelopeId }`)
and the post-delete behaviour of `GET /envelope/:id` were **not confirmed against the deployed
instance** — hence verification by re-read, and §7 step B/C/G which characterise it on staging.

## 4. CRM contract — separate CRM change required (not done in this PR)

`POST /api/integrations/roa-sync` validates with a **strict** schema, so any new top-level
field is rejected with `422 invalid_payload`. HRSROA therefore sends revision metadata only
when `CRM_REVISION_METADATA=enabled`; until then amended revisions are **deferred** (no CRM
call, no sync state written, no error shown — the register explains it). Revision 1 / legacy
rows are unaffected.

When enabled, a revision's payload is the existing payload plus:

```json
"revision": {
  "revisionNo": 2,
  "parentSubmissionId": "ROA-…",
  "supersedesSubmissionId": "ROA-…",
  "amendmentReason": "incorrect_email",
  "amendedAt": "2026-10-29T10:00:00.000Z"
}
```

(`submissionId` is the revision's own id; evidence is the revision's own signed ROA +
certificate + audit log; the free-text note is never sent.) The CRM change must:

1. accept `revision` as optional, still rejecting unknown fields;
2. keep client matching on **ID number / company registration only** (never email, never
   revision data) and the `client_owned_by_another_broker` / `ambiguous_client_match` guards;
3. for `revisionNo > 1`, **reuse the deal** created for the parent chain (look up the receipt of
   `supersedesSubmissionId`) instead of creating another `lead_received` deal — without this
   every revision duplicates the deal;
4. file the revision's evidence as **new** documents (tags include the revision's
   `submissionId`; names carry "(Revision N)") and never rename, replace or delete documents
   filed for earlier revisions;
5. stay idempotent per `submissionId` (the existing receipt model already is).

Deploy the CRM first (its migration, then code), verify on its staging, then set
`CRM_REVISION_METADATA=enabled` in HRSROA and redeploy.

## 5. Migration

`supabase/migrations/20261029_roa_amendments.sql` — additive; applies cleanly after the four
existing migrations and is idempotent (verified by executing all five against Postgres in
`tests/amendmentSql.test.js`).

- 8 nullable/defaulted columns (`revision_no default 1` makes every legacy row revision 1);
  `amendment_reason_detail` is the one column beyond the issue's list (the note "Other"
  requires).
- Foreign keys, shape/reason/note `CHECK`s, three unique indexes.
- Two guard triggers and `roa_create_revision()` (SECURITY INVOKER, pinned `search_path`,
  `EXECUTE` revoked from `public/anon/authenticated`, granted to `service_role` only).
- One new privilege: `grant update (superseded_by_submission_id) … to service_role`. No
  `DELETE`, nothing to browser roles.
- **Behaviour change for existing columns:** signed-evidence columns and `completed_at` become
  write-once (idempotent re-writes of the same value are allowed). Existing code only ever
  fills them in once; a manual repair by SQL would need the trigger disabled deliberately.

Rollback (only if no revision ≥ 2 exists) is in the file header. The previous application
build keeps working against the migrated schema, so **code can be rolled back without
touching the database.**

## 6. Deployment order (production — only after explicit approval; nothing here has been run)

1. Staging: apply the migration, deploy the branch preview, run §7. Record the Documenso
   findings (§7-B/C/G) in the PR before anything else.
2. CRM team: ship the §4 change to CRM staging, verify, then CRM production. (Optional for
   HRSROA go-live: revisions simply stay unfiled in the CRM until step 6.)
3. Production DB: take a snapshot/PITR marker, apply the migration, run the §7-L invariant
   queries (all return 0 rows) and confirm legacy rows read as revision 1.
4. Deploy the HRSROA build. **Migration first, code second** — the new build selects the new
   columns, so the reverse order breaks the register with a loud `list_failed`.
5. Smoke: sign in, open My ROAs, open a legacy ROA (shows no revision UI), download its
   evidence. Amend a *test* ROA only.
6. After the CRM release is live: set `CRM_REVISION_METADATA=enabled`, redeploy, confirm a
   completed revision files three new CRM documents and no duplicate deal.

Rollback: revert the deployment (database stays as is). Disable CRM filing of revisions by
unsetting `CRM_REVISION_METADATA` and redeploying. No existing secret changes anywhere.

New environment variable (not a secret): `CRM_REVISION_METADATA` — see `.env.example`.
Preview deployments for a new branch have **no** environment variables until they are added
(branch-scoped) — provision the staging set before §7.

## 7. Staging acceptance script

Prerequisites (all **staging only** — never the production Supabase project, Documenso account
or CRM): a staging ROA Supabase project with the migration applied; a branch preview with the
staging variable set (`AUTH_*`/`VITE_AUTH_*`, `ROA_SUPABASE_*`, `ROA_SIGNING_PROVIDER=documenso`,
`DOCUMENSO_BASE_URL`/`DOCUMENSO_API_TOKEN` of a Documenso **sandbox**, staging CRM variables);
one authorised test broker; a second authorised test broker; two inboxes you control (client,
adviser). Use synthetic client data only. For each step note Documenso state (envelope
status in its UI), the register, and the SQL query in L.

**A. Not sent.** Submit a Personal ROA, do not send. Amend (reason: Incorrect email, change the
email), submit. Expect Rev 2; Rev 1 reads *Not sent* + *Superseded* and has no Send button;
`POST send-for-signature` for Rev 1 → 409 `submission_superseded`. Send Rev 2 → one envelope
in Documenso, none for Rev 1. Repeat once with a **Commercial** ROA.

**B. Live pending envelope (the key test).** Submit + send a Personal ROA; confirm the envelope
is `PENDING`. Click Amend ROA: the page warns the request stays live. Close the editor
without submitting → envelope still `PENDING`. Amend again and **submit** Rev 2 → Rev 1's
envelope still `PENDING`, Rev 1 still *Awaiting signature*. Now **Send** Rev 2. Expect: Rev 1's
envelope gone/cancelled in Documenso, Rev 1 `voided` with `signing_meta.supersession`
(`cancelRequestedAt`, `cancelledAt`, `verifiedBy`), exactly one live envelope (Rev 2's),
recipients' emails as Documenso sends them. **Record** what `GET /envelope/<old id>` returns
afterwards (404 vs `CANCELLED`) and whether the old envelope/audit log is still visible.

**C. Partially signed.** As B, but the client signs Rev 1 before you amend/send Rev 2.
Expect the same, plus a stored copy at `<rev1>/superseded-audit-log.pdf` whose SHA-256 equals
`signing_meta.supersession.auditLog.sha256` (if capture failed, `captured:false` is recorded —
note whether Documenso serves an audit log for a pending envelope).

**D. Completed → amend.** Fully sign a Rev 1 (client, then adviser) and let evidence retrieve.
Record the SHA-256 of its signed PDF, certificate, audit log and canonical (download or SQL).
Amend → Rev 2 → send → sign. Expect Rev 1's four documents byte-identical afterwards; while
Rev 2 awaits signature the register shows Rev 1 as *Last signed* and Rev 2 as the replacement;
after signing, Rev 2 is *Last signed* and Rev 1 stays *Signed · Superseded*.

**E. Declined / voided / expired / failed.** Decline Rev 1 as the client → amend → send Rev 2:
no cancellation attempted. Void one in Documenso and let the register refresh → amend → send.
For *expired* and *signature_failed* (hard to provoke) set the status on a **staging test row**
with SQL, then amend + send.

**F. Legacy DocuSign.** If any staging row has a live DocuSign envelope: Amend is refused with
the manual-void message; after voiding it in DocuSign and refreshing, Amend works.

**G. Late completion.** With Rev 1 pending and Rev 2 submitted-but-unsent, fully sign Rev 1 in
Documenso, then click Send on Rev 2. Expect a refusal ("signed while you were amending"), Rev 1
now *Signed* with all three evidence files, nothing cancelled; click Send again → Rev 2 is
sent. Then characterise the tightest race on the sandbox with the API (token placeholder):
create + complete an envelope, call `POST …/api/v2/envelope/delete {"envelopeId": …}`, then
`GET …/api/v2/envelope/<id>` — record whether a completed-then-deleted envelope is distinguishable
from a cancelled one. (If it is **not**, see §8 risk 2.)

**H. Provider failure.** On the preview only, set an invalid `DOCUMENSO_API_TOKEN`, redeploy,
and Send a replacement whose Rev 1 is pending → refused (`predecessor_status_unavailable`),
Rev 1 untouched, no new envelope. Restore the token → the same Send succeeds.

**I. Concurrency.** (1) Open the same head in two browser tabs, Amend in both, submit within a
second of each other → exactly one revision; the other shows "A newer revision … already
exists". (2) Double-click Send on a replacement → one envelope. (3) In two SQL sessions on
staging: session 1 `begin; select * from public.roa_create_revision(<args>);` (do not commit);
session 2 the same predecessor with another new id → blocks, then after session 1 commits fails
with `RA006`.

**J. Broker isolation.** With the second broker's token: `GET get?id=<first broker's id>&view=amendment`
→ 404; `POST create` with `amendment.supersedesSubmissionId` of the first broker's ROA → 404
`predecessor_not_found`; `POST send-for-signature` for the first broker's revision → 404. An
authenticated user not in the directory → 403 everywhere.

**K. CRM.** With `CRM_REVISION_METADATA` unset: Rev 1 files as before; Rev 2 shows the neutral
"not switched on yet" message and the CRM has no trace of it. After the CRM change is on CRM
staging and the flag is enabled: Rev 2 completed → three **new** documents under the same
client, the same deal (no duplicate), Rev 1's documents untouched; *Retry CRM sync* is a no-op.

**L. Database invariants (read-only; every query must return 0 rows).**

```sql
-- at most one successor per revision
select supersedes_submission_id from public.roa_submissions
where supersedes_submission_id is not null group by 1 having count(*) > 1;
-- forward link must mirror the backward link
select p.id from public.roa_submissions p join public.roa_submissions s on s.supersedes_submission_id = p.id
where p.superseded_by_submission_id is distinct from s.id;
select a.id from public.roa_submissions a join public.roa_submissions b on b.id = a.superseded_by_submission_id
where b.supersedes_submission_id is distinct from a.id;
-- numbering and rooting
select s.id from public.roa_submissions s join public.roa_submissions p on p.id = s.supersedes_submission_id
where s.revision_no <> p.revision_no + 1 or s.parent_submission_id is distinct from coalesce(p.parent_submission_id, p.id)
   or lower(s.advisor_email) <> lower(p.advisor_email) or s.roa_type <> p.roa_type;
-- more than one live signing request in a chain
select coalesce(parent_submission_id, id) as chain from public.roa_submissions
where status = 'awaiting_signature' and signing_envelope_id is not null group by 1 having count(*) > 1;
```

Chain view for any ROA: `select id, revision_no, status, signing_status, superseded_by_submission_id,
pdf_sha256, signed_pdf_sha256 from public.roa_submissions where coalesce(parent_submission_id, id) = '<root>' order by revision_no;`

**M. Timing and rollback drill.** In Vercel logs note the duration of the Send in step B (the
cancel path adds ~6 provider calls; Hobby's default function limit is 10 s — if close, set a
`maxDuration` for that route). Then redeploy the previous build against the migrated staging
database: the register, evidence downloads and sending must still work.

## 8. What the automated tests do **not** prove

1. **Live Documenso behaviour.** The fake models the documented contract. Whether delete of a
   pending envelope keeps an audit trail, what `GET` returns afterwards, and what an already
   completed envelope does when deleted are unconfirmed (§7-B/C/G).
2. **Delete racing a completion.** If Documenso soft-deletes a just-completed envelope and then
   answers 404, a completion in the few milliseconds between our last read and the delete would
   be indistinguishable from a cancellation. Probability is tiny (the final signer is the
   broker who is performing the amendment) but not zero; step G tells us whether it is real.
3. **True parallel transactions.** The SQL tests run on a single connection; the lock +
   unique-index guarantees are exercised individually, real parallelism is §7-I.
4. **Recipient communication.** Per the vendor's docs, deleting a pending envelope notifies the
   recipients; the client will receive a cancellation notice and the new request. Confirm that
   is acceptable to the business.
5. **The UI against the real API.** It was exercised in a real browser (both wizards through
   submit, the register lineage panel, the reason step, the blocked states, console clean) with
   only authentication and the API client stubbed. No staging or production system was touched.
6. **CRM behaviour** — the CRM change in §4 is specified, not built.

## 9. Test inventory

`npm test` (41 files, 601 tests at the time of writing), `npm run lint`, `npm run build`.
New suites: `amendmentEndpoints` (creation, retries, owner-only read, gate — 65), `amendmentSql`
(real Postgres — 28; dev dependency `@electric-sql/pglite`), `amendmentRules` (56),
`amendmentCrm` (10), `amendmentContracts` (19). The gate tests were mutation-checked: disabling
the gate fails 20, skipping re-verification fails 3, accepting any 404 fails 1.
