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
      /revoke all privileges on table public\.roa_submissions from anon, authenticated, service_role;/i,
    );
  });

  it('does not recreate owner browser policies', () => {
    expect(sql).not.toMatch(/create policy roa_submissions_owner_(select|insert|update)/i);
  });

  it('keeps the service-role backend explicitly permitted', () => {
    expect(sql).toMatch(/revoke all privileges[^;]*service_role;/i);
    expect(sql).toMatch(/grant select, insert on table public\.roa_submissions to service_role;/i);
    expect(sql).toMatch(/grant update \([\s\S]*?\) on public\.roa_submissions to service_role;/i);
    expect(sql).not.toMatch(/grant[^;]*delete[^;]*service_role/i);
  });

  it('blocks browser roles from the private evidence bucket even with broader policies', () => {
    expect(sql).toMatch(/create policy roa_pdfs_server_only[\s\S]*?as restrictive/i);
    expect(sql).toMatch(/to anon, authenticated[\s\S]*?bucket_id <> 'roa-pdfs'/i);
  });

  it('describes client_reference as a display reference, not non-PII', () => {
    expect(sql).toMatch(/client_reference text,[^\n]*display reference/i);
    expect(sql).not.toMatch(/client_reference text,[^\n]*non-PII/i);
  });
});
