// Amend ROA (Issue #8) — the migration, EXECUTED.
//
// The endpoint tests use an in-memory mock of the revision function. This file proves the
// real thing: it applies every ROA migration, in order, to an in-process Postgres (PGlite)
// and then drives supabase/migrations/20261029_roa_amendments.sql the way the service role
// would — constraints, triggers, the transactional function and the privileges.
//
// Limits (stated, not hidden): PGlite is a single connection, so true parallel transactions
// are not exercised here. The "two tabs" guarantee rests on the function's `FOR UPDATE` lock
// plus the unique indexes, both of which ARE exercised (the indexes independently, below);
// real concurrency is a staging acceptance step.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const MIGRATIONS = [
  '20260914_roa_submissions.sql',
  '20260923_roa_signing_provider.sql',
  '20260930_crm_integration.sql',
  '20261005_crm_audit_log_document.sql',
  '20261029_roa_amendments.sql',
];
const sqlOf = (file) => readFileSync(path.join(process.cwd(), 'supabase/migrations', file), 'utf8');

// The slice of a Supabase project the migrations depend on.
const PLATFORM_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id serial primary key, bucket_id text);
`;

let db;

const id = (n) => `ROA-00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SHA = (c) => c.repeat(64);

const CREATE_REVISION = `
  select * from public.roa_create_revision(
    $1, $2, $3, $4::uuid, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
  )`;

function revisionArgs(n, supersedes, overrides = {}) {
  return {
    newId: id(n),
    supersedes: id(supersedes),
    owner: 'andrew@hrsinsurance.co.za',
    userId: '22222222-0000-4000-8000-000000000001',
    roaType: 'Personal',
    clientReference: 'Personal – Jane Doe',
    snapshot: { firstName: 'Jane', surname: 'Doe', email: `rev${n}@example.com` },
    versions: ['t', 's', 'b', 'f', null],
    sha: SHA(String(n % 10)),
    path: `${id(n)}/canonical.pdf`,
    bytes: 1000 + n,
    reason: 'incorrect_email',
    detail: null,
    amendedBy: 'andrew@hrsinsurance.co.za',
    ...overrides,
  };
}

async function createRevision(args) {
  const v = args.versions;
  return db.query(CREATE_REVISION, [
    args.newId, args.supersedes, args.owner, args.userId, args.roaType, args.clientReference,
    JSON.stringify(args.snapshot), v[0], v[1], v[2], v[3], v[4], args.sha, args.path, args.bytes,
    args.reason, args.detail, args.amendedBy,
  ]);
}

/** A first submission, inserted exactly as the existing create endpoint does (no new columns). */
async function insertRoot(n, overrides = {}) {
  const row = {
    id: id(n),
    roa_type: 'Personal',
    advisor_user_id: '11111111-0000-4000-8000-000000000001',
    advisor_email: 'andrew@hrsinsurance.co.za',
    snapshot_json: JSON.stringify({ firstName: 'Jane', surname: 'Doe', accountNumber: 'SENTINEL' }),
    pdf_sha256: SHA('a'),
    pdf_storage_path: `${id(n)}/canonical.pdf`,
    pdf_byte_length: 900,
    ...overrides,
  };
  await db.query(
    `insert into public.roa_submissions (id, roa_type, advisor_user_id, advisor_email, snapshot_json,
       template_version, statutory_disclosure_version, broker_appointment_version, broker_fee_version,
       pdf_sha256, pdf_storage_path, pdf_byte_length)
     values ($1, $2, $3::uuid, $4, $5::jsonb, 't', 's', 'b', 'f', $6, $7, $8)`,
    [row.id, row.roa_type, row.advisor_user_id, row.advisor_email, row.snapshot_json,
      row.pdf_sha256, row.pdf_storage_path, row.pdf_byte_length],
  );
  return row.id;
}

const rowOf = async (rowId) => (await db.query('select * from public.roa_submissions where id = $1', [rowId])).rows[0];
const count = async () => Number((await db.query('select count(*)::int as n from public.roa_submissions')).rows[0].n);

async function expectSqlError(promise, code) {
  let caught;
  try { await promise; } catch (error) { caught = error; }
  expect(caught, `expected SQLSTATE ${code}`).toBeTruthy();
  expect(caught.code).toBe(code);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(PLATFORM_STUBS);
  for (const file of MIGRATIONS) await db.exec(sqlOf(file));
});

beforeEach(async () => {
  await db.exec('reset role');
  await db.exec('truncate table public.roa_submissions cascade');
  await db.exec('set role service_role');
});

afterAll(async () => {
  await db?.close();
});

describe('migration', () => {
  it('re-applies cleanly (idempotent) on top of the existing schema', async () => {
    await db.exec('reset role');
    await db.exec(sqlOf('20261029_roa_amendments.sql'));
    await db.exec('set role service_role');
    const columns = (await db.query(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'roa_submissions'
         and column_name in ('revision_no','parent_submission_id','supersedes_submission_id',
           'superseded_by_submission_id','amendment_reason','amendment_reason_detail','amended_by','amended_at')`,
    )).rows.map((r) => r.column_name).sort();
    expect(columns).toHaveLength(8);
  });

  it('makes every existing submission revision 1 with no lineage, leaving its data alone', async () => {
    const rootId = await insertRoot(1);
    const row = await rowOf(rootId);
    expect(row).toMatchObject({
      revision_no: 1, parent_submission_id: null, supersedes_submission_id: null,
      superseded_by_submission_id: null, amendment_reason: null, amended_by: null, amended_at: null,
      status: 'submitted',
    });
    expect(row.snapshot_json.accountNumber).toBe('SENTINEL');
  });
});

describe('roa_create_revision', () => {
  it('creates the next revision and writes the forward link in one step', async () => {
    const root = await insertRoot(1);
    const { rows } = await createRevision(revisionArgs(2, 1, { reason: 'other', detail: 'Moved house' }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: id(2), revision_no: 2, parent_submission_id: root, supersedes_submission_id: root,
      superseded_by_submission_id: null, status: 'submitted', amendment_reason: 'other',
      amendment_reason_detail: 'Moved house', amended_by: 'andrew@hrsinsurance.co.za',
      advisor_email: 'andrew@hrsinsurance.co.za', pdf_storage_path: `${id(2)}/canonical.pdf`,
    });
    expect(rows[0].amended_at).toBeTruthy();
    expect((await rowOf(root)).superseded_by_submission_id).toBe(id(2));
  });

  it('never alters the original beyond its forward link — even a signed one', async () => {
    const root = await insertRoot(1, { advisor_email: 'Andrew@HRSInsurance.co.za' }); // legacy mixed case
    await db.query(
      `update public.roa_submissions set status = 'completed', signing_provider = 'documenso',
         signing_envelope_id = 'env-1', signing_status = 'completed', signed_pdf_storage_path = 'p/signed.pdf',
         signed_pdf_sha256 = $2, certificate_storage_path = 'p/cert.pdf', certificate_sha256 = $2,
         audit_log_storage_path = 'p/audit.pdf', audit_log_sha256 = $2,
         completed_at = '2026-09-02T10:00:00Z', evidence_retrieved_at = '2026-09-02T10:05:00Z'
       where id = $1`,
      [root, SHA('e')],
    );
    const before = await rowOf(root);
    await createRevision(revisionArgs(2, 1));
    const after = await rowOf(root);

    const strip = ({ superseded_by_submission_id: _l, updated_at: _u, ...rest }) => rest;
    expect(strip(after)).toEqual(strip(before));
    expect(after.superseded_by_submission_id).toBe(id(2));
    expect(after.status).toBe('completed');
    expect(after.snapshot_json).toEqual(before.snapshot_json);
    expect(after.pdf_sha256).toBe(before.pdf_sha256);
  });

  it('allows exactly one successor: a second revision of the same predecessor is refused', async () => {
    await insertRoot(1);
    await createRevision(revisionArgs(2, 1));
    const rows = await count();
    await expectSqlError(createRevision(revisionArgs(3, 1)), 'RA006');
    expect(await count()).toBe(rows);
  });

  it('keeps the chain linear and numbered: 1 → 2 → 3, always rooted at revision 1', async () => {
    const root = await insertRoot(1);
    await createRevision(revisionArgs(2, 1));
    const { rows } = await createRevision(revisionArgs(3, 2));
    expect(rows[0]).toMatchObject({ revision_no: 3, parent_submission_id: root, supersedes_submission_id: id(2) });
    expect((await rowOf(id(2))).superseded_by_submission_id).toBe(id(3));
    await expectSqlError(createRevision(revisionArgs(4, 2)), 'RA006'); // 2 is no longer the head
    await expectSqlError(createRevision(revisionArgs(5, 1)), 'RA006');
    expect(await count()).toBe(3);
  });

  it('is safe to retry: the same call returns the same revision and creates nothing more', async () => {
    await insertRoot(1);
    const args = revisionArgs(2, 1);
    const first = (await createRevision(args)).rows[0];
    const again = (await createRevision(args)).rows[0];
    expect(again.id).toBe(first.id);
    expect(again.amended_at).toEqual(first.amended_at);
    expect(await count()).toBe(2);
  });

  it('heals a missing forward link on retry (a non-transactional caller crashed half way)', async () => {
    await insertRoot(1);
    const args = revisionArgs(2, 1);
    await createRevision(args);
    await db.exec('reset role');
    await db.exec('alter table public.roa_submissions disable trigger roa_submissions_guard_revision_update');
    await db.exec(`update public.roa_submissions set superseded_by_submission_id = null where id = '${id(1)}'`);
    await db.exec('alter table public.roa_submissions enable trigger roa_submissions_guard_revision_update');
    await db.exec('set role service_role');
    expect((await rowOf(id(1))).superseded_by_submission_id).toBeNull();

    await createRevision(args);
    expect((await rowOf(id(1))).superseded_by_submission_id).toBe(id(2));
    expect(await count()).toBe(2);
  });

  it('refuses a reused revision id with different content', async () => {
    await insertRoot(1);
    await createRevision(revisionArgs(2, 1));
    await expectSqlError(createRevision(revisionArgs(2, 1, { sha: SHA('f') })), 'RA007');
    await expectSqlError(createRevision(revisionArgs(2, 1, { snapshot: { firstName: 'Other' } })), 'RA007');
    await expectSqlError(createRevision(revisionArgs(2, 1, { reason: 'spelling_correction' })), 'RA007');
  });

  it("treats another broker's ROA, and a missing one, as not found", async () => {
    await insertRoot(1);
    await expectSqlError(createRevision(revisionArgs(2, 1, { owner: 'werner@hrsinsurance.co.za' })), 'RA001');
    await expectSqlError(createRevision(revisionArgs(2, 99)), 'RA001');
    expect(await count()).toBe(1);
  });

  it('will not change the ROA type', async () => {
    await insertRoot(1);
    await expectSqlError(createRevision(revisionArgs(2, 1, { roaType: 'Commercial' })), 'RA003');
  });

  it.each([
    ['unknown reason', { reason: 'because' }],
    ['"other" with no note', { reason: 'other', detail: null }],
    ['"other" with a blank note', { reason: 'other', detail: '  ' }],
    ['an over-long note', { reason: 'incorrect_email', detail: 'x'.repeat(501) }],
  ])('rejects %s at the database', async (_name, overrides) => {
    await insertRoot(1);
    await expectSqlError(createRevision(revisionArgs(2, 1, overrides)), '23514');
    expect(await count()).toBe(1);
    expect((await rowOf(id(1))).superseded_by_submission_id).toBeNull();
  });

  it('is atomic: a failure after the insert leaves neither a revision nor a link', async () => {
    await insertRoot(1);
    // An over-long note fails the CHECK after the function has started; nothing may persist.
    await expectSqlError(createRevision(revisionArgs(2, 1, { detail: 'x'.repeat(501) })), '23514');
    expect(await rowOf(id(2))).toBeUndefined();
    expect((await rowOf(id(1))).superseded_by_submission_id).toBeNull();
    // ...and the predecessor is still amendable afterwards.
    await createRevision(revisionArgs(3, 1));
    expect((await rowOf(id(1))).superseded_by_submission_id).toBe(id(3));
  });
});

describe('guards that hold even when the function is bypassed', () => {
  const direct = (n, supersedes, overrides = {}) => {
    const row = {
      id: id(n), roa_type: 'Personal', owner: 'andrew@hrsinsurance.co.za', rev: 2,
      parent: id(1), supersedes: id(supersedes), reason: 'incorrect_email', detail: null,
      by: 'andrew@hrsinsurance.co.za', at: '2026-10-29T10:00:00Z', ...overrides,
    };
    return db.query(
      `insert into public.roa_submissions (id, roa_type, advisor_user_id, advisor_email, snapshot_json,
         template_version, statutory_disclosure_version, broker_appointment_version, broker_fee_version,
         pdf_sha256, pdf_storage_path, pdf_byte_length,
         revision_no, parent_submission_id, supersedes_submission_id, amendment_reason, amendment_reason_detail,
         amended_by, amended_at)
       values ($1, $2, '33333333-0000-4000-8000-000000000001'::uuid, $3, '{}'::jsonb, 't','s','b','f', $4, $5, 1,
         $6, $7, $8, $9, $10, $11, $12)`,
      [row.id, row.roa_type, row.owner, SHA('c'), `${row.id}/canonical.pdf`, row.rev, row.parent, row.supersedes,
        row.reason, row.detail, row.by, row.at],
    );
  };

  it('a revision must be the next number, same type, same owner, correctly rooted', async () => {
    await insertRoot(1);
    await expectSqlError(direct(2, 1, { rev: 3 }), 'RA004');
    await expectSqlError(direct(2, 1, { roa_type: 'Commercial' }), 'RA003');
    await expectSqlError(direct(2, 1, { owner: 'werner@hrsinsurance.co.za', by: 'werner@hrsinsurance.co.za' }), 'RA002');
    await expectSqlError(direct(2, 1, { parent: id(7) }), 'RA005'); // wrong root
    await expectSqlError(direct(2, 99, { parent: id(1) }), 'RA001'); // no such predecessor
    expect(await count()).toBe(1);
    await direct(2, 1); // the well-formed one is accepted
    expect(await count()).toBe(2);
  });

  it('two revisions of one predecessor cannot both exist, even before any link is written', async () => {
    await insertRoot(1);
    await direct(2, 1);
    await expectSqlError(direct(3, 1), '23505');
  });

  it('a revision must carry its reason, amender and timestamp; a first submission must not', async () => {
    await insertRoot(1);
    await expectSqlError(direct(2, 1, { reason: null }), '23514');
    await expectSqlError(direct(2, 1, { by: null }), '23514');
    await expectSqlError(direct(2, 1, { at: null }), '23514');
    await expectSqlError(
      db.query(
        `insert into public.roa_submissions (id, roa_type, advisor_user_id, advisor_email, snapshot_json,
           template_version, statutory_disclosure_version, broker_appointment_version, broker_fee_version,
           pdf_sha256, pdf_storage_path, pdf_byte_length, parent_submission_id)
         values ($1, 'Personal', '33333333-0000-4000-8000-000000000001'::uuid, 'andrew@hrsinsurance.co.za', '{}'::jsonb,
           't','s','b','f', $2, 'p', 1, $3)`,
        [id(5), SHA('c'), id(1)],
      ),
      '23514',
    );
  });

  it('a revision cannot be born already superseded', async () => {
    await insertRoot(1);
    await expectSqlError(
      db.query(
        `insert into public.roa_submissions (id, roa_type, advisor_user_id, advisor_email, snapshot_json,
           template_version, statutory_disclosure_version, broker_appointment_version, broker_fee_version,
           pdf_sha256, pdf_storage_path, pdf_byte_length, superseded_by_submission_id)
         values ($1, 'Personal', '33333333-0000-4000-8000-000000000001'::uuid, 'andrew@hrsinsurance.co.za', '{}'::jsonb,
           't','s','b','f', $2, 'p', 1, $3)`,
        [id(6), SHA('c'), id(1)],
      ),
      'RA008',
    );
  });

  it('revision metadata can never be updated, and only the forward link is writable', async () => {
    await insertRoot(1);
    await createRevision(revisionArgs(2, 1));
    for (const column of ['revision_no', 'parent_submission_id', 'supersedes_submission_id',
      'amendment_reason', 'amendment_reason_detail', 'amended_by', 'amended_at']) {
      const value = column === 'revision_no' ? '9' : column === 'amended_at' ? "'2000-01-01'" : "'x'";
      await expectSqlError(
        db.query(`update public.roa_submissions set ${column} = ${value} where id = $1`, [id(2)]),
        '42501',
      );
    }
  });

  it('the forward link is write-once and must point at a real successor', async () => {
    await insertRoot(1);
    await direct(2, 1);
    await expectSqlError(
      db.query('update public.roa_submissions set superseded_by_submission_id = $2 where id = $1', [id(1), id(99)]),
      'RA012', // no such successor
    );
    await insertRoot(3);
    await expectSqlError(
      db.query('update public.roa_submissions set superseded_by_submission_id = $2 where id = $1', [id(1), id(3)]),
      'RA012', // 3 does not actually supersede 1
    );
    await db.query('update public.roa_submissions set superseded_by_submission_id = $2 where id = $1', [id(1), id(2)]);
    await expectSqlError(
      db.query('update public.roa_submissions set superseded_by_submission_id = $2 where id = $1', [id(1), id(3)]),
      'RA011',
    );
    await expectSqlError(
      db.query('update public.roa_submissions set superseded_by_submission_id = null where id = $1', [id(1)]),
      'RA011',
    );
  });

  it('signed evidence and the first completion time can be filled in, never replaced or cleared', async () => {
    const root = await insertRoot(1);
    await db.query(
      `update public.roa_submissions set signed_pdf_storage_path = 'p/signed.pdf', signed_pdf_sha256 = $2,
         certificate_storage_path = 'p/c.pdf', certificate_sha256 = $2, audit_log_storage_path = 'p/a.pdf',
         audit_log_sha256 = $2, completed_at = '2026-09-02T10:00:00Z' where id = $1`,
      [root, SHA('1')],
    );
    // Re-writing the identical value (an idempotent retry) is fine.
    await db.query('update public.roa_submissions set signed_pdf_sha256 = $2, completed_at = $3 where id = $1',
      [root, SHA('1'), '2026-09-02T10:00:00Z']);

    for (const column of ['signed_pdf_storage_path', 'signed_pdf_sha256', 'certificate_storage_path',
      'certificate_sha256', 'audit_log_storage_path', 'audit_log_sha256']) {
      await expectSqlError(
        db.query(`update public.roa_submissions set ${column} = 'changed' where id = $1`, [root]),
        'RA013',
      );
      await expectSqlError(
        db.query(`update public.roa_submissions set ${column} = null where id = $1`, [root]),
        'RA013',
      );
    }
    await expectSqlError(
      db.query("update public.roa_submissions set completed_at = '2030-01-01' where id = $1", [root]),
      'RA013',
    );
    expect((await rowOf(root)).signed_pdf_sha256).toBe(SHA('1'));
  });

  it('normal lifecycle updates are unaffected', async () => {
    const root = await insertRoot(1);
    await db.query(
      `update public.roa_submissions set status = 'awaiting_signature', signing_provider = 'documenso',
         signing_envelope_id = 'env-1', signing_status = 'pending', signing_meta = '{"a":1}'::jsonb,
         sent_for_signature_at = now(), crm_client_id = 'c', crm_sync_status = 'partial' where id = $1`,
      [root],
    );
    await db.query("update public.roa_submissions set status = 'voided', signing_status = 'cancelled' where id = $1", [root]);
    await db.query("update public.roa_submissions set status = 'signature_failed', sent_for_signature_at = null where id = $1", [root]);
    expect((await rowOf(root)).status).toBe('signature_failed');
  });
});

describe('privileges', () => {
  it('browser roles can neither read the table nor call the function', async () => {
    await insertRoot(1);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await expectSqlError(db.query('select * from public.roa_submissions'), '42501');
      await expectSqlError(createRevision(revisionArgs(2, 1)), '42501');
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    expect(await count()).toBe(1);
  });

  it('the server role still cannot delete evidence', async () => {
    const root = await insertRoot(1);
    await expectSqlError(db.query('delete from public.roa_submissions where id = $1', [root]), '42501');
  });

  it('declares the function as invoker-rights with a pinned search_path', async () => {
    await db.exec('reset role');
    const { rows } = await db.query(
      `select prosecdef, proconfig from pg_proc where proname = 'roa_create_revision'`,
    );
    await db.exec('set role service_role');
    expect(rows).toHaveLength(1);
    expect(rows[0].prosecdef).toBe(false);
    expect(String(rows[0].proconfig)).toContain('search_path=public, pg_temp');
  });
});

describe('contract with the application', () => {
  it('every SQLSTATE the repository maps is raised by the migration, and vice versa', () => {
    const migration = sqlOf('20261029_roa_amendments.sql');
    const repo = readFileSync(path.join(process.cwd(), 'api/_lib/submissionRepo.js'), 'utf8');
    const raised = new Set([...migration.matchAll(/errcode = '(RA\d{3})'/g)].map((m) => m[1]));
    const mapped = new Set([...repo.matchAll(/^\s+(RA\d{3}):/gm)].map((m) => m[1]));
    for (const code of ['RA001', 'RA002', 'RA003', 'RA006', 'RA007']) {
      expect(raised.has(code), `${code} raised`).toBe(true);
      expect(mapped.has(code), `${code} mapped`).toBe(true);
    }
    for (const code of mapped) expect(raised.has(code), `${code} mapped but never raised`).toBe(true);
  });
});
