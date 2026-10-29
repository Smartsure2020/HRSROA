// Amend ROA (Issue #8) — structural contracts that must not regress silently.
// Static checks on the source and the migration: they cannot prove behaviour (the other
// amendment suites do that) but they stop a refactor quietly removing a safeguard.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');
/** Source without // line comments and block comments, so prose cannot satisfy a check. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function walk(dir) {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    return entry.isDirectory() ? walk(rel) : [rel];
  });
}

describe('Vercel Hobby function ceiling', () => {
  it('adds no serverless function: every amendment endpoint reuses an existing route', () => {
    const functions = walk('api')
      .filter((file) => file.endsWith('.js'))
      .filter((file) => !file.split('/').some((part) => part.startsWith('_')));
    expect(functions.sort()).toEqual([
      'api/roa-submissions/create.js',
      'api/roa-submissions/get.js',
      'api/roa-submissions/list.js',
      'api/roa-submissions/notify-email.js',
      'api/roa-submissions/pdf.js',
      'api/roa-submissions/reconcile-pending.js',
      'api/roa-submissions/refresh.js',
      'api/roa-submissions/send-for-signature.js',
      'api/roa-submissions/send-reminder.js',
      'api/roa-submissions/sync-crm.js',
      'api/send-email.js',
      'api/send-for-signature.js',
    ]);
    expect(functions).toHaveLength(12);
  });
});

describe('replacement gate wiring', () => {
  const handler = code('api/roa-submissions/send-for-signature.js');

  it('runs before any envelope can be reserved, created or distributed', () => {
    const gate = handler.indexOf('resolvePredecessorForReplacement({');
    expect(gate).toBeGreaterThan(-1);
    // Both provider paths: Documenso (sendViaDocumenso) and legacy DocuSign (reserve → POST).
    for (const sink of ['sendViaDocumenso({', 'reserveEnvelopeSlot(submissionId']) {
      const at = handler.indexOf(sink);
      expect(at, sink).toBeGreaterThan(-1);
      expect(gate, `gate before ${sink}`).toBeLessThan(at);
    }
  });

  it('a gate failure ends the request — it is never swallowed and followed by a send', () => {
    const block = handler.slice(handler.indexOf('resolvePredecessorForReplacement({'), handler.indexOf('const configuredProvider'));
    expect(block).toMatch(/catch \(err\)/);
    expect(block.match(/return res\.status/g)?.length).toBeGreaterThanOrEqual(2);
    expect(block).toMatch(/replacement_gate_failed/);
  });

  it('refuses to send a revision that has itself been superseded', () => {
    expect(handler).toMatch(/superseded_by_submission_id[\s\S]{0,200}submission_superseded/);
  });

  it('is the only code that creates or distributes a Documenso envelope', () => {
    const importers = (name) => walk('api').concat(walk('src'))
      .filter((file) => /\.(js|jsx)$/.test(file))
      .filter((file) => new RegExp(`\\b${name}\\b`).test(code(file)))
      .sort();
    expect(importers('sendViaDocumenso')).toEqual([
      'api/_lib/documensoSigning.js',
      'api/roa-submissions/send-for-signature.js',
    ]);
    expect(importers('createDocumensoEnvelope')).toEqual([
      'api/_lib/documensoClient.js',
      'api/_lib/documensoSigning.js',
    ]);
    // Deleting a provider envelope happens in exactly one place.
    expect(importers('deleteDocumensoEnvelope')).toEqual([
      'api/_lib/documensoClient.js',
      'api/_lib/supersession.js',
    ]);
  });

  it('verifies a cancellation by re-reading the envelope, never from the delete response alone', () => {
    const src = code('api/_lib/supersession.js');
    const del = src.indexOf('await deleteDocumensoEnvelope(');
    const verify = src.indexOf('await observeEnvelope(envelopeId)', del);
    const finalise = src.indexOf('return finaliseVoided({', verify);
    expect(del).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(del);
    expect(finalise).toBeGreaterThan(verify);
    // The intent is persisted before the provider is touched.
    expect(src.indexOf('await recordSupersessionIntent(predecessor.id, broker, { ...baseMeta, supersession })'))
      .toBeLessThan(del);
  });

  it('the status write that voids a request is a compare-and-swap on status and completion', () => {
    const repo = code('api/_lib/submissionRepo.js');
    const fn = repo.slice(repo.indexOf('export async function markSupersededVoided'));
    expect(fn).toMatch(/\.in\('status', SUPERSEDABLE_STATUSES\)/);
    expect(fn).toMatch(/\.is\('completed_at', null\)/);
    expect(fn).toMatch(/\.ilike\('advisor_email', ownerEmailPattern\(broker\)\)/);
  });
});

describe('what leaves the server', () => {
  it('the frozen snapshot is returned from exactly one place: the owner-only amendment view', () => {
    const get = code('api/roa-submissions/get.js');
    expect(get.match(/snapshot_json/g)).toHaveLength(1);
    const at = get.indexOf('snapshot_json');
    expect(get.lastIndexOf("req.query?.view === 'amendment'", at)).toBeGreaterThan(-1);
    // toClientView (used by list and every other endpoint) never touches it.
    const view = get.slice(get.indexOf('export function toClientView'), get.indexOf('export default'));
    expect(view).not.toMatch(/snapshot/i);
    for (const file of ['list', 'refresh', 'send-for-signature', 'send-reminder', 'sync-crm', 'notify-email', 'reconcile-pending']) {
      expect(code(`api/roa-submissions/${file}.js`), file).not.toMatch(/snapshot_json\b(?!\s*\?\?)[^;\n]*res\./);
    }
  });

  it('the amendment read is owner-scoped and uncached, and never logs the snapshot', () => {
    const get = code('api/roa-submissions/get.js');
    expect(get).toMatch(/loadSubmissionForBroker\(id, user\)/);
    expect(get).toMatch(/Cache-Control', 'private, no-store'/);
    expect(get).not.toMatch(/console\.\w+\([^)]*snapshot/);
  });

  it('amendment creation goes through the transactional function, never a bare insert', () => {
    const create = code('api/roa-submissions/create.js');
    const fn = create.slice(create.indexOf('async function createAmendment'), create.indexOf('export default async function handler'));
    expect(fn).toMatch(/createRevision\(/);
    expect(fn).not.toMatch(/insertSubmission\(/);
    expect(fn).not.toMatch(/updateSubmission\(/);
    // Revision metadata is derived on the server from the validated reason and the session.
    expect(fn).not.toMatch(/req\.body|amendment\.(revision|amendedBy|parent)/);
  });

  it('every code path that issues a ROA update leaves the original submission untouched', () => {
    const repo = code('api/_lib/submissionRepo.js');
    expect(repo).not.toMatch(/\.delete\(\)/);
    for (const column of ['snapshot_json', 'pdf_sha256', 'pdf_storage_path', 'revision_no', 'supersedes_submission_id', 'amended_by']) {
      expect(repo, column).not.toMatch(new RegExp(`update\\([^)]*${column}`));
    }
  });
});

describe('migration safety', () => {
  const rawSql = read('supabase/migrations/20261029_roa_amendments.sql');
  const sql = rawSql.replace(/^\s*--.*$/gm, '');

  it('is additive: no table or data is dropped, deleted or truncated', () => {
    expect(sql).not.toMatch(/\bdrop\s+table\b|\bdelete\s+from\b|\btruncate\b|\balter\s+column\b[\s\S]{0,60}\btype\b/i);
    expect(sql).not.toMatch(/\bdrop\s+column\b/i);
  });

  it('adds exactly the columns the issue specifies (plus the optional reason note)', () => {
    for (const column of ['revision_no', 'parent_submission_id', 'supersedes_submission_id',
      'superseded_by_submission_id', 'amendment_reason', 'amended_by', 'amended_at']) {
      expect(sql, column).toMatch(new RegExp(`add column if not exists ${column}\\b`));
    }
    expect(sql).toMatch(/revision_no integer not null default 1/);
  });

  it('opens exactly one new update privilege and never delete, to the server role only', () => {
    const grants = [...sql.matchAll(/\bgrant\b[^;]*;/gi)].map((m) => m[0].replace(/\s+/g, ' '));
    expect(grants.filter((g) => /grant update/i.test(g))).toEqual([
      'grant update (superseded_by_submission_id) on public.roa_submissions to service_role;',
    ]);
    expect(grants.some((g) => /delete/i.test(g))).toBe(false);
    // Nothing is granted to a browser role (the schema name "public" is not a grantee).
    expect(grants.some((g) => /\bto\b[^;]*\b(anon|authenticated|public)\b\s*[;,]/i.test(g))).toBe(false);
  });

  it('keeps the revision function away from browser roles', () => {
    expect(sql).toMatch(/revoke all on function public\.roa_create_revision\([\s\S]*?\) from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.roa_create_revision\([\s\S]*?\) to service_role;/);
    expect(sql).not.toMatch(/security definer/i);
  });

  it('enforces the linear chain in the database, not only in code', () => {
    expect(sql).toMatch(/create unique index if not exists roa_submissions_supersedes_uidx[\s\S]*?\(supersedes_submission_id\)/);
    expect(sql).toMatch(/create unique index if not exists roa_submissions_superseded_by_uidx[\s\S]*?\(superseded_by_submission_id\)/);
    expect(sql).toMatch(/create unique index if not exists roa_submissions_chain_revision_uidx[\s\S]*?\(parent_submission_id, revision_no\)/);
    expect(sql).toMatch(/for update;/i);
  });

  it('documents deployment order and rollback in the migration itself', () => {
    expect(rawSql).toMatch(/BEFORE the matching[\s-]+HRSROA build is deployed/i);
    expect(rawSql).toMatch(/Do NOT apply to production automatically/);
    expect(rawSql).toMatch(/Rollback/);
  });
});

describe('configuration', () => {
  it('documents the CRM revision switch and keeps it off by default', () => {
    const env = read('.env.example');
    expect(env).toMatch(/CRM_REVISION_METADATA/);
    expect(env).not.toMatch(/^CRM_REVISION_METADATA=/m); // present only as a commented example
  });

  it('introduces no new secret: the Documenso and CRM credentials are the existing variables', () => {
    const touched = ['api/_lib/supersession.js', 'api/_lib/documensoClient.js', 'api/_lib/crmIntegration.js'];
    const vars = new Set(touched.flatMap((file) => [...read(file).matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1])));
    expect([...vars].sort()).toEqual([
      'CRM_BASE_URL', 'CRM_INTEGRATION_SECRET', 'CRM_REVISION_METADATA', 'CRM_VERCEL_AUTOMATION_BYPASS_SECRET',
      'DOCUMENSO_API_TOKEN', 'DOCUMENSO_BASE_URL', 'NODE_ENV',
    ]);
  });
});
