-- Follow-up signing requests are independent of immutable ROA revisions.
create table if not exists public.roa_followup_requests (
  id uuid primary key,
  submission_id text not null references public.roa_submissions(id) on delete restrict,
  advisor_email text not null,
  kind text not null check (kind in ('schedule','banking')),
  status text not null default 'draft' check (status in ('draft','sending','pending','completed','declined','failed')),
  signer_name text not null,
  signer_email text not null,
  source_path text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_size integer not null check (source_size between 512 and 12582912),
  signature_page integer,
  signature_x numeric,
  signature_y numeric,
  envelope_id text unique,
  envelope_item_id text,
  signed_path text,
  signed_sha256 text,
  certificate_path text,
  certificate_sha256 text,
  audit_path text,
  audit_sha256 text,
  proof_path text,
  proof_sha256 text,
  proof_content_type text,
  proof_access_hash text,
  crm_sync_status text,
  crm_sync_error text,
  crm_synced_at timestamptz,
  last_reminder_at timestamptz,
  sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roa_followup_evidence_pair check (
    (signed_path is null and signed_sha256 is null) or
    (signed_path is not null and signed_sha256 ~ '^[0-9a-f]{64}$')
  )
);
create index if not exists roa_followup_submission_idx
  on public.roa_followup_requests (submission_id, created_at desc);
create index if not exists roa_followup_owner_idx
  on public.roa_followup_requests (lower(advisor_email), created_at desc);
alter table public.roa_followup_requests enable row level security;
revoke all on public.roa_followup_requests from anon, authenticated;
grant select, insert, update on public.roa_followup_requests to service_role;
-- No direct browser policy or delete grant. Broker and recipient access is
-- checked by the HRSROA server before every operation.
