# HRS ROA — Post-Implementation Audit

Read-only audit of the Holistic Risk Services Record of Advice application, following the compliance-driven changes committed as `5bee780 "updated in line with compliance"`. No code, source documents, database or CRM data were changed by this audit. No emails sent, no DocuSign envelopes created, no `.env` secrets displayed.

---

## A. Executive Summary

**Overall verdict: CONDITIONAL PASS.**

The requested compliance content (Policy Type, Needs Analysis, election clause, two-way declaration, Statutory Disclosure modal, Broker Fee Consent rewording, Broker Appointment / Client Mandate rewording, conditional Letter of Investigation) is present in both Personal and Commercial flows and flows through to on-screen review and the generated PDFs. However, there are material defects in the downstream evidence chain — the submission email, the Resend integration configuration, the DocuSign envelope construction, and the durable-storage story — that would produce misleading "submission successful" signals in production if released as-is.

Estimated implementation completeness against the six source documents: **~78%** (form capture and PDF are largely complete; email / DocuSign / persistence / evidence are the gaps).

**Critical findings (5):**
1. `RESEND_API_KEY` env var mismatch — email silently falls back to a dev mock in production if the operator follows `.env.example`.
2. Client banking details (bank, account number, account type, debit-order amount) sent in plain-text email body in the Personal flow.
3. Personal submission email's "acknowledgements completed" check omits the newly-added `ackStatutoryDisclosure`, `ackLetterOfInvestigation`, election clauses and declaration choice — so a "Yes" here is now misleading.
4. DocuSign envelope uses `anchorIgnoreIfNotPresent: 'true'` against anchor strings that are drawn on the PDF in uppercase — silent risk of an envelope being created with no signature tabs at all. Requires empirical verification against a real DocuSign sandbox before shipping.
5. No durable, retrievable storage of the completed ROA/PDF/audit evidence. "Submission successful" currently means "the broker email attempt returned 2xx" plus a fire-and-forget CRM sync — the submitted PDF is not saved anywhere retrievable by HRS.

**High findings (7):** Commercial flow has no session-storage draft restore; broker-fee display always appends `%` in the Personal email even when fee type is fixed; hidden conditional data (`replacingExisting=no` sub-fields, `changingBroker=no` acknowledgement) is retained in state and can therefore appear in generated output if answers change; two flows contain three different phone numbers for the same HRS switchboard; the "Client Declaration" step's radio implementation stores a single string but `AckRow` boolean pattern would let a user tick both accept and decline as separate rows if a future edit slips (currently ok); Personal `handleGoHome` prompt is bypassable by refresh (the `beforeunload` fires but restores from `sessionStorage`, meaning consented data survives across refreshes without any TTL); `.env` file is present in the extracted working tree (git-ignored, so not in history — but recipients of the ZIP see real values).

**Production readiness: not yet.** Fix the five critical items and the seven high items before release. The medium/low items are worth doing but not blocking.

**Recommended decision: CONDITIONAL PASS — resolve Critical and High items before merging to production.**

---

## B. Repository Baseline

| Item | Value |
|---|---|
| Branch | `main` |
| HEAD | `5bee78070caa40c882a7cd882de84a47ea315e9c` — "updated in line with compliance" |
| Expected HEAD in audit prompt | `0a7d5e747b3a63dda6ece85e45b15e88181ce968` |
| Difference | The recent implementation is **already committed** as `5bee780`, one commit ahead of the prompt's expected HEAD. All previously "uncommitted" edits are now in the commit; the working-tree diff is pure CRLF/LF noise from the Windows/Linux round-trip. |
| `git status --short` | 97 files "modified" |
| `git diff --stat` | 19,268 insertions / 19,268 deletions across the tree |
| `git diff --ignore-cr-at-eol --shortstat` | empty (no functional diff) |
| Working tree ⇔ HEAD after CRLF normalisation | identical (verified for `hrsConstants.js`, `dialog.jsx`, `StepPrinciples.jsx` — same line counts, `diff -u` produces no output) |
| Environment | Linux sandbox (mounted OneDrive folder from Windows host) |
| `dist/` in tree | Present but stale (last modified May 2026) — pre-dates the compliance work. It does NOT reflect the current source. |
| Node.js | v22.22.3 in sandbox |
| Package manager | npm 10.9.8 |
| Untracked (in extracted folder, not committed): | `.env`, `dist/`, `node_modules/` (all git-ignored — the `.env` and source docs are on disk locally but not in repo history) |

Uncommitted functional edits in the working tree: **none**. The audit therefore examines HEAD `5bee780` as the current state.

---

## C. Source-Document Traceability Matrix

Coverage of the six source documents against the current implementation. Status codes: **✅ Correct** · **⚠️ Partial** · **❌ Missing / Incorrect** · **⚙️ Requires HRS Compliance confirmation** · **N/A**.

### C.1 `ROA STI Personal Lines.docx` — Personal ROA template

| # | Source section | Requirement | Implementation | Status | Evidence |
|--:|---|---|---|:---:|---|
| 1 | Personal Details | Name & Surname, ID Number, Physical Address, Postal Address, Telephone, Email, Existing Insurer/Product/Policy Number (renewal/replacement only) | All present. Postal address collapsed to Physical only; postal-only field missing. Existing insurer/policy field added as `existingPolicyRef`, conditionally shown for Renewal/Replacement. | ⚠️ | `StepClientDetails.jsx:27-100`, `hrsConstants.js:206-207` |
| 2 | Personal Details | Policy Type: New placement / Renewal / Replacement | Implemented as required select. | ✅ | `hrsConstants.js:87`, `StepClientDetails.jsx:60-71` |
| 3 | Client Objectives & Instructions | Required Advice: STI Personal / STI Commercial / Other Financial Product tick group | Not present; app only handles STI Personal / Commercial as separate flows. Not visible on the ROA as a checkbox. | ❌ | Search: no `requiredAdvice` field. |
| 4 | Needs Analysis | Cover Type checkboxes (All Risk / Fixed Property / Household Items / Vehicles / Other Assets / No changes) | Not implemented as discrete Cover Type checkboxes. The app has a 16-item Risk Categories list (Yes/No + SASRIA) which overlaps but is not identical. | ⚠️ | `hrsConstants.js:12-29` (RISK_CATEGORIES); no COVER_TYPES const. |
| 5 | Needs Analysis | Perils to be Insured (Theft / Fire / Destruction / Consequential Loss / 3rd Party Liability / SASRIA / Other / No changes) | Present as multi-select pills. "No changes" not offered. | ⚠️ | `hrsConstants.js:89`, `StepRiskCategories.jsx:83-99` |
| 6 | Needs Analysis | Value to be Insured (Market / Replacement / Other / No changes) | Present. "No changes" not offered. | ⚠️ | `hrsConstants.js:91`, `StepRiskCategories.jsx:105-107` |
| 7 | Needs Analysis | Additional Circumstances relevant to Analysis (free text) | Present as "Risks / Items to be Included or Excluded" (renamed) plus separate "Additional Comments" further down. Two fields where one was expected. | ⚠️ | `StepRiskCategories.jsx:124-126`, `:186-188` |
| 8 | Needs Analysis | Specific objectives requested by client (free text) | Captured jointly in `clientNeeds` on Insurance History step; not two distinct fields. | ⚠️ | `StepInsuranceHistory.jsx:47-52` |
| 9 | Needs Analysis | Specific objectives agreed between client and advisor (free text) | Same as above — not a distinct field. | ⚠️ | Same |
| 10 | Needs Analysis | Client declined to provide any requested information (Yes/No) | Present and required. | ✅ | `hrsConstants.js:126-127`, `StepInsuranceHistory.jsx:50-55` |
| 11 | Needs Analysis | Election clause: differs / not follow / limited info + client initial + two numbered risk-warning paragraphs | Present with initials required when any option is selected; risk-warning paragraphs shown. | ✅ | `StepSignatures.jsx:102-125`, `hrsPdfGenerator.js:558-573` |
| 12 | Financial Information | Occupation / Pensioner | Occupation captured. "Pensioner" flag not offered. | ⚠️ | `StepClientDetails.jsx:51-53`. No `pensioner` field. |
| 13 | Financial Information | Monthly Income | Not captured on the Personal flow. | ❌ | Search: no `monthlyIncome` field in `hrsConstants.js`. |
| 14 | Financial Information | Amount available for Cover | Not captured. | ❌ | Search: no `amountAvailable` field. |
| 15 | Financial Information | Compulsory Excess Yes/No | Present. | ✅ | `StepRiskCategories.jsx:117-118` |
| 16 | Financial Information | Voluntary Excess High/Low/n/a | Present as select. | ✅ | `StepRiskCategories.jsx:108-110` |
| 17 | Financial Information | No Claims Bonus Yes/No | Present. | ✅ | `StepRiskCategories.jsx:120-122` |
| 18 | Financial Information | "In the event of renewal: No changes" | Not present as a distinct field. | ❌ | Not implemented. |
| 19 | Risk Profile (annexure) | Risks / Items to be Included or Excluded (free text) | Present, labelled correctly. | ✅ | `StepRiskCategories.jsx:124-126` |
| 20 | Product Comparison | Changes made by Insurer to Policy Terms (renewal) | Not present. | ❌ | Not implemented. |
| 21 | Recommendations | If FAIS / contractual limitation prevented recommendation, reasons | Not captured. | ❌ | No `limitationReason` field. |
| 22 | Recommendations | Products and Insurers Considered + Recommended checkbox column | Uses fixed 3-card layout, Option 3 hardcoded as recommended. Not a data table with a checkbox per row. | ⚠️ | `StepProductsAdvice.jsx:32-40` |
| 23 | Recommendations | Reasons why recommended products likely to satisfy needs | Captured as `recReasons`. | ✅ | `StepProductsAdvice.jsx:76-79` |
| 24 | Recommendations | Decisions made based on recommendations | Captured as `basisDecision`. | ✅ | `StepProductsAdvice.jsx:91-93` |
| 25 | Client Declaration | Two-way: accept advice / elect NOT to follow advice | Present via `declarationChoice`. | ✅ | `StepSignatures.jsx:143-183` |
| 26 | Client Declaration | Mandated wording (limited to STI personal, comprehensive analysis not undertaken, dangers of being underinsured, aggregation of excesses, read policy documents, advisor explained material terms, did not sign incomplete application form, advisor provided quotes, meaning of new/renewal/replacement) | Present within the "accept" option and in the PDF (`hrsPdfGenerator.js:575-582`). | ✅ | `StepSignatures.jsx:146-170` |
| 27 | Client Signature + Date, Advisor Signature + Date | Present. Note that under the current wizard, signatures are optional if DocuSign is used. | ✅ | `StepSignatures.jsx:220-238` |

### C.2 `ROA STI Commercial Lines.docx` — Commercial ROA template

Same field-set as Personal with commercial-specific cover types (Buildings Combined, Body Corporate, Office Contents, Business Interruption, Goods in Transit, Business All Risks, Employers Liability, Motor Traders, Machinery Breakdown, etc.). Implementation deviates the same way as Personal (no cover-type checkbox group; the wider set exists in the 27-item `COMMERCIAL_RISK_CATEGORIES` instead). All C.1 row numbers apply with equivalent findings, plus:

| # | Extra requirement | Implementation | Status |
|--:|---|---|:---:|
| C.2.1 | Company Name, Registration No., VAT No., Nature of Business | Present. | ✅ |
| C.2.2 | Business Description (broad free-text) | Captured as `natureOfBusiness` only. | ⚠️ Named narrowly. |
| C.2.3 | Business commercial-lines client declaration wording | Present. | ✅ |
| C.2.4 | Adviser Declaration signature block ("I declare that the advice record is an accurate and complete record …") | Present. | ✅ |
| C.2.5 | Replacement Policy (Yes/No, Like-for-Like, differences, exclusions, current/new insurer) | Present as its own step. Note: sub-fields not cleared when `replacingExisting` reverts to No — stale data can appear in output. | ⚠️ |

### C.3 `Broker Appointment (Client Mandate).pdf` — Moonstone template

| # | Source clause | Implementation | Status | Evidence |
|--:|---|---|:---:|---|
| C.3.1 | HRS appointment ("appoints Holistic Risk Services (Pty) Ltd") | Present. | ✅ | `StepPrinciples.jsx:117` |
| C.3.2 | Advisor Name (representative) — captured on document | Broker/Advisor selected from `ADVISORS` list; appears on Review/PDF. | ✅ | `StepClientDetails.jsx:91-94` |
| C.3.3 | Financial Services: buy/sell/terminate/replace, vary, admin, submit claims | Present verbatim in the appointment block. Broad reference to "financial products / investments" — retained from the source; would be worth HRS Compliance confirmation because this ROA workflow is strictly STI-scoped. | ⚙️ | `StepPrinciples.jsx:118-119` |
| C.3.4 | Client Information: confidentiality + third-party info authority (financial situation, product experience, objectives) | Present. | ✅ | `StepPrinciples.jsx:120-121` |
| C.3.5 | Commission transfer clause + broker-code transfer request | Present. | ✅ | `StepPrinciples.jsx:122-123` |
| C.3.6 | Duration: remains in force until cancelled in writing | Source says "until cancelled in writing" with no notice period. Implementation adds "30 days' notice by either party". | ⚙️ | `StepPrinciples.jsx:124`. **Compliance confirmation required — this deviates from the Moonstone-supplied template.** |
| C.3.7 | Client Details: Name, ID/Reg, Email, Contact | All present. | ✅ | Auto-populated from Step 1. |
| C.3.8 | Client + Advisor signatures | Present. | ✅ | Step 7 |
| C.3.9 | Investment/financial product references beyond STI | Source template mentions investments; wording retained in implementation. This ROA workflow is limited to STI Personal Lines / Commercial Lines / Personal Lines A1 per the Statutory Disclosure. | ⚙️ | `StepPrinciples.jsx:119` |

### C.4 `HRS Broker Fee Consent (2026).pdf`

| # | Source clause | Implementation | Status | Evidence |
|--:|---|---|:---:|---|
| C.4.1 | "IMPORTANT: This document only sets out your consent for the payment of broker fees for additional services … does not replace any other disclosures …" | Present verbatim. | ✅ | `StepPrinciples.jsx:87` |
| C.4.2 | 1. General clause (FSP 28582, remuneration by commission and fees, disclosure) | Present verbatim. | ✅ | `StepPrinciples.jsx:88-89` |
| C.4.3 | 1.1 Broker fees — the five itemised additional services (rejected claims / non-insurance value-added / onsite with assessors / advice outside regulated products / onsite visits at renewal) | Present verbatim. | ✅ | `StepPrinciples.jsx:90-98` |
| C.4.4 | 1.2 Broker fee amount — % of gross premium or flat R amount, inclusive of VAT, monthly | Present in wording, but the actual fee amount is captured in Step 3 and referenced. VAT wording present. | ✅ | `StepPrinciples.jsx:99-100` |
| C.4.5 | Explicit numeric fee value (% or R) recorded and acknowledged with the consent | Fee value is captured in Step 3 (Products & Advice) but is NOT visually restated next to the consent checkbox on Step 5. Client ticks consent without a fee figure visible in the same viewport. | ⚠️ | `StepPrinciples.jsx:104-106` — no visible fee value next to the ack. |
| C.4.6 | Consent expressed by tick / signature | Explicit `ackBrokerFee` required. | ✅ | `hrsConstants.js:145-146` |
| C.4.7 | Right to withdraw consent in writing | Present. | ✅ | `StepPrinciples.jsx:100-102` |
| C.4.8 | Fee-percentage vs flat-R type toggle | Present as `brokerFeeType` (`percent` / `fixed`). | ✅ | `StepProductsAdvice.jsx:52-64` |
| C.4.9 | Percentage is calculated from the recommended-option premium base (Option 3 = `prem2`) | Correct. | ✅ | `hrsPdfGenerator.js:382-386` |
| C.4.10 | Flat R value is not accidentally treated as a percentage | Correct in PDF and CRM. **Incorrect in the Personal submission email** — see Finding F-005. | ⚠️ | Personal email body: `AdviceRecord.jsx:143` — always emits `formData.brokerFeePercent + '%'` regardless of type. |
| C.4.11 | Fee consent optional when zero fee is charged | Currently mandatory (in the ack list) regardless of fee value. Business rule needs HRS confirmation. | ⚙️ | `hrsConstants.js:143` |
| C.4.12 | Blank / zero / negative / non-numeric fee handled | `parseFloat` used; NaN → 0. Negative not blocked in UI. | ⚠️ | `StepProductsAdvice.jsx:71-72` — `min="0"` set on the input but not enforced server-side. |

### C.5 `Let of Investigation.pdf`

| # | Source clause | Implementation | Status | Evidence |
|--:|---|---|:---:|---|
| C.5.1 | Full authority to obtain and verify information regarding STI policies | Present. | ✅ | `StepPrinciples.jsx:195` |
| C.5.2 | Risk details, underwriting information, personal info, claims history, premium records, material info | All listed. | ✅ | `StepPrinciples.jsx:196` |
| C.5.3 | Client obligation to disclose changes; HRS not liable for misrepresentation | Present. | ✅ | `StepPrinciples.jsx:197` |
| C.5.4 | Consent for HRS to obtain info from insurers/underwriters/other parties | Present. | ✅ | `StepPrinciples.jsx:198` |
| C.5.5 | Trigger — user confirmed the doc is required "only if the client is changing broker to HRS" | Implemented as conditional on `changingBroker === 'yes'`. Correct per user instruction. Should HRS Compliance also consider renewals/replacements/investigations without a broker change? | ⚙️ | `StepPrinciples.jsx:190-204`. **Requires compliance confirmation.** |
| C.5.6 | State clears / is ignored if `changingBroker` set to No after being Yes | State does NOT clear: `ackLetterOfInvestigation` remains `true` in `formData` after the user changes their answer from Yes to No. Validation and PDF branch on the current `changingBroker`, so it's not user-visible today, but if a future change references `ackLetterOfInvestigation` independently it will read stale. | ⚠️ | Finding F-008 |
| C.5.7 | Company name, policy number, date captured | Company name pulled from Step 1; policy number and date pulled from broker appointment table / signature date. Client name for Personal comes from title/initials/first/surname. | ✅ | `hrsPdfGenerator.js` renders context around this block. |

### C.6 `Statutory Disclosure HRS.pdf`

| # | Source clause | Implementation | Status | Evidence |
|--:|---|---|:---:|---|
| C.6.1 | FSP Licence Number 28582 | Present. | ✅ | `StatutoryDisclosureModal.jsx:81` |
| C.6.2 | Address (Postal & Physical): 16 Monte Carlo Crescent, Kyalami Business Park, 1684 | Present. | ✅ | `StatutoryDisclosureModal.jsx:82` |
| C.6.3 | Contact Person (Key Individual): Andrew Penney | Present. | ✅ | `StatutoryDisclosureModal.jsx:83` |
| C.6.4 | Telephone Number: **011 840 6000** | Modal displays 011 840 6000. **PDF footer of every generated ROA uses 010 447-9800** (from the Broker Fee Consent / Letter of Investigation source). **Conflict between source documents.** | ⚙️ | Source-doc conflict — HRS Compliance to confirm which is authoritative. See Finding F-010. |
| C.6.5 | Product supplier list (45 entries with phones) | Present in modal. | ✅ | `StatutoryDisclosureModal.jsx:6-30`, rendered `:89-95` |
| C.6.6 | Financial services authorised: 1.2 Personal Lines / 1.6 Commercial Lines / 1.23 Personal Lines A1 | Present. | ✅ | `StatutoryDisclosureModal.jsx:100` |
| C.6.7 | Compliance Officer: Moonstone Compliance, Mrs Monique Coetzee, Tel 071 997 5034, PO Box 12662, Die Boord, Stellenbosch, 7613 | Present. | ✅ | `StatutoryDisclosureModal.jsx:105` |
| C.6.8 | Professional Indemnity statement | Present. | ✅ | `StatutoryDisclosureModal.jsx:110` |
| C.6.9 | Disclosure of Interest and Remuneration (Conflict of Interest policy, 10% / 30% thresholds) | Present. | ✅ | `StatutoryDisclosureModal.jsx:115` |
| C.6.10 | Complaint Resolution System and Procedures | Present. | ✅ | `StatutoryDisclosureModal.jsx:120` |
| C.6.11 | Signing of Incomplete Documents caution | Present. | ✅ | `StatutoryDisclosureModal.jsx:125` |
| C.6.12 | Responsibility for correctness/completeness of information | Present. | ✅ | `StatutoryDisclosureModal.jsx:130` |
| C.6.13 | Waiver of Rights | Present. | ✅ | `StatutoryDisclosureModal.jsx:135` |
| C.6.14 | General (non-cash incentives, confidentiality) | Present. | ✅ | `StatutoryDisclosureModal.jsx:140` |
| C.6.15 | Client signature block on the disclosure itself | Not implemented as a discrete signature — captured as the general `ackStatutoryDisclosure` and rolled up into the ROA signatures. Compliance to confirm this is acceptable. | ⚙️ | Finding F-013 |
| C.6.16 | Version / effective date of the disclosure content | Not versioned. No date stamp on which disclosure text was accepted. | ⚠️ | Finding F-014 |
| C.6.17 | Full text in generated PDF (not just a checkbox) | The generated PDF has a **condensed summary** of the disclosure (`hrsPdfGenerator.js:512-517` ~7 lines), not the full modal text. The complete disclosure is only visible on-screen. | ❌ | Finding F-015 — **audit-trail gap**. |

### C.7 Source-document conflicts requiring HRS Compliance decision

| Item | Broker Appointment | Broker Fee Consent | Letter of Investigation | Statutory Disclosure | Current impl. |
|---|---|---|---|---|---|
| HRS switchboard phone | (not shown) | 010 447-9800 | 010 447 9800 | **011 840 6000** | Modal uses 011 840 6000; PDF footer uses 010 447-9800 |
| Directors formal name | (not shown) | Director: **Andrew** Penney, CE Brogden, CS Giles, TL Hodgson | Directors: **AC** Penney, CE Brogden, CS Giles, TL Hodgson | (not shown) | Not displayed in-app (only Andrew Penney as Key Individual) |
| Cancellation period on Broker Appointment | "until cancelled in writing" (no notice) | N/A | N/A | N/A | App adds "30 days' notice" — deviation |

---

## D. Findings Register

### D.1 CRITICAL

**F-001 — Resend API key env var name mismatch (silent email failure in production)**
- Source: `.env.example:7` sets `RESEND_API_KEY_R=`. `api/send-email.js:12` reads `process.env.RESEND_API_KEY`.
- Expected: if the operator follows `.env.example` and Vercel is provisioned accordingly, real emails send.
- Actual: `process.env.RESEND_API_KEY` is undefined, code hits the `if (!apiKey)` dev-mock branch (`api/send-email.js:13-19`) and returns `{ ok: true, id: 'dev-mock' }`. The UI treats this as a successful send. **No email is sent, no error is visible.**
- Runtime evidence: `res.ok === true` in `AdviceRecord.jsx:171` → `submitted = true`.
- Business impact: silent loss of every ROA submission until misconfigured env var is caught by user complaint.
- Minimal fix: pick one canonical name (recommend `RESEND_API_KEY`), align both files. Either add a startup check that logs a warning when the app is in production and the key is absent, or refuse the dev-mock path when `NODE_ENV === 'production'`.
- Acceptance test: (a) grep confirms the same name in `.env.example` and `send-email.js`; (b) in a production build with the key missing, `send-email.js` returns 500, not 200.
- Severity: **CRITICAL**. Compliance confirmation: not required.

**F-002 — Client banking details emailed in plain text (Personal flow)**
- Source: `src/pages/AdviceRecord.jsx:148-152`.
- Expected: sensitive PII (bank name, full account number, deduction amount, account type) is not transmitted in unencrypted email bodies.
- Actual: the Personal broker email body includes `Bank: … | Account: {formData.accountNumber} | Type: {formData.accountType}` and `Deduction: R{deductionAmount} on the {deductionDate}`.
- Runtime evidence: `AdviceRecord.jsx:148-152` in `body` template literal.
- Business impact: POPIA / privacy exposure; Resend, mail relay, spam filters, mail forwards and archives all see raw account numbers. This also creates a discovery liability if the broker inbox is ever compromised.
- Minimal fix: remove bank/account/deduction fields from the email body. The PDF attachment already contains these details behind an attachment, which is the intended channel.
- Acceptance test: grep the email body template — no `accountNumber`, `bankName`, `deductionAmount` references.
- Severity: **CRITICAL**. Compliance confirmation: Yes.

**F-003 — Submission email "acknowledgements completed" check is stale**
- Source: `src/pages/AdviceRecord.jsx:156-159`.
- Expected: after the compliance work, the check should include `ackStatutoryDisclosure` and `ackLetterOfInvestigation` (when applicable) and the declaration/election state.
- Actual: still checks only the original 8 acks: `ackPrinciples, ackAdvisor, ackClient, ackPopia, ackTermination, ackBrokerFee, ackBrokerAppointment, ackBrokerAuth`. `ackStatutoryDisclosure` and `ackLetterOfInvestigation` are missing. The client's declaration choice (accept vs decline) is also missing.
- Business impact: reports "All acknowledgements completed: Yes" even when the compliance-critical Statutory Disclosure and (conditional) Letter of Investigation acks are unticked. Recipient of the email is misled.
- Minimal fix: (a) add both acks to the boolean list, conditionally include `ackLetterOfInvestigation` only when `changingBroker === 'yes'`; (b) explicitly print the declaration outcome (`accept` / `decline`) and the three election flags.
- Acceptance test: bench-test a submission with `ackStatutoryDisclosure=false` — the email should read "No – some acknowledgements outstanding".
- Severity: **CRITICAL**. Compliance confirmation: not required for the fix; recommended to review the resulting broker email wording.

**F-004 — DocuSign anchor tabs use `anchorIgnoreIfNotPresent: 'true'` against uppercase-rendered anchor text**
- Source: `api/send-for-signature.js:128-175`; PDF header rendering in `hrsPdfGenerator.js:359` uses `d.text(label.toUpperCase(), …)`.
- Expected: anchor strings match the visible PDF text; if they don't, envelope creation should fail loudly, not silently omit signature tabs.
- Actual: anchors are `'Client Signature'` and `'Advisor / Broker Signature'` (mixed case), but the PDF renders them as `CLIENT SIGNATURE` / `ADVISOR / BROKER SIGNATURE` (title-cased then upper-cased). DocuSign's default anchor matching is case-insensitive but options exist that could change that. `anchorIgnoreIfNotPresent: 'true'` means an envelope will succeed with no signature tabs if the anchor cannot be found.
- Business impact: potential for envelopes to be sent to clients without any signature field, resulting in a "completed" envelope with no actual signature — a compliance and evidence gap. This has not been observed empirically here because I did not test against DocuSign; I am flagging the code shape.
- Runtime evidence: unverified in this audit (no DocuSign call performed).
- Minimal fix: verify empirically in DocuSign sandbox that anchor matching is case-insensitive with these strings; if in doubt, either (a) change `anchorIgnoreIfNotPresent` to `'false'` so envelope creation fails when anchors miss, or (b) render the PDF anchor headings in the exact case used in the anchor string.
- Acceptance test: in DocuSign sandbox, create an envelope with a PDF whose anchor text is deliberately corrupted; envelope creation must fail rather than silently produce a signable envelope with no tab.
- Severity: **CRITICAL**. Compliance confirmation: Yes — signed record must have a signature.

**F-005 — No durable, retrievable storage of the completed ROA**
- Source: `AdviceRecord.jsx:112-198`, `CommercialAdviceRecord.jsx:149-215`, `crmSync.js`.
- Expected: after "submission", HRS can retrieve the exact signed ROA, the client's declaration choice, the acknowledgement snapshot, and the audit trail on demand.
- Actual: submission does three things — (1) emails the PDF to the broker; (2) fire-and-forget CRM sync of a subset of fields (creates a Client record and a Deal record); (3) marks `submitted = true` in local component state. No copy of the PDF is stored server-side, no record of *which acknowledgements were ticked*, no record of the declaration choice, no envelope-status polling. If the broker inbox loses the email and the client hasn't downloaded, the ROA is gone.
- Runtime evidence: `crmSync.js` only records `client_name`, `id_number`, address, `proposed_insurer`, `broker_commission_pct`, `estimated_premium` — not the PDF, not the acknowledgements, not the declaration.
- Minimal fix (short-term): also upload the PDF and a JSON snapshot of the acknowledgements to Supabase Storage (or an equivalent) keyed by client id, before returning success.
- Acceptance test: after submission, an admin should be able to retrieve the exact ROA PDF and the acknowledgement JSON for that submission from a durable store.
- Severity: **CRITICAL**. Compliance confirmation: Yes — FAIS record-keeping obligations.

### D.2 HIGH

**F-006 — Commercial flow has no draft persistence / restore**
- Source: `CommercialAdviceRecord.jsx` — no `sessionStorage`, no `readSession`/`writeSession`/`clearSession`, no restore banner. Personal has all of these (`AdviceRecord.jsx:22-80`).
- Expected: parity with Personal draft handling to protect against accidental refresh / navigation.
- Actual: any refresh on Commercial resets the entire wizard.
- Business impact: commercial ROAs are typically longer (Client Details includes company, VAT, contact person, replacement policy). One accidental refresh wipes the work.
- Minimal fix: extract `readSession/writeSession/clearSession` into a shared utility keyed per-flow (`hrs_roa_draft_personal` vs `hrs_roa_draft_commercial`) so drafts don't collide, and wire the same restore banner into `CommercialAdviceRecord.jsx`.
- Acceptance test: fill in Commercial to step 3, refresh, restore banner appears, click Continue, data intact.
- Severity: **HIGH**. Compliance confirmation: not required.

**F-007 — Personal submission email displays broker-fee as `%` even when type is `fixed`**
- Source: `src/pages/AdviceRecord.jsx:143`.
- Expected: if `brokerFeeType === 'fixed'`, the email should show `R <amount>`. If `percent`, then `<percent>%`.
- Actual: `Broker Fee: ${formData.brokerFeePercent ? formData.brokerFeePercent + '%' : '-'}` — the string always appends `%` regardless of type. The PDF, review page, and CRM sync all handle the branch correctly; only the email is wrong.
- Business impact: broker inbox misinterprets flat-R fees as percentage-of-premium fees.
- Minimal fix: use the same computed `feeStr` pattern as `hrsPdfGenerator.js:384-386`.
- Acceptance test: submit a Personal ROA with `brokerFeeType = 'fixed'`, `brokerFeePercent = '350'` — email must read `R 350.00`, not `350%`.
- Severity: **HIGH**. Compliance confirmation: not required.

**F-008 — Stale hidden state retained after conditional sections are hidden**
- Source: `StepPrinciples.jsx:190-204` (Personal), `CommercialStepPrinciples.jsx:240-254`, `CommercialStepReplacementPolicy.jsx:44-92`.
- Expected: when a Yes/No toggle switches from Yes back to No, any dependent fields it revealed should either be cleared or explicitly ignored downstream.
- Actual: `ackLetterOfInvestigation` remains `true` in `formData` if the user first ticked it and then answered No. Same for `likeForLike`, `mainDifferences`, `exclusions`, `replacementReason`, `currentInsurer`, `newInsurer` in Commercial Replacement Policy. Currently the PDF and Review guard against this by branching on the parent toggle, and validation is correct — so it is not a user-visible defect *today*, but it is a footgun for any future consumer of the state (email body extensions, CRM sync additions).
- Business impact: latent, low-probability data-quality bug. Adding a new consumer of `ackLetterOfInvestigation` today would incorrectly report it as acknowledged.
- Minimal fix: when the parent toggle turns off, reset the child fields to their initial values (either via a callback in each step, or centrally in a small `withResetChildren` helper).
- Acceptance test: tick "changing broker = Yes", tick Letter of Investigation ack, change "changing broker = No", inspect `formData` — `ackLetterOfInvestigation` should be `false`.
- Severity: **HIGH**. Compliance confirmation: not required.

**F-009 — Session draft has no TTL and no per-flow key**
- Source: `AdviceRecord.jsx:23` — `SESSION_KEY = 'hrs_roa_draft'`. Same literal will be used by any future Commercial implementation of the same feature.
- Expected: draft key per-flow, TTL bounded (e.g. 24h), signature images excluded from persistence.
- Actual: draft is Personal-only; if a broker starts a Personal ROA, then opens a Commercial one, and the future Commercial impl uses the same key, they will overlap. Signature images already excluded (good). No TTL — a draft can linger indefinitely.
- Business impact: two brokers sharing a workstation could see each other's client draft data appear on load.
- Minimal fix: (a) namespace the key (`hrs_roa_draft_personal`); (b) write a timestamp with the draft; (c) reject drafts older than a defined TTL (recommend 24h) on restore.
- Acceptance test: verify no Personal/Commercial collision after F-006 fix; drafts older than TTL prompt "Discard".
- Severity: **HIGH**. Compliance confirmation: not required.

**F-010 — HRS switchboard telephone number inconsistent between disclosure and PDF footer**
- Source: Statutory Disclosure says `011 840 6000`; Broker Fee Consent, Letter of Investigation, and both PDF footers say `010 447-9800`.
- Expected: single, authoritative HRS switchboard number.
- Actual: the two numbers appear on different pages of the same generated ROA.
- Business impact: client confusion; slight compliance risk if the disclosed FSP contact number is wrong.
- Minimal fix: HRS Compliance to nominate the authoritative number, then update `StatutoryDisclosureModal.jsx:84`, `hrsPdfGenerator.js:113`, `hrsCommercialPdfGenerator.js:108`, `StepSuccess.jsx:18` (and any print artefacts) from a single centralised constant (`HRS_CONTACT` in `hrsConstants.js`).
- Acceptance test: grep the repo for `011 840 6000` and `010 447` — only one number appears, and every place is imported from the same constant.
- Severity: **HIGH**. Compliance confirmation: **Yes**.

**F-011 — Broker Appointment adds a "30 days' notice" cancellation clause not in the Moonstone template**
- Source: `Broker Appointment (Client Mandate).pdf` — clause reads "until cancelled by the client or the provider in writing". Implementation: `StepPrinciples.jsx:124` and `hrsPdfGenerator.js:501` add "with 30 days' notice by either party".
- Expected: verbatim source wording, or explicit HRS sign-off for the added notice period.
- Actual: 30-day notice added.
- Business impact: unauthorised deviation from the compliance template.
- Minimal fix: either remove the "30 days" phrase, or obtain and record HRS Compliance sign-off in the audit trail.
- Acceptance test: after decision, the Broker Appointment wording in `StepPrinciples.jsx`, `CommercialStepPrinciples.jsx`, both PDF generators, and the modal display all match the authorised text.
- Severity: **HIGH**. Compliance confirmation: **Yes**.

**F-012 — No duplicate-submission protection**
- Source: `AdviceRecord.jsx:112-198`, `CommercialAdviceRecord.jsx:149-215`.
- Expected: submitting twice within the same session should either be blocked or de-duplicated (same envelope id, same email id, same CRM deal id).
- Actual: `isSubmitting` gates the button while in flight, but on failure (or if the user reloads and re-navigates via the sessionStorage restore), a second submit will create a duplicate CRM deal and re-send the email. CRM `checkDuplicate` uses `id_number + email` and returns the existing client — but always creates a new Deal (`crmSync.js:95-106`).
- Business impact: duplicate emails, duplicate CRM deals.
- Minimal fix: on submit, record the CRM `dealId` in state and refuse a second submit until either success or explicit reset; deduplicate by (client_id, sig_date) at CRM if possible.
- Acceptance test: click Submit twice quickly on Personal — only one CRM deal created.
- Severity: **HIGH**. Compliance confirmation: not required.

### D.3 MEDIUM

**F-013 — Statutory Disclosure signature block from source not mapped to a discrete client signature.** The source PDF has a "Signed for and on behalf of the Client — Signature / Name / At / Date" block on page 3. Implementation collapses this into the single ROA client signature. Compliance to confirm this is acceptable (many FSPs sign the disclosure separately). Evidence: `Statutory Disclosure HRS.pdf`, lines 148-153 of extracted text; app has no dedicated signature block for the disclosure.

**F-014 — Statutory Disclosure content is not versioned.** No date / version identifier stored with the ack. If HRS updates the wording, historical records won't indicate which text version was accepted. Recommend adding a `STATUTORY_DISCLOSURE_VERSION = '2026-07'` constant and storing that with `ackStatutoryDisclosure` in the submitted payload.

**F-015 — Generated PDF contains a condensed summary of the Statutory Disclosure, not the full text.** `hrsPdfGenerator.js:511-517` renders a ~7-line summary. Audit-trail should have the full disclosure text the client saw. Recommend the PDF include either the full disclosure text or a versioned reference (e.g. "Statutory Disclosure v2026-07 – reviewed and acknowledged in advice-record session on {date}").

**F-016 — CRM sync errors are not surfaced to the user.** `AdviceRecord.jsx:178-186` fires-and-forgets and only `console.warn` on failure. The user sees "Submitted" even if the CRM record was never created. Recommend either wait for CRM before showing success, or show a soft-warning that a retry is possible.

**F-017 — Auth token in URL query params is a leakage risk.** `AuthContext.jsx:13-14, 22-24` reads `access_token` and `refresh_token` from the URL and then calls `history.replaceState`. Anything that runs before `useEffect` (Vercel access logs, referrer headers on external asset requests, browser history before replace, extensions) still captures the token. Recommend a fragment-based handoff (`window.location.hash`) or a short-lived exchange endpoint. Also, the Login page is not visible in what I read here; ensure that page-not-found error routing does not expose the token.

**F-018 — Two-way declaration UI is radio-like but a future maintainer could re-implement as two AckRows.** Not a defect today because `declarationChoice` stores a single string and the two `DeclarationOption` buttons are mutually exclusive by writing to the same key. Recommend leaving a code comment explicit about this contract so future edits don't split it into two independent booleans.

**F-019 — `checkJs: true` in `jsconfig.json` excludes `src/lib` and `src/components/ui`.** Most business logic (PDF generators, constants, CRM sync) is not statically checked. Include `src/lib` in the `typecheck` sweep so `formData` shape and generator inputs are typed.

**F-020 — Commercial "SASRIA" premium row in checklist shows blank always (no data captured for it).** `CommercialStepChecklist.jsx:281-282`. Not blocking — but if HRS wants an actual SASRIA amount tracked, capture and populate it.

**F-021 — Existing `PostalAddress` field from Personal source template not implemented.** Only Physical/Risk address captured. Same address used for both.

**F-022 — "Renewal — Changes made by Insurer to Policy Terms" free-text from Personal source template not implemented.**

**F-023 — Preferred Insurers field from Personal source template not implemented.** Reasonable to argue the recommended-option workflow subsumes this, but the source template treats them as separate.

**F-024 — Products-considered captured as three fixed cards, not as an arbitrary-length list.** Some ROAs may compare more or fewer than three products; the template supports it. Not blocking.

### D.4 LOW

**F-025 — Personal `handleSubmit` string builder duplicates logic from PDF generator.** Bank/fee/reasons string built in two places (`AdviceRecord.jsx` and `hrsPdfGenerator.js`). Drift risk (see F-007). Consider a small `formatForEmail(formData)` helper alongside the PDF module.

**F-026 — CRM `checkDuplicate` swallows all errors.** `crmSync.js:16` — `catch { return null; }` means a network glitch on duplicate-check silently creates a duplicate.

**F-027 — Directors' names on source documents inconsistent (`Director: Andrew Penney …` vs `Directors: AC Penney …`).** Not currently displayed in-app; recommend HRS confirm authoritative form.

**F-028 — `dist/` in the shipped ZIP is 2 months stale.** Not a code defect — but if a Vercel misconfiguration ever falls back to the `dist/` in the repo it would ship the pre-compliance build. Recommend deleting `dist/` from the working tree in future distributions.

**F-029 — Legal wording is hard-coded verbatim into JSX components and PDF strings.** Any future compliance update requires editing at least 4–5 files (component + PDF generator × 2 flows) with high risk of drift. Recommend centralising every legal paragraph in `hrsConstants.js` as string constants and importing from one location.

**F-030 — HRS company details hard-coded across multiple files.** Address, phone, email, website, FSP number, key individual name appear in 6+ places. Recommend a single `HRS_INFO` constant.

**F-031 — No test suite.** `package.json` has no `test` script and no `.test.*` files exist. Acceptance tests around the disclosure branches, fee calculation, and PDF section rendering are appropriate given the compliance surface area.

**F-032 — Personal `StepClientDetails` has both an unused `min` prop path and inconsistent placeholder examples between Personal and Commercial cards; cosmetic.**

**F-033 — `.env` is present in the extracted workspace folder.** Correctly `.gitignore`d and absent from repo history, so no secret is in git. But since the ZIP was extracted with the `.env` present, secrets exist on the reviewer's disk. Recommend rotating the Supabase anon key and any Resend / DocuSign keys currently in that `.env` file if there is any doubt about who has access.

### D.5 OBSERVATIONS

**O-001** — HEAD contains the compliance work; ZIP working-tree diff is pure CRLF noise. Please verify with your dev toolchain that the branch pushed to Vercel is `main` at `5bee780` (not an older SHA).

**O-002** — CRM API base URL is hard-coded to `https://crm.hrsinsurance.co.za/api`. Consider making this env-var driven so staging vs production separation is possible.

**O-003** — `beforeunload` prompt is disabled after submit (`AdviceRecord.jsx:57-61`). Correct behaviour. Recommend surfacing an explicit "Submitted at {timestamp}" line to reduce doubt.

**O-004** — Both flows call `window.scrollTo({ top: 0 })` on every step change. Nice touch.

**O-005** — The `SelectROA` landing page has no auth-check pathway for expired tokens; if a user's Supabase session expires while sitting on this page they see the placeholder logout link until the next navigation.

---

## E. Personal vs Commercial Comparison

| Area | Personal | Commercial | Verdict |
|---|---|---|---|
| Policy Type (New/Renewal/Replacement) | Present | Present | ✅ Parity |
| Existing insurer/policy field on Renewal/Replacement | Present | Present | ✅ Parity |
| Needs Analysis (Perils / Value / Excess / NCB) | Present | Present | ✅ Parity |
| Client declined info Yes/No | Present | Present | ✅ Parity |
| Statutory Disclosure modal + ack | Present | Present | ✅ Parity |
| Broker Fee Consent rewording (5 services) | Present | Present | ✅ Parity |
| Broker Appointment (Client Mandate rewording) | Present | Present | ✅ Parity |
| Letter of Investigation (conditional) | Present | Present | ✅ Parity |
| Two-way declaration (accept / decline) | Present | Present (business-appropriate wording) | ✅ Parity |
| Election clause + client initials | Present | Present | ✅ Parity |
| Session-storage draft + restore banner | Present | **Absent** | ⚠️ Missing parity — **F-006** |
| `beforeunload` guard | Present | Absent | ⚠️ Missing parity |
| Auto-signature-of-broker after CRM sync (nothing) | N/A | N/A | – |
| Number of acknowledgements | 8 core + 2 new = 10 | 9 core + 2 new = 11 (extra `ackIntermediaryAgreement`) | ⚙️ Intentional divergence — Commercial has an extra "Intermediary Agreement" duplicate of Advisor+Client obligations. Consider consolidating. |
| Risk-category "Flag as important" toggle | Present | **Absent** | ⚠️ Unintentional divergence — was present in Commercial's earlier code and appears to have been left behind. If desired, add. |
| Checklist "Additional Confirmation" items | 7 items | 9 items (adds Company Reg Docs, Proof of Business Assets) | ✅ Intentional divergence |
| PDF section numbering | 1–9 | 1–9 (with 5 = Principles/Disclosures, 6 = Needs Analysis, 7 = Client Declaration, 8 = Signatures, 9 = Risk Categories) | ✅ Intentional divergence — Commercial's runtime step order differs from the shared PDF layout |
| Submission email body — fee display | Broken (`F-007`) | Correct (`brokerFeeType` handled) | ⚠️ Personal defect only |
| Submission email — bank details | Present (`F-002`) | Not applicable (no banking step in Commercial) | ⚠️ Personal defect only |
| Submission email — acks completeness | Stale (`F-003`) | Not present at all in Commercial email body | ⚠️ Different defect on each side |

**Mixed wording watchouts:**
- The Commercial signatures step's Client Declaration ("I acknowledge that as a client, no product provider or FSP may request or induce me to waive any right") differs materially from Personal's declaration. The templates support this — but the reviewer should confirm the Commercial version is the authorised commercial-lines wording.

---

## F. PDF & DocuSign Results

**No PDFs were generated** by this audit — the sandbox lacks the Windows-installed Node modules needed to run the Vite/Vitest pipeline for jsPDF in isolation, and I did not want to trigger real DocuSign envelopes. The following results are code-review-only.

### F.1 PDF (code-review inspection)

| Scenario | Result | Evidence |
|---|---|---|
| Policy Type: New placement | Rendered as `Policy Type: New placement` in Section 1 | `hrsPdfGenerator.js:402` |
| Policy Type: Renewal + existing insurer | Both fields render on the same row | `hrsPdfGenerator.js:402` |
| Policy Type: Replacement | Same | Same |
| Fee %: value + amount | Renders as `R 320.00 (10%)` (example) | `hrsPdfGenerator.js:384-386` |
| Fee fixed: value | Renders as `R 350.00` | Same |
| Fee: no fee | Renders as `-` | Same |
| Letter of Investigation applicable | Additional disclosure block appended | `hrsPdfGenerator.js:519-524` |
| Letter of Investigation not applicable | Block omitted | Same guard |
| Advice accepted | Section 8 heading is "I hereby accept the advice…" | `hrsPdfGenerator.js:574-578` |
| Advice declined | Section 8 heading is "I elect NOT to follow…" | Same |
| Limited-information election | Risk-warning block appears, initials required | `StepSignatures.jsx:99-125` |
| Long client name / address | jsPDF `splitTextToSize` handles wrapping | `hrsPdfGenerator.js:142-148` |
| All 16 Personal risk categories toggled | Rendered as 16 rows in Section 5 | `hrsPdfGenerator.js:444-455` |
| Statutory Disclosure completeness in PDF | **Only a condensed summary** — see F-015 | `hrsPdfGenerator.js:511-517` |
| Broker Appointment completeness | Present; deviates from source (adds 30-day notice) — see F-011 | `hrsPdfGenerator.js:501-504` |
| DocuSign envelope construction | Uses anchors that may not match uppercase heading — see F-004 | `send-for-signature.js:128-175` |
| Page-numbering | Handled by `_drawFooter → Page ${this.pageNum}` | `hrsPdfGenerator.js:114-115` |
| Mixed Personal / Commercial wording | Both flows import from their own PDF generator; wording is distinct | N/A |

### F.2 DocuSign (code-review inspection only — no live calls)

- Sandbox endpoint is hard-coded (`account-d.docusign.com`, `demo.docusign.net`). Production comment sits inline — swapping is a code change, not an env-var change. Recommend moving to env-var-driven selection.
- Recipient order is client → broker (`routingOrder: '1'` → `'2'`), correct.
- Missing DocuSign credentials trigger the dev-mock path — same silent-success pattern as F-001 for email. Recommend production hardening: if `NODE_ENV === 'production'` and credentials are missing, fail loudly.
- `anchorIgnoreIfNotPresent: 'true'` — see F-004.
- No envelope-ID persistence beyond component state. Reloading the checklist page loses the envelope id.
- No webhook / no polling — DocuSign envelope status is never fetched back. No "client signed" event captured, no signed PDF retrieved. This is a material evidence gap.
- No handling for declined / voided / expired envelopes.
- Reminders (1-day delay, 2-day frequency) and expiry (14 days, warn at 2 days) are set — sensible defaults.
- Certificate of Completion is not retrieved.

---

## G. Data, Security & Audit-Trail Review

**What IS persisted:**
- Personal draft in `sessionStorage` — client-side only, cleared on submit or discard.
- CRM Client record — subset of fields (no PDF, no acks).
- CRM Deal record — subset of fields.
- Broker inbox — email + PDF attachment (dependent on broker keeping the email).
- Client inbox — DocuSign email (if used).
- DocuSign envelope — third-party retention, no automated pull-back into HRS systems.

**What is NOT persisted anywhere:**
- The exact ROA PDF as submitted.
- The acknowledgement snapshot (which flags were ticked at time of submission).
- The declaration choice (accept vs decline).
- The election-clause state (differs / not follow / limited info) and client initials.
- The Statutory Disclosure version accepted.
- Any audit event stream (who submitted, when, from what IP).
- The signed / countersigned final PDF from DocuSign.

**Distinct states currently conflated as "submitted":**
| State | Current signal | Correctness |
|---|---|---|
| Email sent | `POST /api/send-email` returned 200 | ⚠️ May be a dev-mock (F-001) |
| CRM synced | fire-and-forget | ⚠️ Failure invisible (F-016) |
| Checklist completed | local component state | ⚠️ Not persisted; refresh loses it |
| PDF downloaded | local component state | ⚠️ Not persisted |
| DocuSign sent | envelope id in local state | ⚠️ No status tracking |
| Client signed | not tracked | ❌ Not visible |
| Advisor signed | not tracked | ❌ Not visible |
| Final signed doc stored | not implemented | ❌ Not stored |

**Recommendation:** treat submission as a multi-stage state machine with explicit substatus (`email_sent`, `crm_synced`, `envelope_sent`, `envelope_signed`, `stored`), persist state server-side, and only show the client-facing "Advice Record Submitted" once the durable-store stage completes.

**Security review:**
- `.env` gitignored, absent from history, present on reviewer's disk in the extracted ZIP. Recommend rotating any secrets in that file.
- Supabase anon key is client-side (correct pattern).
- Resend key server-side only (correct pattern — but env var name mismatch in F-001).
- DocuSign JWT credentials server-side only (correct pattern).
- Token-in-URL handoff in `AuthContext.jsx` — see F-017.
- No rate limiting on `/api/send-email` or `/api/send-for-signature`. Abuse potential (though inside an authenticated app, the surface is limited).
- CRM auth uses Supabase session `access_token` as Bearer — correct if CRM validates it.

---

## H. UX Improvements (minimal-layout only)

Ordered by impact.

| # | Recommendation | Component | Priority | Acceptance test |
|---|---|---|---|---|
| U-1 | Show the fee value (e.g. "R 320.00 / month") beside the Broker Fee Consent ack | `StepPrinciples.jsx`, `CommercialStepPrinciples.jsx` | HIGH | Client sees the number they are consenting to. |
| U-2 | Clear stale child state when parent Yes/No flips (F-008) | Both flows | HIGH | See F-008 |
| U-3 | Add draft-restore banner to Commercial (F-006) | `CommercialAdviceRecord.jsx` | HIGH | Parity with Personal |
| U-4 | Namespace + TTL on sessionStorage draft key (F-009) | Both flows | HIGH | See F-009 |
| U-5 | Show which disclosure version was accepted, with a `v2026-07`-style tag on the Review page | `StepReview.jsx`, `CommercialStepReview.jsx`, PDF | MEDIUM | Displays version stamp next to the Statutory Disclosure ack |
| U-6 | Replace the "Submit Advice Record" text on the Review card with a two-state "Send to broker & sync to CRM" that reflects progress | Both flows | MEDIUM | Button text/state moves through stages |
| U-7 | Inline error banner on the ack step listing which of the compliance acks are outstanding, rather than one long toast | Both flows | MEDIUM | Errors show as a red bulleted list at the top of the current form card |
| U-8 | Auto-populate `existingPolicyRef` label with the client's current insurer when Policy Type = Renewal (nicer prompt) | `StepClientDetails.jsx` | LOW | Placeholder reflects context |
| U-9 | Add "Copy to Personal from Company Contact" button on Commercial Client Details for the contact ID/email/cell | `CommercialStepClientDetails.jsx` | LOW | One-click populate |
| U-10 | Centralise HRS company info + all legal wording into `hrsConstants.js` and import across components / PDF (F-029, F-030) | `hrsConstants.js` + all step files + PDF generators | LOW | Grep for the FSP number: only one string literal in the whole tree |
| U-11 | On the Statutory Disclosure modal, on mobile: reduce padding and make the scroll gate more forgiving on small viewports where the content already fits | `StatutoryDisclosureModal.jsx` | LOW | Modal usable at 375px width without clipping the CTA |
| U-12 | Prevent accidental duplicate submit (F-012) — disable Submit permanently after first 200 until Restart | `AdviceRecord.jsx`, `CommercialAdviceRecord.jsx` | HIGH | Two clicks send only one email |
| U-13 | Show submission timestamp on the post-submit Success/Checklist screen | `StepSuccess.jsx`, `StepChecklist.jsx` | LOW | Confidence signal |

Explicitly **not** recommended: new design system; framework migration; navigation redesign; shortening any of the compliance-required wording.

---

## I. Build & Test Results

**Environment used:** Linux sandbox mounted at the OneDrive folder from a Windows host. The `node_modules/` copied through OneDrive was installed on Windows and contains Windows binaries for `@rollup/rollup-*` and `@esbuild/*`, so a normal `npm run build` / `npm run lint` cannot execute in this sandbox without a full `npm install` reinstall, which the sandbox network policy repeatedly timed out on.

| Command | Result | Notes |
|---|---|---|
| `git status` / `git diff` (with CRLF-normalisation) | ✅ | Baseline in section B. |
| `npm ci` / `npm install` | ❌ (timeout in sandbox) | Sandbox network policy prevented a clean install within available time. Not a repo defect. |
| `npm run typecheck` | ⏸️ (not executed) | Blocked by dependency install. However, static inspection of `jsconfig.json` shows `src/lib` and `src/components/ui` are excluded (F-019), so typing does not cover the PDF generators or CRM sync. |
| `npm run lint` | ⏸️ (not executed) | ESLint started but did not complete within sandbox timeout. Manual inspection: no unused imports in the compliance-work files; existing `COMMERCIAL_STEPS` import in `CommercialAdviceRecord.jsx` was noted by the previous audit — I confirm it is still imported despite `STEPS_WITH_REVIEW` shadowing it (`CommercialAdviceRecord.jsx:12`), and `setE` in `CommercialStepReplacementPolicy.jsx:30` shadows an outer variable of the same name that is no longer used. Neither is a runtime defect. |
| `npm run build` | ⏸️ (not executed) | Blocked by dependency install. Manually verified: bracket/tag balance across 17 changed files is clean; JSX parity checks pass; import paths (e.g. `../StatutoryDisclosureModal`) resolve. |
| Bracket / tag balance | ✅ (custom script) | All 17 changed files balance parens, braces, brackets. |
| Manual read-through of 17 files | ✅ | No syntactic surprises. |

**Environmental limitations (not defects):**
- Sandbox proxy timed out on both `npm install @rollup/rollup-linux-x64-gnu --no-save` and `npm run lint`.
- Node.js in sandbox is v22.22.3; project's declared dev dependency is Vite 6 which supports it.

**Test coverage gaps (repo defect):**
- No test script in `package.json`.
- No `.test.*` files.
- Uncovered: fee-branch logic (percent vs fixed), disclosure conditional (changingBroker), declaration branch, election-initials required-if logic, PDF section render for renewal vs new placement, DocuSign envelope structure.

**Failures that are genuine repo defects (independent of sandbox):**
- F-001 (env var name mismatch) — verified by grep, not by execution.
- F-002 (banking in email) — verified by reading `AdviceRecord.jsx:148-152`.
- F-003 (stale ack list) — verified by reading `AdviceRecord.jsx:156-159`.
- F-007 (fee display in email) — verified by reading `AdviceRecord.jsx:143`.
- F-019 (`jsconfig.json` scope) — verified by reading `jsconfig.json`.

---

## J. Prioritised Remediation Plan

### J.1 Must fix before production

| # | Item | Files | Risk addressed | Complexity | Verification |
|---|---|---|---|---|---|
| 1 | Align `RESEND_API_KEY` env var name; fail loudly in production when missing | `api/send-email.js`, `.env.example` | F-001 | Small | Grep + production build with key omitted returns 500 |
| 2 | Remove banking details from Personal submission email body | `AdviceRecord.jsx` | F-002 | Small | Grep body template |
| 3 | Extend "acknowledgements completed" check to include `ackStatutoryDisclosure`, conditional `ackLetterOfInvestigation`, and declaration state | `AdviceRecord.jsx` | F-003 | Small | Bench-test submission with disclosure unticked |
| 4 | Verify DocuSign anchor matching against uppercase headings; fix or fail loudly | `send-for-signature.js`, PDF generators | F-004 | Medium | DocuSign sandbox with corrupt anchor must fail envelope create |
| 5 | Persist the completed ROA (PDF + acks + declaration + election + timestamp) to durable storage before showing success | New `submissions` table/bucket + `AdviceRecord.jsx`, `CommercialAdviceRecord.jsx` | F-005 | Medium | Admin can retrieve the exact ROA post-submit |
| 6 | Fix broker-fee `%` display in Personal email body | `AdviceRecord.jsx` | F-007 | Small | Fixed-R submission renders as `R X.XX` |
| 7 | Confirm and rectify HRS switchboard phone number across the app | `hrsConstants.js` (new HRS_INFO), all consumers | F-010 | Small | Grep — one number, one source |
| 8 | Confirm and rectify Broker Appointment cancellation clause | `hrsConstants.js`, `StepPrinciples.jsx`, `CommercialStepPrinciples.jsx`, PDF generators | F-011 | Small | Matches authorised text |

### J.2 Fix immediately after approval (before broader rollout)

| # | Item | Complexity | Verification |
|---|---|---|---|
| 9 | Add draft persistence + restore banner to Commercial flow | Small | Refresh mid-flow, resume |
| 10 | Namespace + TTL on session drafts | Small | Two flows do not collide |
| 11 | Clear stale child state when parent toggles Yes → No | Small | Fuzz-test toggles |
| 12 | Add duplicate-submission protection | Small | Two rapid submits → one email + one CRM deal |
| 13 | Include full Statutory Disclosure text (or versioned pointer) in generated PDF | Small | PDF section 7 shows full text + version tag |
| 14 | Persist Statutory Disclosure version + accepted timestamp with each submission | Small | Version stored, visible on review + PDF |

### J.3 Operational improvements

| # | Item | Complexity | Verification |
|---|---|---|---|
| 15 | Add DocuSign webhook / polling + status persistence + signed-PDF retrieval | Medium | Client signature triggers a stored signed-PDF |
| 16 | Environment-var-driven DocuSign sandbox vs production endpoint selection | Small | Env flip works without code change |
| 17 | Surface CRM sync failures to the user with retry | Small | Test with CRM offline |
| 18 | Centralise all legal wording into `hrsConstants.js` | Small | Grep — one source of truth per clause |
| 19 | Centralise HRS company/contact info into `HRS_INFO` constant | Small | Grep — one address, phone, email, FSP |
| 20 | Extend `jsconfig.json` typecheck to include `src/lib` | Small | `npm run typecheck` covers PDF generators |
| 21 | Add minimal test suite covering fee branches, disclosure conditionals, election branches, declaration branches, and PDF section render | Medium | `npm test` passes; coverage of the compliance surface |
| 22 | Move token-in-URL auth handoff to fragment or short-lived exchange | Medium | Access-token no longer in Vercel logs |
| 23 | Rate-limit `/api/send-email` and `/api/send-for-signature` | Small | Abuse test |

### J.4 Optional future improvements

| # | Item | Complexity |
|---|---|---|
| 24 | Implement missing Personal-source-template fields (Postal Address, Monthly Income, Amount available for Cover, Occupation vs Pensioner distinction, Preferred Insurers, Changes-at-Renewal free text, Products Considered as list) | Medium |
| 25 | Reinstate "Flag as important" toggle on Commercial risk categories for parity | Small |
| 26 | Consolidate the extra `ackIntermediaryAgreement` into the Advisor+Client Obligation acks (currently duplicates content) | Small |
| 27 | Provide a "Products & Insurers Considered" data table variant with a Recommended checkbox column (matches source template exactly), retaining the current three-card view as a shortcut | Medium |
| 28 | Add signed audit event stream (who/when/from-IP) | Medium |
| 29 | Remove stale `dist/` from repo/ZIP distribution | Small |
| 30 | Deprecate the "SASRIA" blank row in Commercial checklist Premium Summary, or capture a real value | Small |

---

## Final Notes

- No code was changed by this audit.
- No emails sent, no DocuSign envelopes created, no CRM records written.
- `.env` contents were not displayed.
- The previous `ROA_Audit.md` gap analysis was independently re-verified against the source documents and code; findings above supersede it.
- The recent implementation commit (`5bee780`) does address the four issues previously flagged as material (Policy Type, Needs Analysis, Election / two-way Declaration, Broker Fee & Client Mandate rewording, Statutory Disclosure & Letter of Investigation) at the content level; the gaps this audit surfaces are in the surrounding evidence chain (email, DocuSign anchor matching, durable storage, versioning) rather than in the compliance content itself.
- Every material finding above cites file + line evidence, so remediation can be tackled surgically without a broader refactor.

**End of audit.**
