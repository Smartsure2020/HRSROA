-- Phase ROA-1 — durable ROA submission evidence.
--
-- Additive migration. Creates a new table (`roa_submissions`) and a new
-- private Storage bucket (`roa-pdfs`). Does not modify any existing table
-- (auth, storage.buckets policies apart from what this file explicitly
-- declares, HRS CRM tables, or any other app schema).
--
-- To apply locally / to staging:
--   supabase db push
-- or paste into the Supabase SQL editor and run.
--
-- Do NOT apply to production automatically.
--
-- Rollback (destructive — only if you are certain no evidence has been
-- written yet):
--   drop policy if exists "roa_submissions_owner_select" on public.roa_submissions;
--   drop policy if exists "roa_submissions_owner_insert" on public.roa_submissions;
--   drop policy if exists "roa_submissions_owner_update" on public.roa_submissions;
--   drop table if exists public.roa_submissions;
--   drop function if exists public.roa_submissions_touch_updated_at();
--   delete from storage.buckets where id = 'roa-pdfs';

-- ============================================================================
-- 1. Table
-- ============================================================================

create table if not exists public.roa_submissions (
  id text primary key,                             -- 'ROA-<uuid>'
  roa_type text not null check (roa_type in ('Personal', 'Commercial')),
  status text not null default 'submitted' check (status in (
    'submitted',
    'awaiting_signature',
    'completed',
    'declined',
    'voided',
    'expired',
    'signature_failed'
  )),
  advisor_user_id uuid not null,                   -- auth.users.id at submit
  advisor_email text not null,                     -- captured for audit
  client_reference text,                           -- display reference; may contain personal or company identity

  -- Frozen snapshot excluding signature dataURLs (those live in canonical.pdf).
  snapshot_json jsonb not null,

  -- Versions active at submit time — do not read the current constant later.
  template_version text not null,
  statutory_disclosure_version text not null,
  broker_appointment_version text not null,
  broker_fee_version text not null,
  letter_investigation_version text,

  -- Canonical PDF identity + storage.
  pdf_sha256 text not null,
  pdf_storage_path text not null,
  pdf_byte_length integer not null,

  -- DocuSign lifecycle.
  docusign_envelope_id text,
  docusign_status text,
  signed_pdf_storage_path text,
  signed_pdf_sha256 text,
  certificate_storage_path text,
  certificate_sha256 text,

  -- CRM references — do NOT copy CRM data here, just the ids.
  crm_client_id text,
  crm_deal_id text,

  -- Lifecycle timestamps.
  submitted_at timestamptz not null default now(),
  sent_for_signature_at timestamptz,
  completed_at timestamptz,
  evidence_retrieved_at timestamptz,               -- signed + certificate both present
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roa_submissions_advisor_idx
  on public.roa_submissions (advisor_user_id, submitted_at desc);

create index if not exists roa_submissions_envelope_idx
  on public.roa_submissions (docusign_envelope_id)
  where docusign_envelope_id is not null;

-- ============================================================================
-- 2. updated_at trigger
-- ============================================================================

create or replace function public.roa_submissions_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists roa_submissions_touch_updated_at on public.roa_submissions;
create trigger roa_submissions_touch_updated_at
  before update on public.roa_submissions
  for each row execute procedure public.roa_submissions_touch_updated_at();

-- ============================================================================
-- 3. Server-only evidence-table boundary
--
-- Browser clients do not read or mutate compliance evidence directly. All
-- access is: authenticated API -> service-role client -> table/storage.
-- ============================================================================

alter table public.roa_submissions enable row level security;

drop policy if exists roa_submissions_owner_select on public.roa_submissions;
drop policy if exists roa_submissions_owner_insert on public.roa_submissions;
drop policy if exists roa_submissions_owner_update on public.roa_submissions;

revoke all privileges on table public.roa_submissions from anon, authenticated, service_role;
grant select, insert on table public.roa_submissions to service_role;
grant update (
  status,
  docusign_envelope_id,
  docusign_status,
  signed_pdf_storage_path,
  signed_pdf_sha256,
  certificate_storage_path,
  certificate_sha256,
  crm_client_id,
  crm_deal_id,
  sent_for_signature_at,
  completed_at,
  evidence_retrieved_at
) on public.roa_submissions to service_role;

-- No DELETE grant/policy on purpose — ROA evidence is durable.

-- ============================================================================
-- 4. Storage bucket
--
-- Private bucket. All object reads/writes happen through authenticated server
-- endpoints using the service role; no direct browser access.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('roa-pdfs', 'roa-pdfs', false)
on conflict (id) do update set public = false;

-- Existing permissive Storage policies are combined with OR. A restrictive
-- policy is therefore required to keep browser roles out of this bucket even
-- when another project-wide policy permits access to storage.objects.
drop policy if exists roa_pdfs_server_only on storage.objects;
create policy roa_pdfs_server_only
  on storage.objects
  as restrictive
  for all
  to anon, authenticated
  using (bucket_id <> 'roa-pdfs')
  with check (bucket_id <> 'roa-pdfs');
