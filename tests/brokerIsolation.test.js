// Broker isolation across the CRM-auth cutover.
//
// Historic submissions were stamped with the OLD ROA Auth user id. After cutover
// the same brokers sign in with different CRM Auth ids, so ownership is decided
// by the verified email instead. These tests seed pre-cutover rows directly and
// prove that:
//   * a CRM-authenticated broker still sees (only) their own history;
//   * no broker can read, download or modify another broker's records by any
//     route, parameter or body field;
//   * historical attribution is never rewritten;
//   * ambiguous / malformed ownership data fails safe.
// Offline: the Supabase client is the in-memory mock; no network.

import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMockSupabase } from './testUtils/mockSupabase.js';
import { makeTestJwt } from './testUtils/testJwt.js';
import { sha256HexOfBytes } from '../api/_lib/sha256.js';

const CRM_URL = 'https://mgqelduyralkdbsbwqcu.supabase.co';
const ROA_URL = 'https://rylfshngbafldisqrhec.supabase.co';

const mock = makeMockSupabase();
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mock.client }));

const getHandler = (await import('../api/roa-submissions/get.js')).default;
const listHandler = (await import('../api/roa-submissions/list.js')).default;
const pdfHandler = (await import('../api/roa-submissions/pdf.js')).default;
const refreshHandler = (await import('../api/roa-submissions/refresh.js')).default;
const reminderHandler = (await import('../api/roa-submissions/send-reminder.js')).default;
const syncCrmHandler = (await import('../api/roa-submissions/sync-crm.js')).default;
const createHandler = (await import('../api/roa-submissions/create.js')).default;
const repo = await import('../api/_lib/submissionRepo.js');
const { escapeLikePattern, ownerEmailPattern, ownsSubmission } = await import('../api/_lib/brokerIdentity.js');
const { _resetServerSupabaseForTests } = await import('../api/_lib/supabaseServer.js');
const { generateSubmissionId } = await import('../src/lib/roaSubmissionSnapshot.js');

// CRM-issued credentials (ids are deliberately NOT the legacy ROA ids).
const crmToken = (sub) => makeTestJwt({ sub, iss: `${CRM_URL}/auth/v1` });
const TOKENS = {
  andrew: crmToken('crm-andrew'),
  werner: crmToken('crm-werner'),
  stranger: crmToken('crm-stranger'),
};
const ANDREW = { normalizedEmail: 'andrew@hrsinsurance.co.za' };
const WERNER = { normalizedEmail: 'werner@hrsinsurance.co.za' };

const originalEnv = { ...process.env };

function mockRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    _bytes: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send(bytes) { this._bytes = bytes; return this; },
  };
}

const asBroker = (token) => ({ headers: { authorization: `Bearer ${token}` } });

function signedPdfBytes(marker) {
  return Buffer.from(`%PDF-1.4\n${marker}\n${'x'.repeat(600)}\n%%EOF`, 'utf8');
}

/** A pre-cutover row: stamped with the OLD ROA Auth id and the email captured then. */
function seedLegacyRow({ advisorUserId, advisorEmail, withSigned = false, ...overrides }) {
  const id = overrides.id ?? generateSubmissionId();
  const canonical = signedPdfBytes(`canonical-${id}`);
  const row = {
    id,
    roa_type: 'Personal',
    status: 'submitted',
    advisor_user_id: advisorUserId,
    advisor_email: advisorEmail,
    client_reference: 'Personal – Jane Doe',
    snapshot_json: { firstName: 'Jane', surname: 'Doe' },
    template_version: 't', statutory_disclosure_version: 's',
    broker_appointment_version: 'b', broker_fee_version: 'f',
    pdf_sha256: sha256HexOfBytes(canonical),
    pdf_storage_path: `${id}/canonical.pdf`,
    pdf_byte_length: canonical.length,
    submitted_at: '2026-09-01T08:00:00.000Z',
    ...overrides,
  };
  mock.fixtures.putStorage(row.pdf_storage_path, canonical);
  let signed = null;
  if (withSigned) {
    signed = signedPdfBytes(`signed-${id}`);
    row.signed_pdf_storage_path = `${id}/signed.pdf`;
    row.signed_pdf_sha256 = sha256HexOfBytes(signed);
    mock.fixtures.putStorage(row.signed_pdf_storage_path, signed);
  }
  mock.fixtures.insertRow(row);
  return { id, signed };
}

beforeEach(() => {
  process.env.AUTH_SUPABASE_URL = CRM_URL;
  process.env.AUTH_SUPABASE_ANON_KEY = 'crm-anon';
  process.env.ROA_SUPABASE_URL = ROA_URL;
  process.env.ROA_SUPABASE_SERVICE_ROLE_KEY = 'roa-service';
  _resetServerSupabaseForTests();
  mock.fixtures.reset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mock.fixtures.addAuthUser(TOKENS.andrew, { id: 'crm-andrew', email: 'andrew@hrsinsurance.co.za' });
  mock.fixtures.addAuthUser(TOKENS.werner, { id: 'crm-werner', email: 'werner@hrsinsurance.co.za' });
  mock.fixtures.addAuthUser(TOKENS.stranger, { id: 'crm-stranger', email: 'stranger@example.com' });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

describe('historic ownership survives the move to CRM Auth ids', () => {
  it('a CRM-authenticated broker sees their pre-cutover submissions — and only theirs', async () => {
    const mine1 = seedLegacyRow({ advisorUserId: '11111111-0000-4000-8000-0000000000a1', advisorEmail: 'andrew@hrsinsurance.co.za' });
    // Mixed-case email as captured by the old project must still match.
    const mine2 = seedLegacyRow({ advisorUserId: '11111111-0000-4000-8000-0000000000a2', advisorEmail: 'Andrew@HRSInsurance.co.za' });
    const theirs = seedLegacyRow({ advisorUserId: '22222222-0000-4000-8000-0000000000b1', advisorEmail: 'werner@hrsinsurance.co.za' });

    const res = mockRes();
    await listHandler({ method: 'GET', query: {}, ...asBroker(TOKENS.andrew) }, res);

    expect(res.statusCode).toBe(200);
    const ids = res.body.submissions.map((s) => s.submissionId).sort();
    expect(ids).toEqual([mine1.id, mine2.id].sort());
    expect(ids).not.toContain(theirs.id);
  });

  it('reads an own legacy submission by id and serves its stored evidence, hash-verified', async () => {
    const own = seedLegacyRow({
      advisorUserId: '11111111-0000-4000-8000-0000000000a1',
      advisorEmail: 'andrew@hrsinsurance.co.za',
      withSigned: true,
    });

    const meta = mockRes();
    await getHandler({ method: 'GET', query: { id: own.id }, ...asBroker(TOKENS.andrew) }, meta);
    expect(meta.statusCode).toBe(200);
    expect(meta.body.submission.hasSignedPdf).toBe(true);

    const pdf = mockRes();
    await pdfHandler({ method: 'GET', query: { id: own.id, kind: 'signed' }, ...asBroker(TOKENS.andrew) }, pdf);
    expect(pdf.statusCode).toBe(200);
    expect(Buffer.compare(pdf._bytes, own.signed)).toBe(0);
  });

  it('never rewrites historical attribution when a CRM broker acts on a legacy row', async () => {
    const legacyId = '11111111-0000-4000-8000-0000000000a1';
    const own = seedLegacyRow({ advisorUserId: legacyId, advisorEmail: 'Andrew@HRSInsurance.co.za' });

    const outcome = await repo.reserveSigningSlot(own.id, { id: 'crm-andrew', normalizedEmail: 'andrew@hrsinsurance.co.za' }, 'documenso');
    expect(outcome.reserved).toBe(true);

    const row = mock.fixtures.getRow(own.id);
    expect(row.status).toBe('awaiting_signature');
    expect(row.advisor_user_id).toBe(legacyId); // still the historic ROA id
    expect(row.advisor_email).toBe('Andrew@HRSInsurance.co.za'); // still the historic capture
  });

  it('stamps new submissions with the CRM identity from the validated token, ignoring body claims', async () => {
    const submissionId = generateSubmissionId();
    const res = mockRes();
    await createHandler({
      method: 'POST',
      ...asBroker(TOKENS.andrew),
      body: {
        submissionId,
        roaType: 'Personal',
        snapshot: { firstName: 'Jane', surname: 'Doe' },
        versions: {
          templateVersion: 't', statutoryDisclosureVersion: 's',
          brokerAppointmentVersion: 'b', brokerFeeVersion: 'f',
        },
        pdfBase64: signedPdfBytes('new').toString('base64'),
        // Attempts to attribute the record to someone else — must be ignored.
        advisorEmail: 'werner@hrsinsurance.co.za',
        advisor_email: 'werner@hrsinsurance.co.za',
        advisor_user_id: 'crm-werner',
      },
    }, res);

    expect(res.statusCode).toBe(200);
    const row = mock.fixtures.getRow(submissionId);
    expect(row.advisor_user_id).toBe('crm-andrew');
    expect(row.advisor_email).toBe('andrew@hrsinsurance.co.za');

    // And it is immediately visible to Andrew alongside his history, not to Werner.
    const mine = mockRes();
    await listHandler({ method: 'GET', query: {}, ...asBroker(TOKENS.andrew) }, mine);
    expect(mine.body.submissions.map((s) => s.submissionId)).toContain(submissionId);
    const theirs = mockRes();
    await listHandler({ method: 'GET', query: {}, ...asBroker(TOKENS.werner) }, theirs);
    expect(theirs.body.submissions).toEqual([]);
  });
});

describe('Broker A cannot reach Broker B', () => {
  it('cannot read B\'s submission metadata — same answer as for a record that does not exist', async () => {
    const theirs = seedLegacyRow({ advisorUserId: '22222222-0000-4000-8000-0000000000b1', advisorEmail: 'werner@hrsinsurance.co.za' });

    const stolen = mockRes();
    await getHandler({ method: 'GET', query: { id: theirs.id }, ...asBroker(TOKENS.andrew) }, stolen);
    const missing = mockRes();
    await getHandler({ method: 'GET', query: { id: generateSubmissionId() }, ...asBroker(TOKENS.andrew) }, missing);

    expect(stolen.statusCode).toBe(404);
    expect(stolen.body).toEqual(missing.body); // existence is not leaked
  });

  it('cannot download B\'s evidence of any kind', async () => {
    const theirs = seedLegacyRow({
      advisorUserId: '22222222-0000-4000-8000-0000000000b1',
      advisorEmail: 'werner@hrsinsurance.co.za',
      withSigned: true,
    });

    for (const kind of ['canonical', 'signed', 'certificate', 'audit-log']) {
      const res = mockRes();
      await pdfHandler({ method: 'GET', query: { id: theirs.id, kind }, ...asBroker(TOKENS.andrew) }, res);
      expect(res.statusCode, kind).toBe(404);
      expect(res._bytes, kind).toBeNull();
    }

    // The owner, with the same endpoint, gets the bytes.
    const owner = mockRes();
    await pdfHandler({ method: 'GET', query: { id: theirs.id, kind: 'signed' }, ...asBroker(TOKENS.werner) }, owner);
    expect(owner.statusCode).toBe(200);
    expect(Buffer.compare(owner._bytes, theirs.signed)).toBe(0);
  });

  it('cannot widen their scope through query parameters, headers or body fields', async () => {
    const theirs = seedLegacyRow({ advisorUserId: '22222222-0000-4000-8000-0000000000b1', advisorEmail: 'werner@hrsinsurance.co.za' });

    const res = mockRes();
    await listHandler({
      method: 'GET',
      query: { advisor_email: 'werner@hrsinsurance.co.za', advisorEmail: 'werner@hrsinsurance.co.za', email: 'werner@hrsinsurance.co.za', all: '1' },
      headers: {
        authorization: `Bearer ${TOKENS.andrew}`,
        'x-broker-email': 'werner@hrsinsurance.co.za',
        'x-forwarded-user': 'crm-werner',
      },
      body: { advisorEmail: 'werner@hrsinsurance.co.za' },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.submissions.map((s) => s.submissionId)).not.toContain(theirs.id);
  });

  it('cannot modify B\'s record through the signing, reminder, refresh or CRM-sync routes', async () => {
    const theirs = seedLegacyRow({
      advisorUserId: '22222222-0000-4000-8000-0000000000b1',
      advisorEmail: 'werner@hrsinsurance.co.za',
      status: 'awaiting_signature',
      signing_provider: 'documenso',
      signing_envelope_id: 'env-werner',
    });
    const before = mock.fixtures.getRow(theirs.id);

    for (const [handler, label] of [[refreshHandler, 'refresh'], [reminderHandler, 'send-reminder'], [syncCrmHandler, 'sync-crm']]) {
      const res = mockRes();
      await handler({ method: 'POST', ...asBroker(TOKENS.andrew), body: { submissionId: theirs.id } }, res);
      expect(res.statusCode, label).toBe(404);
    }
    expect(mock.fixtures.getRow(theirs.id)).toEqual(before);
  });

  it('cannot reserve, release or complete B\'s record through the repository either', async () => {
    const theirs = seedLegacyRow({
      advisorUserId: '22222222-0000-4000-8000-0000000000b1',
      advisorEmail: 'werner@hrsinsurance.co.za',
    });
    const before = mock.fixtures.getRow(theirs.id);

    expect(await repo.reserveSigningSlot(theirs.id, ANDREW, 'documenso')).toEqual({ reserved: false, row: null });
    expect(await repo.reserveEnvelopeSlot(theirs.id, ANDREW)).toEqual({ reserved: false, row: null });
    await repo.releaseSigningReservation(theirs.id, ANDREW, 'documenso', { reason: 'x' });
    await repo.releaseEnvelopeReservation(theirs.id, ANDREW, { reason: 'x' });
    expect(await repo.setCompletionIfMissing(theirs.id, ANDREW, '2026-09-25T08:00:00.000Z')).toBeNull();
    expect(await repo.loadSubmissionForBroker(theirs.id, ANDREW)).toBeNull();

    expect(mock.fixtures.getRow(theirs.id)).toEqual(before);
    // The rightful owner can.
    expect((await repo.reserveSigningSlot(theirs.id, WERNER, 'documenso')).reserved).toBe(true);
  });

  it('cannot overwrite B\'s record by re-using its submission id on create', async () => {
    const theirs = seedLegacyRow({ advisorUserId: '22222222-0000-4000-8000-0000000000b1', advisorEmail: 'werner@hrsinsurance.co.za' });
    const before = mock.fixtures.getRow(theirs.id);

    const res = mockRes();
    await createHandler({
      method: 'POST',
      ...asBroker(TOKENS.andrew),
      body: {
        submissionId: theirs.id,
        roaType: 'Personal',
        snapshot: { firstName: 'Jane', surname: 'Doe' },
        versions: {
          templateVersion: 't', statutoryDisclosureVersion: 's',
          brokerAppointmentVersion: 'b', brokerFeeVersion: 'f',
        },
        pdfBase64: signedPdfBytes('different').toString('base64'),
      },
    }, res);

    expect(res.statusCode).not.toBe(200);
    expect(mock.fixtures.getRow(theirs.id)).toEqual(before);
  });

  it('gives a manager/administrator no read-all path — only explicitly authorised visibility exists', async () => {
    // Andrew Penney is the practice manager (MANAGER_NAME), yet ROA grants no
    // cross-broker visibility: he sees Werner's records exactly as anyone else would.
    const theirs = seedLegacyRow({ advisorUserId: '22222222-0000-4000-8000-0000000000b1', advisorEmail: 'werner@hrsinsurance.co.za' });
    const res = mockRes();
    await getHandler({ method: 'GET', query: { id: theirs.id }, ...asBroker(TOKENS.andrew) }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('ambiguous or malformed ownership data fails safe', () => {
  it('treats rows with a missing, blank or look-alike advisor_email as owned by nobody', async () => {
    const own = seedLegacyRow({ advisorUserId: 'legacy-a', advisorEmail: 'andrew@hrsinsurance.co.za' });
    const orphans = [
      { advisorEmail: null }, { advisorEmail: '' }, { advisorEmail: '   ' },
      { advisorEmail: 'andrew@hrsinsurance.co.za.evil.example' },
      { advisorEmail: 'andrew+roa@hrsinsurance.co.za' },
      { advisorEmail: 'andrew@hrsinsurance.co.za ' },
      { advisorEmail: '%' }, { advisorEmail: '%@hrsinsurance.co.za' }, { advisorEmail: 'andrew_@hrsinsurance.co.za' },
    ].map((o, i) => seedLegacyRow({ advisorUserId: `legacy-${i}`, ...o }));

    const res = mockRes();
    await listHandler({ method: 'GET', query: {}, ...asBroker(TOKENS.andrew) }, res);
    expect(res.body.submissions.map((s) => s.submissionId)).toEqual([own.id]);

    for (const orphan of orphans) {
      const get = mockRes();
      await getHandler({ method: 'GET', query: { id: orphan.id }, ...asBroker(TOKENS.andrew) }, get);
      expect(get.statusCode).toBe(404);
    }
  });

  it('never treats a matching auth user id as ownership — the verified email decides', async () => {
    // A row carrying Andrew's CRM id but another broker's email (an impossible state
    // for the app to create, since both columns are stamped from one identity).
    const conflict = seedLegacyRow({ advisorUserId: 'crm-andrew', advisorEmail: 'werner@hrsinsurance.co.za' });

    const asAndrew = mockRes();
    await getHandler({ method: 'GET', query: { id: conflict.id }, ...asBroker(TOKENS.andrew) }, asAndrew);
    expect(asAndrew.statusCode).toBe(404);
  });

  it('refuses to build a query for an unusable broker identity', async () => {
    for (const bad of [undefined, null, {}, { normalizedEmail: '' }, { normalizedEmail: '%' }, { normalizedEmail: 'a b@x.co' }]) {
      expect(() => ownerEmailPattern(bad)).toThrow('invalid_broker_identity');
      await expect(repo.listSubmissionsForBroker(bad)).rejects.toThrow('invalid_broker_identity');
      await expect(repo.reserveSigningSlot('ROA-x', bad, 'documenso')).rejects.toThrow('invalid_broker_identity');
      expect(ownsSubmission({ advisor_email: 'andrew@hrsinsurance.co.za' }, bad)).toBe(false);
    }
  });

  it('escapes LIKE metacharacters so an email can only match itself', () => {
    expect(escapeLikePattern('a_b%c\\d')).toBe('a\\_b\\%c\\\\d');
    expect(escapeLikePattern('andrew@hrsinsurance.co.za')).toBe('andrew@hrsinsurance.co.za');
  });

  it('refuses a valid CRM user who is not an approved broker before any data is read', async () => {
    seedLegacyRow({ advisorUserId: 'legacy-a', advisorEmail: 'andrew@hrsinsurance.co.za' });
    const res = mockRes();
    await listHandler({ method: 'GET', query: {}, ...asBroker(TOKENS.stranger) }, res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'not_an_hrs_broker' });
  });
});

describe('static contract: no unscoped service-role access from broker routes', () => {
  const root = new URL('../', import.meta.url);
  const read = (relative) => readFileSync(new URL(relative, root), 'utf8');
  const handlerFiles = readdirSync(new URL('api/roa-submissions/', root))
    .filter((name) => name.endsWith('.js'))
    .map((name) => `api/roa-submissions/${name}`);

  it('every broker route authenticates through requireAuthenticatedBroker before touching data', () => {
    for (const file of handlerFiles) {
      const source = read(file);
      expect(source, file).toContain('requireAuthenticatedBroker');
    }
  });

  it('broker routes never build their own Supabase client or load rows without an ownership check', () => {
    for (const file of handlerFiles) {
      const source = read(file);
      expect(source, file).not.toMatch(/createClient\s*\(/);
      expect(source, file).not.toContain('supabaseServer');
      expect(source, file).not.toContain('loadSubmissionRaw');
      expect(source, file).not.toMatch(/\.from\(\s*['"]roa_submissions['"]/);
    }
  });

  it('every route that mutates an existing row first loads it through the ownership gate', () => {
    for (const file of handlerFiles) {
      const source = read(file);
      const mutates = /updateSubmission\(|reserve(Signing|Envelope)Slot\(|release(Signing|Envelope)Reservation\(/.test(source);
      if (mutates) {
        expect(source, file).toMatch(/loadSubmissionForBroker\(/);
      }
    }
  });

  it('adds no serverless function: the project is at the Vercel Hobby 12-function ceiling', () => {
    const functions = [];
    const walk = (relative) => {
      for (const entry of readdirSync(new URL(relative, root), { withFileTypes: true })) {
        if (entry.name.startsWith('_')) continue; // underscore-prefixed paths are not deployed as functions
        if (entry.isDirectory()) walk(`${relative}${entry.name}/`);
        else if (entry.name.endsWith('.js')) functions.push(`${relative}${entry.name}`);
      }
    };
    walk('api/');
    expect(functions.length, functions.join(', ')).toBeLessThanOrEqual(12);
  });

  it('repository ownership never keys on the auth user id', () => {
    const repoSource = read('api/_lib/submissionRepo.js');
    expect(repoSource).not.toMatch(/\.eq\(\s*['"]advisor_user_id['"]/);
    expect(repoSource).not.toContain('brokerUserId');
  });
});
