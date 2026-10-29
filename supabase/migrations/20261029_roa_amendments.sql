-- ROA amendments (Issue #8) — versioned, linear revision chain.
--
-- Additive only. Every existing row becomes "revision 1" through column defaults and
-- no existing column, constraint, policy or grant is altered or dropped.
--
-- ORDER OF OPERATIONS (see ROA_Amend_Deployment_and_Acceptance.md):
--   1. Apply this migration to STAGING and run the staging acceptance tests.
--   2. Apply it to production only after explicit approval — and BEFORE the matching
--      HRSROA build is deployed (the new build selects the new columns). The previous
--      build keeps working against the migrated schema, so code can be rolled back
--      without touching the database.
-- Do NOT apply to production automatically.
--
-- Rollback (destructive — only if NO revision >= 2 has been created yet):
--   drop function if exists public.roa_create_revision(text, text, text, uuid, text, text, jsonb, text, text, text, text, text, text, text, integer, text, text, text);
--   drop trigger if exists roa_submissions_guard_revision_update on public.roa_submissions;
--   drop trigger if exists roa_submissions_guard_revision_insert on public.roa_submissions;
--   drop function if exists public.roa_submissions_guard_revision_update();
--   drop function if exists public.roa_submissions_guard_revision_insert();
--   alter table public.roa_submissions
--     drop constraint if exists roa_submissions_revision_shape_check,
--     drop constraint if exists roa_submissions_amendment_reason_check,
--     drop constraint if exists roa_submissions_amendment_detail_check,
--     drop constraint if exists roa_submissions_parent_fk,
--     drop constraint if exists roa_submissions_supersedes_fk,
--     drop constraint if exists roa_submissions_superseded_by_fk;
--   drop index if exists roa_submissions_supersedes_uidx, roa_submissions_superseded_by_uidx,
--     roa_submissions_chain_revision_uidx;
--   alter table public.roa_submissions
--     drop column if exists revision_no, drop column if exists parent_submission_id,
--     drop column if exists supersedes_submission_id, drop column if exists superseded_by_submission_id,
--     drop column if exists amendment_reason, drop column if exists amendment_reason_detail,
--     drop column if exists amended_by, drop column if exists amended_at;

-- ============================================================================
-- 1. Columns
-- ============================================================================
--   revision_no                  1 for every legacy row and every first submission.
--   parent_submission_id         the chain root (revision 1); NULL on the root itself.
--   supersedes_submission_id     the immediately preceding revision.
--   superseded_by_submission_id  the immediately following revision (write-once).
--   amendment_reason(_detail)    mandatory for revision >= 2.
--   amended_by                   verified broker email, derived server-side.
--   amended_at                   database timestamp.

alter table public.roa_submissions
  add column if not exists revision_no integer not null default 1,
  add column if not exists parent_submission_id text,
  add column if not exists supersedes_submission_id text,
  add column if not exists superseded_by_submission_id text,
  add column if not exists amendment_reason text,
  add column if not exists amendment_reason_detail text,
  add column if not exists amended_by text,
  add column if not exists amended_at timestamptz;

comment on column public.roa_submissions.revision_no
  is 'Revision number within an amendment chain. 1 for the original submission and every legacy row.';
comment on column public.roa_submissions.parent_submission_id
  is 'Root (revision 1) submission of the chain. NULL on the root itself.';
comment on column public.roa_submissions.supersedes_submission_id
  is 'The revision this submission replaces. Unique: a revision has at most one successor.';
comment on column public.roa_submissions.superseded_by_submission_id
  is 'The revision that replaces this submission. Write-once; never changes this row''s own status or evidence.';
comment on column public.roa_submissions.amendment_reason
  is 'Reason code (required for revision >= 2).';
comment on column public.roa_submissions.amended_by
  is 'Verified broker email that created the revision; derived from the authenticated session, never from the request.';

-- ============================================================================
-- 2. Constraints
-- ============================================================================

alter table public.roa_submissions drop constraint if exists roa_submissions_parent_fk;
alter table public.roa_submissions
  add constraint roa_submissions_parent_fk
  foreign key (parent_submission_id) references public.roa_submissions (id);

alter table public.roa_submissions drop constraint if exists roa_submissions_supersedes_fk;
alter table public.roa_submissions
  add constraint roa_submissions_supersedes_fk
  foreign key (supersedes_submission_id) references public.roa_submissions (id);

alter table public.roa_submissions drop constraint if exists roa_submissions_superseded_by_fk;
alter table public.roa_submissions
  add constraint roa_submissions_superseded_by_fk
  foreign key (superseded_by_submission_id) references public.roa_submissions (id);

alter table public.roa_submissions drop constraint if exists roa_submissions_revision_shape_check;
alter table public.roa_submissions
  add constraint roa_submissions_revision_shape_check
  check (
    revision_no >= 1
    and (
      (revision_no = 1
        and parent_submission_id is null
        and supersedes_submission_id is null
        and amendment_reason is null
        and amendment_reason_detail is null
        and amended_by is null
        and amended_at is null)
      or
      (revision_no > 1
        and parent_submission_id is not null
        and supersedes_submission_id is not null
        and amendment_reason is not null
        and amended_by is not null
        and amended_at is not null)
    )
    and (parent_submission_id is null or parent_submission_id <> id)
    and (supersedes_submission_id is null or supersedes_submission_id <> id)
    and (superseded_by_submission_id is null or superseded_by_submission_id <> id)
  );

alter table public.roa_submissions drop constraint if exists roa_submissions_amendment_reason_check;
alter table public.roa_submissions
  add constraint roa_submissions_amendment_reason_check
  check (
    amendment_reason is null
    or amendment_reason in (
      'incorrect_contact_details',
      'incorrect_email',
      'spelling_correction',
      'change_in_cover_or_recommendation',
      'client_information_changed',
      'other'
    )
  );

alter table public.roa_submissions drop constraint if exists roa_submissions_amendment_detail_check;
alter table public.roa_submissions
  add constraint roa_submissions_amendment_detail_check
  check (
    (amendment_reason_detail is null or char_length(amendment_reason_detail) <= 500)
    and (
      amendment_reason is distinct from 'other'
      or char_length(btrim(coalesce(amendment_reason_detail, ''))) >= 3
    )
  );

-- ============================================================================
-- 3. Linear-chain guards (unique successor, unique revision number)
-- ============================================================================

-- A revision can be superseded by at most one revision, and replaces at most one.
create unique index if not exists roa_submissions_supersedes_uidx
  on public.roa_submissions (supersedes_submission_id)
  where supersedes_submission_id is not null;

create unique index if not exists roa_submissions_superseded_by_uidx
  on public.roa_submissions (superseded_by_submission_id)
  where superseded_by_submission_id is not null;

-- Revision numbers are unique inside one chain (the chain root is revision 1).
create unique index if not exists roa_submissions_chain_revision_uidx
  on public.roa_submissions (parent_submission_id, revision_no)
  where parent_submission_id is not null;

-- ============================================================================
-- 4. Trigger guards
--
-- INSERT: a revision >= 2 must extend the head of its chain, for the same broker and
--         ROA type, with the next revision number.
-- UPDATE: revision metadata is immutable; superseded_by_submission_id is write-once
--         and must point at a real successor; signed evidence and the first
--         completion timestamp can be set once and never rewritten or cleared.
-- ============================================================================

create or replace function public.roa_submissions_guard_revision_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  prev public.roa_submissions%rowtype;
begin
  if new.superseded_by_submission_id is not null then
    raise exception 'roa_revision_born_superseded' using errcode = 'RA008';
  end if;

  if new.revision_no = 1 then
    return new;
  end if;

  select * into prev
  from public.roa_submissions
  where id = new.supersedes_submission_id
  for update;

  if not found then
    raise exception 'roa_revision_predecessor_not_found' using errcode = 'RA001';
  end if;
  if lower(prev.advisor_email) <> lower(new.advisor_email) then
    raise exception 'roa_revision_owner_mismatch' using errcode = 'RA002';
  end if;
  if prev.roa_type <> new.roa_type then
    raise exception 'roa_revision_type_mismatch' using errcode = 'RA003';
  end if;
  if new.revision_no <> prev.revision_no + 1 then
    raise exception 'roa_revision_number_mismatch' using errcode = 'RA004';
  end if;
  if new.parent_submission_id is distinct from coalesce(prev.parent_submission_id, prev.id) then
    raise exception 'roa_revision_parent_mismatch' using errcode = 'RA005';
  end if;
  if prev.superseded_by_submission_id is not null then
    raise exception 'roa_revision_already_superseded' using errcode = 'RA006';
  end if;

  return new;
end;
$$;

drop trigger if exists roa_submissions_guard_revision_insert on public.roa_submissions;
create trigger roa_submissions_guard_revision_insert
  before insert on public.roa_submissions
  for each row execute procedure public.roa_submissions_guard_revision_insert();

create or replace function public.roa_submissions_guard_revision_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (new.revision_no, new.parent_submission_id, new.supersedes_submission_id,
      new.amendment_reason, new.amendment_reason_detail, new.amended_by, new.amended_at)
     is distinct from
     (old.revision_no, old.parent_submission_id, old.supersedes_submission_id,
      old.amendment_reason, old.amendment_reason_detail, old.amended_by, old.amended_at) then
    raise exception 'roa_revision_metadata_immutable' using errcode = 'RA010';
  end if;

  if old.superseded_by_submission_id is not null
     and new.superseded_by_submission_id is distinct from old.superseded_by_submission_id then
    raise exception 'roa_revision_link_write_once' using errcode = 'RA011';
  end if;

  if old.superseded_by_submission_id is null and new.superseded_by_submission_id is not null then
    perform 1
    from public.roa_submissions successor
    where successor.id = new.superseded_by_submission_id
      and successor.supersedes_submission_id = old.id
      and successor.revision_no = old.revision_no + 1
      and lower(successor.advisor_email) = lower(old.advisor_email);
    if not found then
      raise exception 'roa_revision_successor_mismatch' using errcode = 'RA012';
    end if;
  end if;

  -- Signed evidence is write-once: it may be filled in, never replaced or cleared.
  if (old.signed_pdf_storage_path is not null and new.signed_pdf_storage_path is distinct from old.signed_pdf_storage_path)
     or (old.signed_pdf_sha256 is not null and new.signed_pdf_sha256 is distinct from old.signed_pdf_sha256)
     or (old.certificate_storage_path is not null and new.certificate_storage_path is distinct from old.certificate_storage_path)
     or (old.certificate_sha256 is not null and new.certificate_sha256 is distinct from old.certificate_sha256)
     or (old.audit_log_storage_path is not null and new.audit_log_storage_path is distinct from old.audit_log_storage_path)
     or (old.audit_log_sha256 is not null and new.audit_log_sha256 is distinct from old.audit_log_sha256)
     or (old.completed_at is not null and new.completed_at is distinct from old.completed_at) then
    raise exception 'roa_signed_evidence_immutable' using errcode = 'RA013';
  end if;

  return new;
end;
$$;

drop trigger if exists roa_submissions_guard_revision_update on public.roa_submissions;
create trigger roa_submissions_guard_revision_update
  before update on public.roa_submissions
  for each row execute procedure public.roa_submissions_guard_revision_update();

-- ============================================================================
-- 5. Transactional revision creation
--
-- One statement from the server's point of view: lock the predecessor, verify it is
-- the head of the chain and owned by the caller, insert the next revision and write
-- the predecessor's forward link — all in one transaction. A retry with the same
-- p_new_id and identical content is a no-op that returns the existing row (and heals
-- a missing forward link); the same id with different content is rejected.
--
-- SECURITY INVOKER: it runs with the caller's (service_role's) table privileges, so
-- the column grants below remain the real access control. The email comparison is
-- case-insensitive because legacy rows may hold mixed-case addresses.
-- ============================================================================

create or replace function public.roa_create_revision(
  p_new_id text,
  p_supersedes_id text,
  p_owner_email text,
  p_advisor_user_id uuid,
  p_roa_type text,
  p_client_reference text,
  p_snapshot jsonb,
  p_template_version text,
  p_statutory_disclosure_version text,
  p_broker_appointment_version text,
  p_broker_fee_version text,
  p_letter_investigation_version text,
  p_pdf_sha256 text,
  p_pdf_storage_path text,
  p_pdf_byte_length integer,
  p_amendment_reason text,
  p_amendment_reason_detail text,
  p_amended_by text
)
returns public.roa_submissions
language plpgsql
set search_path = public, pg_temp
as $$
declare
  prev public.roa_submissions%rowtype;
  existing public.roa_submissions%rowtype;
  created public.roa_submissions%rowtype;
begin
  select * into prev
  from public.roa_submissions
  where id = p_supersedes_id
  for update;

  if not found or lower(prev.advisor_email) <> lower(p_owner_email) then
    raise exception 'roa_revision_predecessor_not_found' using errcode = 'RA001';
  end if;

  select * into existing from public.roa_submissions where id = p_new_id;
  if found then
    if existing.supersedes_submission_id is not distinct from p_supersedes_id
       and lower(existing.advisor_email) = lower(p_owner_email)
       and existing.roa_type = p_roa_type
       and existing.pdf_sha256 = p_pdf_sha256
       and existing.pdf_storage_path = p_pdf_storage_path
       and existing.pdf_byte_length = p_pdf_byte_length
       and existing.snapshot_json = p_snapshot
       and existing.amendment_reason is not distinct from p_amendment_reason
       and existing.amendment_reason_detail is not distinct from p_amendment_reason_detail then
      update public.roa_submissions
        set superseded_by_submission_id = p_new_id
        where id = p_supersedes_id and superseded_by_submission_id is null;
      select * into existing from public.roa_submissions where id = p_new_id;
      return existing;
    end if;
    raise exception 'roa_revision_id_conflict' using errcode = 'RA007';
  end if;

  if prev.superseded_by_submission_id is not null then
    raise exception 'roa_revision_already_superseded' using errcode = 'RA006';
  end if;
  if prev.roa_type <> p_roa_type then
    raise exception 'roa_revision_type_mismatch' using errcode = 'RA003';
  end if;

  insert into public.roa_submissions (
    id, roa_type, status, advisor_user_id, advisor_email, client_reference, snapshot_json,
    template_version, statutory_disclosure_version, broker_appointment_version, broker_fee_version,
    letter_investigation_version, pdf_sha256, pdf_storage_path, pdf_byte_length,
    revision_no, parent_submission_id, supersedes_submission_id,
    amendment_reason, amendment_reason_detail, amended_by, amended_at
  ) values (
    p_new_id, p_roa_type, 'submitted', p_advisor_user_id, lower(p_owner_email), p_client_reference, p_snapshot,
    p_template_version, p_statutory_disclosure_version, p_broker_appointment_version, p_broker_fee_version,
    p_letter_investigation_version, p_pdf_sha256, p_pdf_storage_path, p_pdf_byte_length,
    prev.revision_no + 1, coalesce(prev.parent_submission_id, prev.id), prev.id,
    p_amendment_reason, p_amendment_reason_detail, lower(p_amended_by), now()
  )
  returning * into created;

  update public.roa_submissions
    set superseded_by_submission_id = p_new_id
    where id = p_supersedes_id and superseded_by_submission_id is null;

  select * into created from public.roa_submissions where id = p_new_id;
  return created;
end;
$$;

-- ============================================================================
-- 6. Privileges
--
-- Only the forward link is updatable on the new columns; everything else about a
-- revision is insert-only. The function is callable by the server role only.
-- ============================================================================

grant update (superseded_by_submission_id) on public.roa_submissions to service_role;

revoke all on function public.roa_create_revision(
  text, text, text, uuid, text, text, jsonb, text, text, text, text, text, text, text, integer, text, text, text
) from public, anon, authenticated;

grant execute on function public.roa_create_revision(
  text, text, text, uuid, text, text, jsonb, text, text, text, text, text, text, text, integer, text, text, text
) to service_role;
