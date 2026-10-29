# Amend ROA — design, deployment order and staging acceptance (Issue #8)

Status: **draft PR, not merged, not deployed, nothing applied to any database.**
Production needs a separate, explicit approval (see §6).

This document is the reviewer's map. §1–§3 say what was built and where each invariant is
enforced; §4 is the CRM contract the CRM team must meet before revisions are filed there;
§5–§6 are the migrations, deployment order and rollback; §7 is the exact staging acceptance
script; §8 lists what is *not* proven by the automated tests; §10 is the operator runbook for
the "manual resolution" state.

**Safety remediation (second pass).** A review of the first commit found three ways the
cancellation could act on stale or unprovable information. All three are fixed on this branch;
the revision architecture, the first migration and the CRM behaviour are unchanged.

| # | Finding | Fix | Where |
|---|---|---|---|
| R1 | `refreshViaDocumenso()` and `recordProviderTerminal()` wrote a provider observation with an **unconditional, id-only** update. A read taken a moment earlier could overwrite a ROA that completed in between (status, `signing_status`, or both). | Every provider-observation and supersession write is now **broker-scoped and conditional** on the row's *current* lifecycle: an observation that is not "completed" applies only while the row is open **and** `completed_at` is empty; the void is a compare-and-swap on status + `completed_at` + the forward link. A lost race matches nothing and the current (completed) record stands. The legacy DocuSign reconcile follows the same rule. A second, independent backstop in the database (§5, migration 2) refuses to move a completed record out of `completed`. | `submissionRepo.applyProviderObservation`, `markSupersededVoided`, `recordSupersessionState`, `adoptRecoveredEnvelope`, `setCompletionIfMissing`; `documensoSigning.refreshViaDocumenso`; `signingReconciliation`; `20261030_…sql` |
| R2 | The audit-log copy of a partially signed request was **best effort**: if it failed, the envelope was deleted anyway and the signed recipient's audit trail could be lost. | **Fail closed.** If anyone may have signed, the provider's audit log is downloaded, stored, **read back and hash-verified** *before* any delete is sent, and the copy is tied to the exact signing progress it covers. If that cannot be done the request is left exactly as it is: retryable first (`predecessor_audit_backup_failed`), then — after 3 failures, or at once for a permanent 4xx — the explicit **manual-resolution** state (§3, §10). Unreadable or unrecognised recipient progress counts as "possibly signed". | `supersession.preserveAuditTrail` |
| R3 | Our **intent** to cancel was persisted *before* the delete was sent, and a later 404 was accepted as "we cancelled it" because of that intent. If the process died in the gap and someone else removed (or completed and removed) the envelope, we would void a record on no evidence. | A 404 is now proof **only if the provider acknowledged our own delete** (a 2xx, persisted as `deleteAcknowledgedAt`) for the replacement that really supersedes the row. The intent is a diagnostic marker, never evidence. The delete is also preceded by a **fresh** re-read and a persisted *dispatch* marker, so it acts on a current observation. Everything else with a 404 is a retryable wait (a concurrent request may still be acknowledging) or manual resolution. | `supersession.runCancellation`, `settleMissingEnvelope`, `documensoSigning.providerAcknowledgedOurDelete` |

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
| Documenso cancellation safe, idempotent, fail-closed; never two live requests | `api/_lib/supersession.js` (§3) wired into `send-for-signature` before any envelope is reserved/created/distributed | the "replacement gate" block of `tests/amendmentEndpoints.test.js` and `tests/amendmentRaces.test.js` (mutation-checked, see §9) |
| A completed ROA stays completed — no stale observation or cancellation can overwrite it | Broker-scoped, **conditional** writes (open status **and** empty `completed_at`) for every observation / void / supersession step; DB trigger `roa_submissions_guard_completed_status` (migration 2) as an independent backstop | `tests/amendmentRaces.test.js` R1 (deterministic interleavings), `tests/amendmentSql.test.js` (real Postgres) |
| A signed recipient never loses the audit trail to a failed backup | Verified (stored + read back + hashed) copy **before** any delete; otherwise retry → manual resolution | `tests/amendmentRaces.test.js` R2 |
| A provider 404 is never taken as proof of our own cancellation without provider confirmation | Only a persisted 2xx acknowledgement of our delete counts; otherwise wait or manual resolution | `tests/amendmentRaces.test.js` R3 |
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
| `REJECTED` / `CANCELLED` | recorded as `declined` / `voided` with a **conditional** write (if the row completed meanwhile it matches nothing and the completed record wins), send proceeds |
| `PENDING` / `DRAFT` | the cancellation state machine below |
| 404 on the first read | proof only if the provider **acknowledged our own delete** (persisted `deleteAcknowledgedAt` for this replacement) → finalise; a delete dispatched <60 s ago → `predecessor_cancel_unverified` (retry); anything else → **manual resolution** |
| any provider error / ambiguity / delete "succeeds" but envelope still live / cannot re-read | blocked (`predecessor_cancel_unverified` 503, `…_rejected` 502, `…_status_unavailable` 503); safe to retry |
| partially signed and the audit log cannot be preserved | **nothing deleted**; `predecessor_audit_backup_failed` 503 (retry), then **manual resolution** |
| live legacy DocuSign envelope | blocked — this app cannot cancel DocuSign; void it there, refresh, retry |

**Cancellation state machine** (`runCancellation`; every step is persisted in
`signing_meta.supersession` with a conditional, broker-scoped write — if the row has completed
or otherwise moved on, the write matches nothing and the gate ends with the row's *current*
state, never overwriting it):

1. **Intent** — `cancelRequestedAt`, `replacementId`, observed status, recipient progress
   (order/role/state only, no personal data). A marker for diagnosis; *not* evidence about the provider.
2. **Evidence** — if anyone may have signed: download the provider audit log, check it is a
   PDF, store it at the content-addressed path `<rev>/superseded-audit-log-<sha256[0:16]>.pdf`,
   **read it back and compare the hash**, then persist `auditLog { path, sha256, byteLength,
   signedKey, verifiedAt }`. `signedKey` names *which* signatures the copy covers. Failure →
   stop (nothing deleted). Never overwrites an existing object.
3. **Fresh read** immediately before the delete (the backup can take seconds). `COMPLETED` →
   abort, keep as the signed record; `REJECTED`/`CANCELLED` → record; 404 → no delete was ever
   sent, nothing of ours to credit; if more people have signed than the copy covers →
   `predecessor_changed` (retry re-takes the copy).
4. **Dispatch** — persist `deleteDispatchedAt`, then `POST /envelope/delete`.
5. **Acknowledgement** — on a 2xx persist `deleteAcknowledgedAt` at once. A 4xx/5xx/network
   error or a 404 *is not* an acknowledgement.
6. **Verify** by re-reading: still live → blocked; `COMPLETED` → abort; explicit `CANCELLED`, or
   404 **after an acknowledged delete** → verified. A 404 without our acknowledgement (reply
   lost, error response, or someone else's deletion) is *not* verified: if a concurrent request
   of ours has recorded the acknowledgement we follow it, otherwise `predecessor_cancel_unverified`.
7. **Void** — compare-and-swap `status → voided` only while the row is open, `completed_at` is
   empty and `superseded_by_submission_id` is this replacement; then the send proceeds.

**Manual resolution** (`predecessor_manual_resolution_required`, HTTP 409, `retryable:false`)
is the single explicit end state for "automation cannot prove this is safe". The request is
left exactly as it is, the replacement is **not** sent, the row is flagged
(`signing_meta.supersession.manualResolution { required, reason, flaggedAt }`), the broker sees
a plain-language alert on the stuck request in My ROAs and in the send refusal, and a person
follows §10. Reasons: `audit_backup_unavailable` (signed, and the trail could not be
preserved), `envelope_missing_unexplained` (the provider has no such envelope and we never
asked), `delete_not_dispatched` (we recorded intent but the envelope vanished before any
delete), `delete_unacknowledged` (we sent a delete, the provider never confirmed it and the
60 s grace window has passed). The app never resolves these itself, but it does not strand
them either: if the cause clears (the audit log becomes available), the next send completes
and stamps `manualResolution.resolvedAt`.

Double click / two tabs: both requests may run the gate; the conditional writes, the
acknowledgement rule (the loser follows the winner's persisted acknowledgement, or sees the
row already voided) and the CAS make them converge, and `reserveSigningSlot` lets exactly one
create an envelope.

**Documenso API contract used.** Documenso v2 has no separate cancel call: the vendor's
migration guide maps the old document delete to `POST /api/v2/envelope/delete`, and the
vendor's user documentation says deleting a **pending** document is a hard delete, voids
signatures and notifies recipients. The envelope status enum includes `CANCELLED`; recipient
`signingStatus` is `NOT_SIGNED | SIGNED | REJECTED`. The request body shape (`{ envelopeId }`)
and the post-delete behaviour of `GET /envelope/:id` were **not confirmed against the deployed
instance** — hence verification by re-read, the acknowledgement rule above, and §7 steps B/C/G/N
which characterise it on staging. In particular a 404 after a delete is **ambiguous** (hard-deleted
pending envelope vs soft-deleted completed one) — which is exactly why it is never accepted
without the provider's acknowledgement of our delete and a fresh pre-delete observation.

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

**Migration 2 — `supabase/migrations/20261030_roa_completed_status_guard.sql`** (added by the
safety remediation; `20261029_roa_amendments.sql` is byte-for-byte what was reviewed). One
trigger, no data, column, grant or policy change:

- A row that is `completed` (or already has a `completed_at`) **cannot be moved to another
  status** (`RA014`), and its `signing_status` cannot regress to a non-completed value
  (`RA015`). A write that leaves the status alone — evidence, CRM filing, reminders — is
  untouched, and a row with `completed_at` set may still move forward to `completed`.
- Why it exists: the application now makes every such write conditional (R1), but the database
  is where "completed stays completed" can be promised independently of any build, code path
  or manual statement. Without it, only the code protects the record.
- Independent of migration 1 (apply both before the new build); executed against Postgres,
  idempotent, and its rollback (`drop trigger … ; drop function …`) is exercised in the tests.
- **Behaviour change:** an old build (or a person) that tried to move a completed record would
  now get an error instead of silently succeeding. A deliberate repair needs
  `alter table … disable trigger roa_submissions_guard_completed_status` (steps in the file).
- It is separable: if the reviewer prefers the code-only protection, do not apply it; the
  application does not depend on it.

## 6. Deployment order (production — only after explicit approval; nothing here has been run)

1. Staging: apply **both migrations** (`20261029_…`, then `20261030_…`), deploy the branch
   preview, run §7. Record the Documenso findings (§7-B/C/G/N) in the PR before anything else.
2. CRM team: ship the §4 change to CRM staging, verify, then CRM production. (Optional for
   HRSROA go-live: revisions simply stay unfiled in the CRM until step 6.)
3. Production DB: take a snapshot/PITR marker, apply both migrations in order, run the §7-L
   invariant queries (all return 0 rows) and confirm legacy rows read as revision 1.
   Nobody should have `manualResolution` rows yet: run the §10 query, expect 0 rows.
4. Deploy the HRSROA build. **Migration first, code second** — the new build selects the new
   columns, so the reverse order breaks the register with a loud `list_failed`.
5. Smoke: sign in, open My ROAs, open a legacy ROA (shows no revision UI), download its
   evidence. Amend a *test* ROA only.
6. After the CRM release is live: set `CRM_REVISION_METADATA=enabled`, redeploy, confirm a
   completed revision files three new CRM documents and no duplicate deal.

Rollback: revert the deployment (database stays as is; both migrations are additive and the
previous build works against them). Disable CRM filing of revisions by unsetting
`CRM_REVISION_METADATA` and redeploying. No existing secret changes anywhere.

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
envelope gone/cancelled in Documenso, Rev 1 `voided` with `signing_meta.supersession` showing the
whole trail in order — `cancelRequestedAt` (intent) ≤ `deleteDispatchedAt` ≤
`deleteAcknowledgedAt` (the provider's 2xx) ≤ `cancelledAt`, `deleteAttempts: 1`, and
`verifiedBy: gone_after_acknowledged_delete` (or `cancelled`) — exactly one live envelope
(Rev 2's), recipients' emails as Documenso sends them. **Record** what `GET /envelope/<old id>`
returns afterwards (404 vs `CANCELLED`), what the delete call itself returned (status and body),
and whether the old envelope/audit log is still visible.

**C. Partially signed.** As B, but the client signs Rev 1 before you amend/send Rev 2.
Expect the same, plus a stored copy at `<rev1>/superseded-audit-log-<sha256[0:16]>.pdf`
(Storage → `roa-pdfs`) whose SHA-256 equals `signing_meta.supersession.auditLog.sha256`, with
`verifiedAt` set and `signedKey: "1"`; the audit log must open as a PDF and show the client's
signature event. Record whether Documenso serves an audit log for a *pending* envelope at all
(if it does not, the 4xx sends this case straight to manual resolution — that is the correct,
safe behaviour, but it would mean partially signed amendments always need §10).

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
from a cancelled one, and whether its signed PDF / certificate / audit-log downloads still work
afterwards (that decides whether evidence of a just-completed envelope can still be retrieved
after a racing delete). (If it is **not** distinguishable, see §8 risk 2.)

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
cancel path is now ~7 provider calls — one extra fresh pre-delete read — plus ~5 small database
writes; for a partially signed request add the audit-log download, an upload and a read-back.
Hobby's default function limit is 10 s — if close, set a `maxDuration` for that route). Then
redeploy the previous build against the migrated staging database: the register, evidence
downloads and sending must still work.

**N. Manual-resolution drills (staging only).** Each must leave the old request untouched, send
nothing, show the orange *Manual resolution required* alert on the old request in My ROAs, and
name a reason in the refusal body.
1. *Someone else deleted it.* Rev 1 `PENDING`, Rev 2 submitted. In the Documenso UI delete Rev
   1's envelope. Send Rev 2 → 409 `predecessor_manual_resolution_required`, reason
   `envelope_missing_unexplained`. Then run the §10 resolution and Send again → succeeds.
2. *Audit trail cannot be saved.* Partially signed Rev 1, Rev 2 submitted. In the **staging**
   Supabase project set bucket `roa-pdfs` `file_size_limit` to 1 KB. Send Rev 2 twice → 503
   `predecessor_audit_backup_failed` each time, Rev 1 still `PENDING` in Documenso with the
   client's signature intact; the third attempt → 409 `…manual_resolution_required`, reason
   `audit_backup_unavailable`. Restore the bucket limit → Send again → succeeds, a verified copy
   is stored, `manualResolution.resolvedAt` is set and the alert disappears.
3. *Lost acknowledgement.* Hard to provoke honestly; instead, with Rev 1 `PENDING` and Rev 2
   unsent, delete Rev 1's envelope in the Documenso UI **and** run
   `update public.roa_submissions set signing_meta = jsonb_set(signing_meta, '{supersession}', '{"replacementId":"<rev2>","cancelRequestedAt":"2026-01-01T00:00:00Z","deleteDispatchedAt":"2026-01-01T00:00:01Z"}'::jsonb) where id = '<rev1>'`
   → Send Rev 2 → 409 reason `delete_unacknowledged`. Change the dispatch time to `now()`
   → 503 `predecessor_cancel_unverified` (inside the 60 s grace window). Same row with a
   `deleteAcknowledgedAt` added → Send succeeds and Rev 1 becomes `voided`.
4. *Completion racing the click.* Have the adviser open the signing link for Rev 1 (client has
   signed) and press *Complete* within a second of pressing Send on Rev 2 (try several times).
   Acceptable outcomes: Rev 2 refused with `predecessor_completed` and Rev 1 *Signed* with all
   three evidence files; or Rev 1 cleanly `voided` with the adviser's signing page failing.
   **Never acceptable:** Rev 1 `voided` while Documenso shows it `COMPLETED`, or both live.
   Report any occurrence immediately — it is the residual risk in §8-2.

## 8. What the automated tests do **not** prove

1. **Live Documenso behaviour.** The fake models the documented contract. Whether delete of a
   pending envelope keeps an audit trail, what `GET` returns afterwards, and what an already
   completed envelope does when deleted are unconfirmed (§7-B/C/G).
2. **Delete racing a completion — narrowed, not eliminated.** If Documenso soft-deletes a
   just-completed envelope and then answers 404, a completion in the few milliseconds between
   our *fresh pre-delete read* and the provider's processing of the delete would look like a
   cancellation (the provider acknowledged a delete, the envelope is gone). The remediation
   shrinks the window to that one round trip and guarantees that anything we *recorded* as
   completed beforehand is never overwritten (R1), but no API available to us can close the last
   gap: Documenso offers no conditional delete. Probability is tiny (the final signer is the
   broker who is performing the amendment) and the consequence is bounded — the signed Rev 1
   would be recorded as `voided` and Rev 2 sent for a fresh signature; Rev 1's completion
   evidence would stay in Documenso as a soft-deleted document that an administrator can
   restore, but would not be in our register — but it is not zero. Steps G and N-4 tell us whether it is real; if it is, the policy decision is to
   require manual confirmation for any request where the last signer has already opened the
   document.
3. **Lost delete reply = manual resolution.** If the delete succeeds but its reply is lost and
   the follow-up read is also unavailable, nothing in the application can prove the envelope was
   removed by us, so it stops and asks a person (§10). This is deliberately conservative; it
   should be rare. If staging shows 5xx-after-success from Documenso is common, revisit.
4. **`signing_meta` is last-writer-wins.** Each cancellation step rewrites the JSON from the
   latest row it holds. Two simultaneous attempts, or a reminder landing mid-cancellation, can
   erase a marker. Every erasure falls in the *safe* direction (a missing acknowledgement or
   backup pointer → wait / re-backup / manual resolution, never a void), but it can cost a retry.
5. **What the preserved audit log is.** It is the provider's audit log PDF for a *pending*
   envelope. Documenso does not flatten a signature into the document until completion, so this
   plus our canonical PDF and recorded recipient progress is all that exists to preserve. The
   copy lives in the private evidence bucket and is not yet downloadable from My ROAs.
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

`npm test` (43 files, **694 tests** at the time of writing; 423 before this feature, 601 at the
first commit), `npm run lint`, `npm run build`.

Suites: `amendmentEndpoints` (creation, retries, owner-only read, gate — 67), `amendmentSql`
(real Postgres, both migrations, plus the §10 runbook SQL executed verbatim from this document — 44; dev dependency `@electric-sql/pglite`), `amendmentRules`
(56), `amendmentCrm` (10), `amendmentContracts` (26), and the safety-remediation suites
`amendmentRaces` (62) and `manualResolutionNotice` (6).

**`amendmentRaces` — deterministic, not timing-based.** A test chooses the exact instant
another request "gets there first" (`mock.fixtures.onUpdate` runs just before a write lands;
`fake.override` runs while a provider answer is produced) and asserts the resulting database
and provider state.

- *R1 (completed stays completed)* — stale `PENDING` / `CANCELLED` / `REJECTED` reads in the
  reconcile path, a stale `COMPLETED` read against a voided row, evidence back-fill on a
  completed row still allowed; in the gate: completion landing exactly at the intent write, the
  dispatch write, the void write and the declined write, the in-between "`completed_at` set,
  status not yet" state, and a late acknowledged-404 vs a completion; every repository write
  against another broker, an unusable identity, each non-open status, and a mismatched
  forward link; the legacy DocuSign reconcile.
- *R2 (audit retention)* — order (copy before delete), unavailable (5xx / network / 429), not a
  PDF, empty body, storage refusal, silent corruption caught by the read-back (and never
  overwritten), escalation to manual resolution after 3 failures and at once on a permanent
  4xx, the alert shown to the broker, self-healing when the log returns, the operator route,
  no backup needed when nobody signed or the envelope is a DRAFT, unreadable / unrecognised
  recipient progress treated as signed, progress changing after the copy, copy reuse on retry,
  completion during the backup, no personal data in the stored record.
- *R3 (the intent→delete gap)* — a crash before the dispatch is recorded (no delete; clean
  retry), the same crash followed by someone else deleting the envelope (**manual resolution,
  not a void** — the original defect), the envelope vanishing or completing between the intent
  and the fresh read, a crash after the acknowledgement but before the void (retry finishes from
  the acknowledgement, no second delete), an acknowledgement that cannot be persisted, a lost
  reply (503 → inside the 60 s grace window waits → after it manual), the grace boundary, a
  delete answered 404, an acknowledgement belonging to a different replacement, the register
  refresh obeying the same rule, and two-tab convergence (loser follows the winner).

**Mutation checks (safeguard removed → tests fail).** R1: refresh writes unconditionally → 8;
`recordProviderTerminal` unconditional → 2; void CAS loses its status / completion guards → 7.
R2: failed backup no longer blocks the delete → 12. R3: intent accepted as proof in the gate
→ 7; intent accepted as proof in the register refresh → 11; no fresh pre-delete read → 2;
a 404 without acknowledgement accepted → 6. (Earlier pass: gate disabled → 20, no re-verification
→ 3, any 404 accepted → 1.) The database trigger is covered by the real-Postgres tests
directly (each forbidden transition is refused with its SQLSTATE; rollback and re-apply are executed).

**Not covered by any automated test:** live Documenso behaviour and true parallel
transactions (§8, §7-G/I/N), and the new alert rendered in the full register page in a browser
(its component is rendered and asserted on server-side; the page was last exercised in a real
browser during the first pass, before the alert existed).

## 10. Operator runbook — manual resolution

For a person with database access to the **ROA** Supabase project and to Documenso. The app
never resolves these by itself; the broker has been told to contact HRS compliance.

**Find them (also run it once after go-live to confirm there are none):**

```sql
select id, revision_no, status, signing_envelope_id,
       signing_meta->'supersession'->'manualResolution'->>'reason'    as reason,
       signing_meta->'supersession'->'manualResolution'->>'flaggedAt' as flagged_at,
       signing_meta->'supersession'->>'replacementId'                 as replacement,
       signing_meta->'supersession'->'auditLog'->>'path'              as preserved_audit_log
from public.roa_submissions
where signing_meta->'supersession'->'manualResolution'->>'required' = 'true'
  and signing_meta->'supersession'->'manualResolution'->>'resolvedAt' is null
  and status in ('awaiting_signature', 'submitted', 'signature_failed')
  and completed_at is null;
```

**Resolve each (the replacement stays unsent until you do):**

1. Open the envelope in Documenso (`signing_envelope_id`; its external id is the ROA id) —
   including **deleted / soft-deleted documents** — and record its state.
2. **If it is `COMPLETED`** (signed): do *not* cancel it. Ask the broker to press *Refresh* on
   that ROA in My ROAs (this retrieves the signed PDF, certificate and audit log), then to send
   the replacement again; a completed predecessor is kept as the signed record.
3. **If it is still `PENDING`:** if anyone has signed, download its audit log (and the signing
   certificate if shown) from Documenso and file them with compliance — record where. Then
   cancel/delete it in Documenso.
4. **If it no longer exists** (reasons `envelope_missing_unexplained`, `delete_not_dispatched`,
   `delete_unacknowledged`): establish *who* removed it and that it was cancelled, **not
   completed** — check Documenso's deleted-documents view and its audit trail. If it was
   completed, treat as step 2 and restore it in Documenso first.
5. Only when the request is confirmed not live and its evidence is safe, record that in the
   database (run as the database owner, one row, nothing else):

```sql
update public.roa_submissions
set status = 'voided',
    signing_status = 'cancelled',
    signing_meta = jsonb_set(signing_meta, '{supersession,manualResolution,resolvedAt}', to_jsonb(now()::text), true)
where id = '<ROA id of the OLD revision>'
  and superseded_by_submission_id = '<ROA id of the replacement>'
  and status in ('awaiting_signature', 'submitted', 'signature_failed')
  and completed_at is null;
```

   (Expect `UPDATE 1`. The completed-status trigger and the revision guard do not interfere. Do
   not touch `snapshot_json`, any hash, any evidence column or `superseded_by_submission_id`.)
6. Ask the broker to press *Send for signature* on the replacement: the gate sees a `voided`
   predecessor and proceeds. Add a note of what you found and did to the compliance record.

If the reason was `audit_backup_unavailable` and the cause was transient (storage or Documenso
outage), you may instead simply wait for it to clear and have the broker retry: the next send
saves a verified copy first and completes by itself.
