-- CRM PASS 2: server-owned CRM sync state and filed document references.
-- Additive only. Apply to staging first; do not auto-apply to production.
alter table public.roa_submissions
  add column if not exists crm_sync_status text,
  add column if not exists crm_sync_error text,
  add column if not exists crm_sync_attempted_at timestamptz,
  add column if not exists crm_synced_at timestamptz,
  add column if not exists crm_signed_roa_document_id text,
  add column if not exists crm_certificate_document_id text;

alter table public.roa_submissions
  drop constraint if exists roa_submissions_crm_sync_status_check;
alter table public.roa_submissions
  add constraint roa_submissions_crm_sync_status_check
  check (crm_sync_status is null or crm_sync_status in ('partial', 'linked', 'failed'));

grant update (
  crm_client_id,
  crm_deal_id,
  crm_sync_status,
  crm_sync_error,
  crm_sync_attempted_at,
  crm_synced_at,
  crm_signed_roa_document_id,
  crm_certificate_document_id
) on public.roa_submissions to service_role;

create index if not exists roa_submissions_crm_sync_idx
  on public.roa_submissions (advisor_user_id, crm_sync_status, submitted_at desc);
