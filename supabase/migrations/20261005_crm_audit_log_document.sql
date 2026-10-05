-- ROA post-production polish: track the CRM document that holds the Documenso signing
-- audit log (third evidence document after the signed ROA and certificate).
--
-- Additive only. Apply BEFORE deploying the matching HRSROA code, and only after the CRM
-- migration 020_add_roa_audit_log_evidence.sql and CRM deployment are live (the CRM contract
-- must accept the new `auditLog` evidence first). Do NOT apply to production automatically.
alter table public.roa_submissions
  add column if not exists crm_audit_log_document_id text;

-- Extend the existing least-privilege service_role grant for the one new column only.
grant update (crm_audit_log_document_id) on public.roa_submissions to service_role;

comment on column public.roa_submissions.crm_audit_log_document_id
  is 'CRM document id of the filed Documenso signing audit log; set by the server-side CRM sync.';
