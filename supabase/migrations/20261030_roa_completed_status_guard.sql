-- ROA completed-lifecycle guard (follow-up to 20261029_roa_amendments.sql).
--
-- Defence in depth for the amendment work (Issue #8). The application now writes every
-- provider observation and every supersession step conditionally (status must still be open
-- and completed_at empty), so a stale read cannot overwrite a signed record. This trigger
-- makes the same promise in the database, independent of any code path, old build or manual
-- statement: once a signing request has completed, its lifecycle cannot move back.
--
--   * a row that is 'completed' (or already carries a completed_at) cannot be MOVED to any
--     other status — not 'awaiting_signature', 'voided', 'declined', 'expired',
--     'signature_failed', 'submitted';
--   * its signing_status cannot regress to a non-completed value either (a stale "pending"
--     observation must not sit next to a completed row).
--
-- It does not restrict anything else: a write that leaves the status alone is untouched, a
-- row whose completed_at was just recorded may still move on to 'completed', evidence
-- columns may still be filled in, and every other lifecycle change is untouched. (The
-- signed-evidence and completed_at write-once rules live in 20261029_roa_amendments.sql.)
--
-- Additive; applies independently. Apply it together with 20261029_roa_amendments.sql, BEFORE
-- the matching HRSROA build. Do NOT apply to production automatically.
--
-- Deliberate manual repair of a wrongly completed record (rare, by a database owner only):
--   alter table public.roa_submissions disable trigger roa_submissions_guard_completed_status;
--   ... the repair ...
--   alter table public.roa_submissions enable trigger roa_submissions_guard_completed_status;
--
-- Rollback (safe at any time; it only removes a check):
--   drop trigger if exists roa_submissions_guard_completed_status on public.roa_submissions;
--   drop function if exists public.roa_submissions_guard_completed_status();

create or replace function public.roa_submissions_guard_completed_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (old.status = 'completed' or old.completed_at is not null) then
    -- A write that leaves the status alone is fine (evidence, CRM bookkeeping, reminders);
    -- a write that CHANGES it may only change it to 'completed'.
    if new.status is distinct from old.status and new.status is distinct from 'completed' then
      raise exception 'roa_completed_status_immutable' using errcode = 'RA014';
    end if;
    if new.signing_status is distinct from old.signing_status
       and lower(coalesce(new.signing_status, '')) <> 'completed' then
      raise exception 'roa_completed_signing_status_immutable' using errcode = 'RA015';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists roa_submissions_guard_completed_status on public.roa_submissions;
create trigger roa_submissions_guard_completed_status
  before update on public.roa_submissions
  for each row execute procedure public.roa_submissions_guard_completed_status();
