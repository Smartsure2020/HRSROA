# HRS ROA — Unified CRM Authentication

**Branch:** `feat/roa-crm-auth` (based on `origin/main` @ `71230c8`) · **Not merged, not deployed, not pushed.**
**Scope:** brokers sign in to ROA with their existing HRS CRM account. ROA's own database, evidence, signing and CRM-sync paths are untouched.

---

## 0. What you need to decide / do before this can go live

| # | Item | Why it matters |
|---|---|---|
| 1 | **Supply an explicitly authorised test identity** for a preview run (or run the acceptance checklist yourself) | The real "existing CRM broker logs into ROA" test (§11 of the brief) has **not** been run. No credentials were available and none were requested. |
| 2 | **Run `npm run reconcile:brokers`** (needs CRM + ROA service-role keys; read-only) | The 13/9/4 broker counts in the brief are **unverified** — I had no service-role access. Four brokers (Andrew Penney, Charmaine Brogden, Jaryd Browne, Timothy Simpson) reportedly have no CRM account and cannot use ROA until they do. Their history stays intact. |
| 3 | **Add ROA's reset URL to the CRM Supabase redirect allow-list** (§6) | Without it, "Forgot password?" emails send brokers to the CRM instead of back to ROA. |
| 4 | **Recommended: disable public sign-up on the CRM Supabase project** (§6) | Verified today: sign-up is **open** (`disable_signup: false`). Confirmation is required (`mailer_autoconfirm: false`), which is what keeps the email-based approval safe — but there is no reason to leave the door open. |
| 5 | **Decide on the CRM → ROA auto-sign-in link** (§4.4). Shipped **off**. | The CRM's "Open ROA System" button already puts session tokens in the URL. It will start working the moment ROA shares the CRM's auth project. I left it disabled by default for security reasons explained below. |
| 6 | Explicit approval, then follow §9 | Two-step rollout designed so step 1 changes nothing for users. |

---

## 1. Original authentication architecture (as audited)

One Supabase project (`rylfshngbafldisqrhec`) did **both** jobs. Verified against the live production bundle (it references only that project).

| Layer | How it worked | Where |
|---|---|---|
| Browser auth | `supabase-js` client on `VITE_SUPABASE_URL/ANON_KEY`; email+password sign-in, `resetPasswordForEmail` | `src/lib/supabaseClient.js`, `AuthContext.jsx`, `Login.jsx` |
| Server auth | `supabase.auth.getUser(token)` on `SUPABASE_URL/ANON_KEY`; then an **email allow-list** (`BROKER_EMAIL_MAP`) | `api/_lib/auth.js`, `src/lib/brokerDirectory.js` |
| Server data | service-role client on `SUPABASE_URL/SERVICE_ROLE_KEY` | `api/_lib/supabaseServer.js` |
| Ownership | `roa_submissions.advisor_user_id` = **old ROA Auth user id** (+ informational `advisor_email`) | `api/_lib/submissionRepo.js` |
| RLS | RLS **on**, **no policies**, all `anon`/`authenticated` privileges revoked; `service_role` has column-scoped grants; restrictive storage policy keeps browser roles out of `roa-pdfs`. **Nothing depends on JWT claims or the old user id.** | `supabase/migrations/20260914_*.sql` |
| Direct browser→DB | **None.** The browser never queries a table or bucket. | grep + contract test |
| CRM integration | server-to-server `CRM_INTEGRATION_SECRET` / `CRM_BASE_URL`; unrelated to user auth | `api/_lib/crmIntegration.js` |

**Why "just swap two env vars" would have broken it:** (a) ownership keyed on the old Auth id, so every broker would have lost sight of their history; (b) the same `SUPABASE_URL` also fed the service-role data client, so swapping it would have pointed evidence storage at the CRM project; (c) there was no `/reset-password` route, so password recovery was already incomplete; (d) any valid session was trusted once its email matched the directory, with no check that the email was *confirmed*.

## 2. New architecture

```
Browser ──sign-in / refresh / reset / logout──▶ CRM Supabase Auth (mgqelduyralkdbsbwqcu)
   │                                                   ▲
   │ Authorization: Bearer <CRM access token>          │ auth.getUser(token)  (anon key only)
   ▼                                                   │
ROA /api  ── 1. inspect claims (reject-only): iss=CRM, aud/role=authenticated, exp, sub
          ── 2. Auth service verifies signature, key rotation, LIVE SESSION
          ── 3. user.id == token.sub, email CONFIRMED, not anonymous, not banned
          ── 4. email ∈ approved-broker directory, exactly one match      ← authorisation
          ── 5. every read/write scoped to that broker's verified email   ← ownership
          ▼
   service-role client ──▶ ROA Supabase (rylfshngbafldisqrhec): roa_submissions + private roa-pdfs
```

* **Authentication and authorisation stay separate.** A valid CRM session is necessary, never sufficient.
* **Ownership** is now the broker's verified, normalised email compared with each row's `advisor_email`. `advisor_user_id` is never read for access decisions and is **never rewritten** — historic rows keep the old ROA id, new rows get the CRM id. Both columns are immutable to the service role (column grants), so attribution can't drift.
* **Rollback-friendly:** because ownership no longer depends on the Auth id, rows created while on CRM auth stay visible if you switch back.

## 3. Files changed and why

**Server**
| File | Change |
|---|---|
| `api/_lib/authConfig.js` *(new)* | Separate AUTH (anon key) vs DATA (service key) configuration; legacy-name fallback; partial pair fails closed |
| `api/_lib/brokerIdentity.js` *(new)* | Strict email normalisation, single-match directory resolution, ownership predicate, LIKE-escaping |
| `api/_lib/auth.js` | Claim pre-checks + authoritative `getUser`; subject binding; confirmed-email / anonymous / banned checks; `requireAuthenticatedBroker` returns a broker identity |
| `api/_lib/supabaseServer.js` | Data client reads `ROA_SUPABASE_*` (legacy fallback) |
| `api/_lib/submissionRepo.js` | Every owner-scoped read/write takes the broker and filters on verified email (query **and** in-code re-check) |
| `api/roa-submissions/*.js`, `documensoSigning.js`, `signingReconciliation.js` | Mechanical: pass the broker object instead of `user.id` |
| `api/roa-submissions/create.js` | Stamps new rows from the validated identity only |
| `api/roa-submissions/list.js` | `?view=session` access probe (no new function — project is at the Vercel Hobby 12-function ceiling) |

**Browser**
| File | Change |
|---|---|
| `src/lib/authConfig.js` *(new)*, `supabaseClient.js` | Auth client on `VITE_AUTH_SUPABASE_*` (legacy fallback); reads env by static key so only auth variables are inlined |
| `src/lib/authSession.js` *(new)* | URL-token scrubbing, legacy-session purge, access probe, local-scope logout (with storage fallback) |
| `src/lib/passwordRecovery.js` *(new)*, `src/pages/ResetPassword.jsx` *(new)*, `App.jsx` | Recovery runs on the CRM project; fixed redirect; new `/reset-password` page routed outside the sign-in gate |
| `src/lib/AuthContext.jsx`, `src/pages/Login.jsx` | Access check after sign-in (denied / expired / retry notices), opt-in handoff, legacy cleanup |
| `jsconfig.json`, `src/global.d.ts` | Types only — includes the existing declarations; removes 8 pre-existing type errors |

**Tooling / config / tests:** `scripts/check-auth-config.mjs`, `scripts/reconcile-broker-identities.mjs` (+ `scripts/lib/*`), `.env.example`, `package.json` scripts, 5 new test files, JWT-shaped fixtures for the existing suite, `ilike` support in the mock.
**Not touched:** Documenso/DocuSign code, signing identities, CRM sync contracts, storage paths, migrations (**no DB migration is required**).

## 4. Security review

### 4.1 Token validation (§7)
| Requirement | How it is met |
|---|---|
| Signature, signing key, key rotation | Delegated to the Supabase Auth service via `getUser` (it holds the current key set). Claims are never trusted to *accept*. |
| Issuer / expected project | `iss` must equal `<AUTH url>/auth/v1`; the validating client is built from the AUTH project only |
| Expiry, audience, role | `exp` unexpired, `aud` contains `authenticated`, `role=authenticated` (also rejects the project's anon/service keys used as bearers) |
| Malformed / `alg:none` / oversized | Rejected before any network call |
| Old ROA-project tokens after cutover | Rejected on `iss` before any network call (and would fail signature at the CRM anyway) |
| Revoked / signed-out session | `getUser` checks the session exists → rejected even before `exp` (verified in simulation) |
| Subject binding | Service-confirmed `user.id` must equal the token `sub` |
| Email integrity | `email_confirmed_at` required; anonymous and banned users refused |
| Service-role key | Never used to identify a user; the auth client holds only the AUTH anon key |
| Fail closed | Missing / partial config → 500 `server_misconfigured`; auth outage → 500 `auth_service_error` |

### 4.2 Evidence / data access
* Browser has **no** ROA data credentials and makes **no** direct data calls (contract tests; confirmed in simulation: zero browser-origin requests reached the data API).
* RLS/privileges/storage policy are unchanged and remain "server-only". The service role bypasses RLS, so equivalent checks are enforced in `submissionRepo.js`; a static test asserts no route builds its own client, loads rows without an ownership gate, or mutates a row it did not load through that gate.
* Cross-broker reads/downloads/writes return the same `404 not_found` as a non-existent id (no existence leak), and storage is never touched for a row the caller doesn't own.
* **No admin/manager read-all path exists** in ROA and none was added (the practice manager sees exactly what any broker sees).
* One internal helper, `updateSubmission(id, patch)`, is not owner-scoped by design; every route that reaches it first loads the row through the ownership gate (a static test fails if a mutating route doesn't). Left as is to avoid touching 11 call sites.

### 4.3 Password recovery
Runs entirely on the CRM project (same account and password as the CRM). `redirectTo` = the app's own origin + fixed `/reset-password` (no input, no query). The reset page handles fragment tokens, PKCE `?code=`, and `token_hash` (type pinned to `recovery`), never renders text taken from the URL (anyone can craft a link), and its post-reset destination is fixed. Supabase additionally enforces the CRM redirect allow-list.

### 4.4 CRM → ROA token handoff — **decision needed**
The CRM's `buildRoaUrl()` appends the broker's `access_token` **and `refresh_token`** to `https://roa.hrsinsurance.co.za/…` ("You'll be signed in automatically"). ROA's old `AuthContext` already accepted them, but they were from a different project so it never worked. Once ROA shares the auth project it would. Risks: refresh token in a URL (history, logs, screenshots) and **both apps sharing one refresh-token family**, so a refresh in one can revoke the other's session (surprise sign-outs, with refresh-token reuse detection on).
*Shipped behaviour:* tokens are **always scrubbed from the URL immediately**; they are only **used** if `VITE_ENABLE_CRM_SESSION_HANDOFF=true` at build time (tested both ways). Without it, brokers click through from the CRM and sign in with the same credentials. *Recommended follow-up:* a CRM-side one-time-code exchange rather than raw tokens.

### 4.5 Residual risks (accepted / to monitor)
1. **CRM approval isn't consulted.** The CRM gates access on `profiles.status`; ROA (per the brief) keeps the directory. A broker deactivated in the CRM keeps ROA access until removed from `BROKER_EMAIL_MAP` or banned/deleted in Supabase Auth. Offboarding must do both. Future hardening: server-to-server status check.
2. **Email is the ownership key.** A mailbox change or reassignment changes who sees history; the reconciliation script reports orphaned/ambiguous owners rather than guessing.
3. **Public CRM sign-up is open.** Safe today only because confirmation is required (verified); disable sign-up (§6).
4. ROA and CRM now share Supabase Auth rate limits.
5. `advisor_user_id` becomes a mix of old ROA ids and CRM ids; nothing in code reads it.

## 5. Vercel environment variables (project `hrsroa`; names verified with `vercel env ls`, values never read)

Production currently has: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `CRM_BASE_URL`, `CRM_INTEGRATION_SECRET`, `DOCUMENSO_*`, `ROA_SIGNING_PROVIDER`, `DOCUSIGN_*`, `RESEND_API_KEY_R`.

**Cutover (the only changes needed):**
| Variable | Value → project | Visibility | Environments | Notes |
|---|---|---|---|---|
| `AUTH_SUPABASE_URL` | CRM `https://mgqelduyralkdbsbwqcu.supabase.co` | server | Production (+ branch Preview) | read at runtime |
| `AUTH_SUPABASE_ANON_KEY` | CRM **anon** key | server | Production (+ Preview) | never a service key |
| `VITE_AUTH_SUPABASE_URL` | same CRM URL | public (bundled) | Production (+ Preview) | **build-time** — needs a new build |
| `VITE_AUTH_SUPABASE_ANON_KEY` | same CRM anon key | public (bundled) | Production (+ Preview) | build-time |

**Leave unchanged at cutover:** `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (they keep feeding the **ROA data** client via the legacy fallback — zero change to the data path), `CRM_*`, `DOCUMENSO_*`, `DOCUSIGN_*`, `ROA_SIGNING_PROVIDER`, `RESEND_API_KEY_R`.
**Keep until verified (rollback + fallback):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_ANON_KEY` — no longer used for auth once the AUTH pair exists.

**Optional clean-up, ≥1 week after a stable cutover:** add `ROA_SUPABASE_URL` + `ROA_SUPABASE_SERVICE_ROLE_KEY` (server, **Sensitive**, same values as the legacy data pair), then retire `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Do not retire before the rollback window closes.

**Optional:** `VITE_ENABLE_CRM_SESSION_HANDOFF=true` — see §4.4. Leave unset.

**Preview:** existing Preview variables are scoped to the branch `feat/roa-register-compliance-downloads`, so a preview of `feat/roa-crm-auth` gets none of them. Add the four AUTH variables **plus** the same staging data/signing/CRM-staging variables the accepted preview used, scoped to `feat/roa-crm-auth`. Do **not** point a preview at production ROA data. A partial pair is rejected (fails closed), never mixed.

## 6. Supabase settings (CRM project `mgqelduyralkdbsbwqcu`)

| Setting | Action |
|---|---|
| Authentication → URL Configuration → **Redirect URLs** | Add exactly `https://roa.hrsinsurance.co.za/reset-password` (and `https://hrsroa.vercel.app/reset-password` if brokers use that host). For preview testing add the exact preview URL, not a wildcard; remove it afterwards. **Leave Site URL alone** (it belongs to the CRM). |
| Authentication → Email Templates → **Reset Password** | Confirm it uses `{{ .ConfirmationURL }}` so `redirect_to` is honoured. If it was customised to a CRM-only `token_hash` link, ROA's redirect is ignored and the reset lands in the CRM. |
| Authentication → Sign In / Providers → **Allow new users to sign up** | **Turn off** (recommended). CRM invites use the admin API and are unaffected. Verified 2026-10-14: currently ON. |
| Confirm email | Already required (`mailer_autoconfirm: false`, verified). **Do not turn on auto-confirm** — `npm run check:auth-config -- --live` fails if it is on. |
| ROA Supabase project | **No change.** No Auth users deleted, no policies/migrations touched. |

## 7. Broker-account reconciliation

**Not run against production — BLOCKED** (needs the CRM and ROA service-role keys, which this environment doesn't have; I did not look for them).
What I could verify without them: the directory has 13 unique, valid mailboxes (test-enforced); CRM Auth requires confirmed emails and has open sign-up; the live ROA bundle uses the ROA project.
To produce the real counts and exceptions:
```
RECON_CRM_SUPABASE_URL=… RECON_CRM_SERVICE_ROLE_KEY=… RECON_ROA_SUPABASE_URL=… RECON_ROA_SERVICE_ROLE_KEY=… npm run reconcile:brokers
```
Read-only (lists CRM users; selects `id, advisor_user_id, advisor_email` — never `snapshot_json`, banking or evidence). Prints counts, directory names and **masked** third-party addresses. Reports: brokers with a ready / missing / unconfirmed / banned / duplicate CRM account; submissions reachable at cutover vs waiting on an account vs owned by a non-directory email (unreachable); ambiguous historic ids; id/email conflicts. `--fail-on-exceptions` gives a CI-style exit code. Tested with a fabricated 13/9/4 scenario.

## 8. Test results (all executed)

| Check | Result |
|---|---|
| Unit/integration tests | **36 files, 415 tests, all pass** (baseline on `origin/main`: 31 files / 292 pass) |
| Lint | pass (baseline pass) |
| Build | pass (baseline pass) |
| Typecheck | **pre-existing: 230 errors** (tsc over JS; config omitted Vite/PNG declarations). Now **223**. Zero genuinely new: one line is the pre-existing `createContext()` error moved from line 4 to 12 |
| Mutation checks | Breaking the ownership rule → 7 isolation tests fail; skipping the issuer check → 1 fails; dropping the confirmed-email check → 1 fails (files restored) |
| Live, against the real CRM project (anon key only, no credentials) | `check:auth-config --live`: confirmation required ✔, sign-up open ⚠, forged token refused (HTTP 403). Real `authenticate()` + real supabase-js: forged token, old-ROA-issuer token, expired, `alg:none`, anon-key-as-bearer, no token → **all rejected** |
| Local end-to-end simulation (fake CRM Auth + fake ROA data/storage + the real built SPA + real handlers + real supabase-js, loopback only) | not-approved CRM user → notice, no session, no dashboard ✔ · approved broker → dashboard ✔ · My ROAs shows only the broker's own pre-cutover rows (legacy ids, mixed-case email) ✔ · own signed/certificate/audit PDFs hash-verified ✔ · another broker's metadata/evidence → 404 and storage untouched ✔ · zero browser→data-API requests ✔ · logout sends `scope=local`, session revoked, **replayed pre-logout token → 401** ✔ · reset request hits the auth server with the fixed redirect, no data-API call ✔ · recovery link → form → validation → `PUT /user` → dashboard ✔ · handoff off: tokens scrubbed and ignored ✔; on: signs in ✔ |

**Not tested:** the real acceptance flow (existing CRM broker → ROA); real password-reset email and allow-list; creating a Personal/Commercial ROA, sending for signature, reminders, reconciliation, Documenso/DocuSign, CRM sync **against live services** (these are covered only by the existing mocked suites, which still pass unchanged apart from fixture tokens). No live signing emails were sent, no production records created or modified.

## 9. Production deployment (needs your explicit approval)

0. **Gates:** approvals; run `npm run check:auth-config -- --env-file <file> --live --expect-auth-ref mgqelduyralkdbsbwqcu --expect-data-ref rylfshngbafldisqrhec`; run `npm run reconcile:brokers` and resolve exceptions; invite the four missing brokers in the CRM (confirm their email); CRM redirect allow-list + template check; disable public sign-up; have in-flight ROAs submitted.
1. **Preview** (§5 preview note) → run the §11 acceptance checklist with the authorised test broker.
2. **Step A — ship the code, change nothing else.** Merge and deploy with **no new env vars**. Everything falls back to the legacy config, so behaviour is identical to today (plus the new reset page). Smoke-test.
3. **Step B — cutover.** Add the four AUTH variables (Production), redeploy (the `VITE_` pair needs a fresh build). Smoke-test read-only with an authorised broker: sign in, My ROAs, open an existing ROA, download evidence, sign out. Do not create production ROAs as a test.
4. Watch for 401/403 from `/api/roa-submissions/*` and CRM Auth rate limits for a few days.
5. After a stable week, optional clean-up (§5).

**Session impact:** every existing ROA browser session ends at Step B (different project). Brokers sign in again with their CRM credentials; the stale ROA-project token in each browser is purged automatically on first load. Unsaved wizard progress in an open tab is kept by the existing draft storage, but in-flight ROAs should be completed first.

## 10. Rollback (no effect on ROA documents, submissions or CRM integrations)

* **Preferred — Vercel Instant Rollback to the Step A deployment.** That deployment has the new code with the legacy auth config baked in, so auth reverts to the ROA project and **rows created during the cutover remain visible** (ownership is email-based).
* **Config rollback:** remove the four AUTH variables and redeploy → identical outcome.
* **Avoid** rolling back to pre-change code: it keys ownership on the old Auth id, so rows created on CRM auth would be hidden (not lost) until re-cutover.
* Nothing to undo in either database: no migration, no data change, no Auth user created or deleted. Brokers sign in again on rollback (ROA-project credentials; the CRM-project session is purged).

## 11. Acceptance checklist for the preview (explicitly authorised test broker)

1. Sign in with the CRM credentials. 2. Dashboard loads. 3. My ROAs lists only that broker's records, including pre-cutover ones. 4. Open an existing ROA; download signed PDF / certificate / audit log. 5. Try another broker's id by URL → 404. 6. Use a CRM account that is **not** on the directory → clear "not approved" notice, no dashboard. 7. Forgot password → email arrives, link returns to ROA's reset page, new password works in **both** apps. 8. Create a test Personal ROA against **staging** signing + CRM, confirm sync. 9. Sign out; replay a captured pre-logout token → 401. 10. Confirm a CRM-launched link leaves no tokens in the address bar.

## 12. Status

| Component | Status | Notes |
|---|---|---|
| CRM Supabase authentication | **PASS** | Automated + local simulation + live negative probes. Real CRM sign-in: see next-but-one row |
| ROA Supabase data isolation | **PASS** | Browser holds no data credentials; RLS/privileges per repo migrations (live DB policies not inspected — no ROA service key) |
| Broker authorisation | **PASS** | Directory + confirmed email + isolation/ambiguity tests, mutation-checked |
| My ROAs historical access | **PASS** | Seeded pre-cutover rows; **real-data check is BLOCKED** (reconciliation not run) |
| Private PDF access | **PASS** | Hash-verified, cross-broker denied, in tests and simulation |
| Password recovery | **PASS** | Simulated end to end; needs the CRM redirect allow-list, real email **NOT TESTED** |
| Documenso regression | **PASS** | Existing suites green; live provider **NOT TESTED** |
| CRM sync regression | **PASS** | Existing suites green; live sync **NOT TESTED** |
| Real acceptance test (existing CRM broker → ROA) | **NOT TESTED** | Needs an authorised test identity + preview environment |
| Broker reconciliation on real data | **BLOCKED** | Needs service-role keys; tool ready |
| Production readiness | **BLOCKED** | Awaiting items 1–6 in §0 |
