import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260914_roa_submissions.sql'),
  'utf8',
);

describe('ROA evidence migration — server-only boundary', () => {
  it('revokes direct anon/authenticated table privileges', () => {
    expect(sql).toMatch(
      /revoke all privileges on table public\.roa_submissions from anon, authenticated;/i,
    );
  });

  it('does not recreate owner browser policies', () => {
    expect(sql).not.toMatch(/create policy roa_submissions_owner_(select|insert|update)/i);
  });

  it('keeps the service-role backend explicitly permitted', () => {
    expect(sql).toMatch(
      /grant select, insert, update on table public\.roa_submissions to service_role;/i,
    );
  });

  it('describes client_reference as a display reference, not non-PII', () => {
    expect(sql).toMatch(/client_reference text,[^\n]*display reference/i);
    expect(sql).not.toMatch(/client_reference text,[^\n]*non-PII/i);
  });
});
