-- ROA signing-provider migration.
--
-- Additive only. Keeps the existing DocuSign columns during migration so the
-- current provider remains a rollback path until Documenso staging acceptance
-- is complete.
--
-- Do NOT apply to production automatically.

alter table public.roa_submissions
  add column if not exists signing_provider text,
  add column if not exists signing_envelope_id text,
  add column if not exists signing_status text,
  add column if not exists signing_item_id text,
  add column if not exists signing_meta jsonb,
  add column if not exists audit_log_storage_path text,
  add column if not exists audit_log_sha256 text;

alter table public.roa_submissions
  drop constraint if exists roa_submissions_signing_provider_check;

alter table public.roa_submissions
  add constraint roa_submissions_signing_provider_check
  check (signing_provider is null or signing_provider in ('docusign', 'documenso'));

create index if not exists roa_submissions_signing_envelope_idx
  on public.roa_submissions (signing_provider, signing_envelope_id)
  where signing_envelope_id is not null;

comment on column public.roa_submissions.signing_provider
  is 'External signing provider used for this submission.';

comment on column public.roa_submissions.signing_envelope_id
  is 'Provider envelope/document identifier.';

comment on column public.roa_submissions.signing_item_id
  is 'Provider item/document identifier needed for signed-PDF retrieval.';

comment on column public.roa_submissions.signing_meta
  is 'Small provider metadata only; never store the canonical snapshot or signing secrets here.';

comment on column public.roa_submissions.audit_log_storage_path
  is 'Private ROA evidence path for provider audit-log PDF when available.';
