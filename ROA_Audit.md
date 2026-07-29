# ROA System Audit — Attached Documents vs. Current App

Compares the four attached reference documents against the current HRS ROA app (`AI/ROA`), covering both Personal Lines and Commercial Lines flows. No code has been changed — this is the review requested before any implementation.

## Documents reviewed

- `ROA STI Personal Lines.docx` — FSCA/FAIS-style Record of Advice template, personal lines
- `ROA STI Commercial Lines.docx` — same template, commercial lines
- `Broker Appointment (Client Mandate).pdf` — Moonstone Compliance client mandate
- `HRS Broker Fee Consent (2026).pdf`
- `Let of Investigation.pdf` — Letter of Investigation (claims/underwriting info authority)
- `Statutory Disclosure HRS.pdf` — FSP Section 13-style statutory disclosure

## 1. Record of Advice structure — gaps present in BOTH Personal and Commercial flows

| Reference doc element | Current app | Gap |
|---|---|---|
| Policy Type: New placement / Renewal / Replacement | Not captured (Personal). Commercial only has a binary "replacing existing policy" Yes/No in the Replacement Policy step | No 3-way Policy Type selector anywhere |
| Needs Analysis: Cover Type × Perils to be Insured × Value to be Insured | App has one flat list of named risk categories with per-category Yes/No + SASRIA toggle | Missing the "Perils to be Insured" set (Theft/Fire/Destruction/Consequential Loss/3rd Party Liability/SASRIA/Other) and "Value to be Insured" (Market Value/Replacement Value/Other) as their own selections |
| "Client declined to provide any requested information" Yes/No | Not present | Missing entirely |
| Election clause — client elects to (a) conclude a transaction differing from the recommendation, (b) not follow advice, or (c) receive more limited information — with the two numbered risk-warning paragraphs and a client-initial box | Not present | Missing entirely — no way to record this election or capture initials |
| Client Declaration — final choice between "I hereby accept the advice..." **or** "I elect NOT to follow the advice..." | App only has an implicit accept (signature = acceptance); no explicit "I decline the advice but proceed anyway" path | Only one of the two mandated declaration options exists |
| Client Declaration — exact FAIS-mandated wording (comprehensive analysis not undertaken, dangers of being underinsured/excess aggregation, did not sign an incomplete application form, advisor provided/discussed/attached quotes, meaning of new/renewal/replacement) | App's declaration is a short generic paraphrase ("all information is true and accurate... read and accepted all terms") | Wording does not match the mandated clauses in the reference template |
| Compulsory Excess Yes/No, Voluntary Excess High/Low/n/a, No Claims Bonus Yes/No | Not captured (Banking step only has deduction amount/date) | Missing entirely |
| Risk Profile annexure — "Risks / Items to be Included or Excluded" | Only a generic "Additional Comments" free-text box | Present in spirit but not labelled/structured to match |
| Product Comparison — "Changes made by Insurer to Policy Terms" (renewal scenario) | Not present | Missing |
| "Products and Insurers Considered" table with a Recommended checkbox column | App uses 3 fixed option cards (Option 1/2/3), Option 3 hardcoded as recommended | Functionally similar, different format — acceptable if kept, but worth flagging |
| Occupation / **Pensioner** | Occupation captured; no Pensioner flag | Minor gap |

## 2. Documents with no equivalent in the app at all

- **Letter of Investigation** — authorizes HRS to obtain/verify risk, underwriting, claims history and premium information from insurers, with a misrepresentation/liability clause. No step, no acknowledgement, no signature capture for this anywhere in Personal or Commercial flows.
- **Statutory Disclosure** — FSP licence number, address, compliance officer name/contact (Moonstone Compliance, Monique Coetzee), full list of authorised product suppliers, professional indemnity statement, conflict-of-interest policy statement, complaints resolution procedure, "signing of incomplete documents" warning, "waiver of rights" warning. Currently this only exists as a line item on the internal paper checklist ("SEC 13 CERTIFICATE AND DISCLOSURE") — assumed handled outside the app. Nothing in-app discloses this information or captures client acknowledgement of it.

## 3. Documents partially present, wording/content differs

- **Broker Fee Consent** — app has a Broker Fee Consent block with an acknowledgement, but it doesn't list the specific "additional services" the reference document itemises (assistance with rejected claims/goodwill payment applications, facilitation of non-insurance value-added products, onsite attendance with assessors, advice outside regulated products, onsite visits at renewal), and doesn't capture the fee as an explicit %/R amount tied to a signed consent block the way the reference does (the fee % is captured elsewhere in Products & Advice, but not cross-referenced into this consent).
- **Broker Appointment / Client Mandate** — app's "Broker Appointment" and "Broker Authorisation" blocks cover similar ground (third-party info authorization, appointment as broker) but use different, less formal wording than the Moonstone Compliance Client Mandate template, and are missing the explicit "Financial Services" clause (authority to buy/sell/terminate/replace financial products and submit/process claims) and "Client Information" clause (confidentiality + authority to obtain third-party info to determine financial situation/objectives) as distinct labelled clauses.

## 4. Structural inconsistencies between Personal and Commercial (independent of the reference docs)

- Commercial has a 9th acknowledgement ("Intermediary Agreement") that Personal Lines doesn't have, largely duplicating the Advisor/Client Obligations already acknowledged separately.
- Personal Lines' Banking-step "Broker Appointment" mini-table has no legal text or acknowledgement attached to it; Commercial's equivalent is properly paired with legal text in the Principles step.
- Risk Categories: Personal has a "Flag as important" toggle per risk; Commercial does not.
- POPIA paragraph wording differs slightly between the on-screen component and the generated PDF in the Commercial flow.

## Summary

The app is a well-built wizard covering client details, insurance history, product recommendation, risk categories, banking, broker/POPIA/termination disclosures, and signatures — but it does not currently follow the specific FSCA/FAIS "Record of Advice" field structure and mandated declaration wording set out in the two attached `.docx` templates, and it's entirely missing the Letter of Investigation and Statutory Disclosure documents as in-app steps. The Broker Fee Consent and Broker Appointment sections exist but use different wording/detail than the attached reference PDFs.

No changes have been made yet. Next step is deciding scope and priority for closing these gaps (see follow-up question).
