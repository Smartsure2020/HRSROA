# ROA on CRM Auth — preview acceptance runbook

Companion to [ROA_CRM_Auth_Integration.md](ROA_CRM_Auth_Integration.md). **Nothing here has been run.** No credentials were requested or are stored; the people named below sign in themselves.

## 0. Ground rules (safe by construction)

* **Read-only against ROA data.** No signing, no CRM creation, no new ROA submissions. Do **not** click *Start Personal/Commercial ROA* during this run.
* **The only step with a production side effect is step 9:** it changes the CRM Auth password of the designated test broker (the CRM project is the one real Auth project). The account owner does it, knowingly.
* **Never paste access/refresh tokens** into chat, tickets or screenshots. The snippets below keep tokens inside the browser and print only status codes.
* A preview must **never** carry production data, signing or CRM-sync credentials (see §2).

## 1. People and accounts

| Role | Requirement |
|---|---|
| **Test broker** (steps 1–6, 8–11) | An approved directory broker (`BROKER_EMAIL_MAP`) with a CRM Auth account whose email is **confirmed**, who owns the mailbox, and who agrees to the step-9 password change. Must have ≥1 pre-cutover **completed** ROA (signed PDF + certificate + audit log) in the preview's data store. |
| **Other broker's submission ID** (step 6) | The `ROA-<uuid>` of a submission whose `advisor_email` is a *different* approved broker, from the same data store. |
| **Non-directory CRM user** (step 7) | Any CRM staff account **not** in the directory; its owner signs in themselves. |

## 2. Preview environment

**Data store:** use the *staging* ROA Supabase + staging Documenso/CRM that the previously accepted preview used. Those staging rows were stamped with the staging project's old Auth ids, which is exactly the "pre-cutover" shape this test needs. Confirm the precondition read-only first:
`RECON_CRM_SUPABASE_URL=… RECON_CRM_SERVICE_ROLE_KEY=… RECON_ROA_SUPABASE_URL=<staging> RECON_ROA_SERVICE_ROLE_KEY=<staging> npm run reconcile:brokers` → the test broker shows `ready` and ≥1 submission.

**Vercel Preview variables, scoped to branch `feat/roa-crm-auth`** (existing preview variables are scoped to a different branch, so none are inherited):

| Variable | Value |
|---|---|
| `AUTH_SUPABASE_URL`, `VITE_AUTH_SUPABASE_URL` | CRM project URL |
| `AUTH_SUPABASE_ANON_KEY`, `VITE_AUTH_SUPABASE_ANON_KEY` | CRM anon key |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | **staging** ROA data pair (stays the data pair via the legacy names) |
| `SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | staging (kept for fallback/rollback parity) |
| `CRM_BASE_URL`, `CRM_INTEGRATION_SECRET`, `DOCUMENSO_*`, `ROA_SIGNING_PROVIDER`, `RESEND_API_KEY_R`, `DOCUSIGN_*` | the staging values the accepted preview used |
| `VITE_ENABLE_CRM_SESSION_HANDOFF` | **leave unset** (off) |

`vercel env add <NAME> preview feat/roa-crm-auth` prompts for each value (don't pass values on the command line).

**Config gate (no secrets printed):**
`node scripts/check-auth-config.mjs --env-file <file with the variables above> --live --expect-auth-ref mgqelduyralkdbsbwqcu --expect-data-ref <staging-ref>` → expect `Result: OK` (a `WARN` on public sign-up is acceptable only until the CRM setting is changed).

**Deploy without pushing:** `vercel deploy` (no `--prod`) from the repo, with `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` set (both appear in `.vercel/project.json` after `vercel link` in any scratch directory — don't link inside the repo). Alternatively push the branch, which needs your explicit go-ahead.

**CRM Supabase → Redirect URLs:** add the exact `https://<preview-host>/reset-password` before step 8 and **remove it afterwards**. No wildcards.

## 3. Procedure

Let `$P` = the preview URL. Result column: PASS / FAIL, with evidence reference.

| # | Do | Expected | How to verify | Result |
|---|---|---|---|---|
| 1 | Test broker signs in at `$P` with their CRM email + password | Signed in; no ROA-specific credential needed | Network: one `POST …/auth/v1/token` to the **CRM** host; then `GET /api/roa-submissions/list?view=session` → 200 with `authSource:"explicit"` | |
| 2 | Dashboard | Personal / Commercial / My ROAs tiles render; header shows the broker | Visual | |
| 3 | Open **My ROAs** | Lists the broker's pre-cutover records (count equals the reconciliation count for that email); none belonging to anyone else | Compare against step-0 reconciliation | |
| 4 | Open an existing ROA row | Status/details panel loads | `GET /api/roa-submissions/get?id=…` → 200 | |
| 5 | Download signed ROA, certificate, audit log (row actions) | Three PDFs open; filenames sensible | See snippet A (each → 200, `application/pdf`). A tampered object would return 500 `evidence_hash_mismatch` | |
| 6 | Request the other broker's known ID | **404** `not_found`, identical to a random valid-looking ID; no PDF | Snippet B | |
| 7 | Non-directory CRM user signs in | Amber notice "…not approved for the Record of Advice system…"; no dashboard; no `sb-…` key left in localStorage | Visual + `localStorage` check; direct API call returns 403 `not_an_hrs_broker` | |
| 8 | Test broker → *Forgot password?* → submit email | Email arrives; **before clicking, the link's host must be `$P`** (not the CRM) and the path `/reset-password`; ROA's reset form loads | If it lands on the CRM, the allow-list entry or the Reset Password email template is wrong — stop | |
| 9 | Set a new password on the ROA reset page → Continue | Dashboard loads. **Then:** sign in to the **CRM** with the new password ✔; sign out of ROA and back in with the new password ✔; old password rejected in **both** | Owner confirms all four | |
| 10 | Sign out of ROA | Login screen; no `sb-…` key | Snippet C: the token used before logout now returns **401** | |
| 11 | Open `$P/?access_token=FAKE&refresh_token=FAKE&client_id=1` | Address bar becomes `…/?client_id=1` immediately; **no** `sb-…` session created | Visual + `Object.keys(localStorage)` | |

> The real CRM "Open ROA System" button always points at the **production** ROA host, so step 11 on a preview uses fake values. The real-button check is done at production Step A (§4).

### Snippets (browser console on `$P`; they never print a token)

**A — evidence statuses** (replace `ID`):
```js
(async()=>{const k=Object.keys(localStorage).find(x=>/^sb-.*-auth-token$/.test(x));
const h={Authorization:'Bearer '+JSON.parse(localStorage.getItem(k)).access_token};
for(const kind of ['signed','certificate','audit-log']){const r=await fetch(`/api/roa-submissions/pdf?id=ID&kind=${kind}`,{headers:h});
console.log(kind,r.status,r.headers.get('content-type'))}})()
```
**B — another broker's ID** (replace `OTHER_ID`; expect 404 for both):
```js
(async()=>{const k=Object.keys(localStorage).find(x=>/^sb-.*-auth-token$/.test(x));
const h={Authorization:'Bearer '+JSON.parse(localStorage.getItem(k)).access_token};
for(const id of ['OTHER_ID','ROA-00000000-0000-4000-8000-000000000000']){
const r=await fetch(`/api/roa-submissions/get?id=${id}`,{headers:h});console.log(id.slice(0,12),r.status,await r.json())}})()
```
**C — logout invalidates the session.** *Before* signing out:
```js
sessionStorage.setItem('__t',JSON.parse(localStorage.getItem(Object.keys(localStorage).find(x=>/^sb-.*-auth-token$/.test(x)))).access_token)
```
Sign out (the page stays loaded), then:
```js
fetch('/api/roa-submissions/list',{headers:{Authorization:'Bearer '+sessionStorage.getItem('__t')}}).then(r=>console.log(r.status)) // expect 401
sessionStorage.removeItem('__t')
```

## 4. Production smoke tests (read-only; after approval)

* **After Step A** (new code, legacy auth): from the **CRM**, click *Open ROA System* with a real session → the address bar must be clean (`/` only), the ROA sign-in screen shows, and nothing is signed in automatically. Then sign in with the legacy ROA credentials and confirm normal operation (list, open, download). *Pre-existing CRM behaviour:* the CRM appends the tokens to the request URL, so they reach Vercel's request path; see the report's follow-up.
* **After Step B** (CRM auth): steps 1–5, 7 (with a non-directory user), 10 and 11 above against production, by an authorised broker. **Not** step 8/9 unless the owner chooses to, and **never** create or sign an ROA.

## 5. Stop conditions

Stop and report, don't "retry until green", if: any 5xx from `/api/roa-submissions/*`; the browser contacts any host other than the app, the CRM Auth host and fonts/CDN; a broker sees another broker's record; a reset link lands on the CRM; any step would create a record or send an email other than the reset email.

## 6. Cleanup and sign-off

Remove the preview redirect URL from the CRM project; delete or leave the preview deployment (it holds staging credentials only); remove branch-scoped preview variables if no longer needed.

| | |
|---|---|
| Run by / date | |
| Preview URL / commit SHA | |
| Steps 1–11 | all PASS / exceptions: |
| Approved to proceed to Step A | |
