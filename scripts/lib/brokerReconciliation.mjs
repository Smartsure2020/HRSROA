// Pure reconciliation of the approved-broker directory against CRM Auth accounts and
// the ownership recorded on existing ROA submissions. No I/O.
//
// Answers, without guessing:
//   * which approved brokers can sign in to ROA with a CRM account today;
//   * which cannot yet (no / unconfirmed / banned / duplicated CRM account);
//   * whether any existing submissions would be unreachable after cutover, and why;
//   * whether any ownership data is ambiguous (one legacy id under several emails, …).
//
// Ownership after cutover is decided by the verified email (see
// api/_lib/brokerIdentity.js), so everything is evaluated the same way here.

import { normalizeEmail } from '../../api/_lib/brokerIdentity.js';
import { BROKER_EMAIL_MAP } from '../../src/lib/brokerDirectory.js';

/** Masks the local part: `jane.doe@x.co` → `j***@x.co`. */
export function maskEmail(email) {
  if (typeof email !== 'string' || !email.includes('@')) return '(unreadable)';
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

function bump(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

function addToSet(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

/**
 * @param {object} input
 * @param {Record<string,string>} [input.directory]
 * @param {Array<{id:string,email?:string|null,email_confirmed_at?:string|null,banned_until?:string|null,is_anonymous?:boolean}>} input.crmUsers
 * @param {Array<{id?:string,advisor_user_id?:string|null,advisor_email?:string|null}>} input.roaRows
 * @param {number} [input.now]
 */
export function reconcileBrokerIdentities({ directory = BROKER_EMAIL_MAP, crmUsers, roaRows, now = Date.now() }) {
  // ---- directory ---------------------------------------------------------
  const directoryIssues = [];
  const brokers = [];
  const byEmail = new Map();
  for (const [name, rawEmail] of Object.entries(directory)) {
    const email = normalizeEmail(rawEmail);
    if (!email) {
      directoryIssues.push({ name, issue: 'invalid_email' });
      continue;
    }
    if (byEmail.has(email)) {
      directoryIssues.push({ name, issue: 'duplicate_email', sharedWith: byEmail.get(email).name });
      continue;
    }
    const broker = { name, email };
    byEmail.set(email, broker);
    brokers.push(broker);
  }

  // ---- CRM accounts ------------------------------------------------------
  const crmByEmail = new Map();
  const crmById = new Map();
  let crmWithoutUsableEmail = 0;
  for (const user of crmUsers) {
    crmById.set(user.id, user);
    const email = normalizeEmail(user.email);
    if (!email) { crmWithoutUsableEmail += 1; continue; }
    if (!crmByEmail.has(email)) crmByEmail.set(email, []);
    crmByEmail.get(email).push(user);
  }

  const crmStatusByEmail = new Map();
  const accounts = { ready: [], missing: [], unconfirmed: [], banned: [], anonymous: [], duplicate: [] };
  for (const broker of brokers) {
    const matches = crmByEmail.get(broker.email) || [];
    let status;
    if (matches.length === 0) status = 'missing';
    else if (matches.length > 1) status = 'duplicate';
    else if (matches[0].is_anonymous === true) status = 'anonymous';
    else if (!matches[0].email_confirmed_at) status = 'unconfirmed';
    else if (matches[0].banned_until && Date.parse(matches[0].banned_until) > now) status = 'banned';
    else status = 'ready';
    crmStatusByEmail.set(broker.email, status);
    accounts[status].push(broker.name);
  }
  const crmNotInDirectory = Array.from(crmByEmail.keys()).filter((email) => !byEmail.has(email)).length;

  // ---- ROA ownership -----------------------------------------------------
  const rowsByBroker = new Map();
  const legacyIdsByEmail = new Map();
  const emailsByLegacyId = new Map();
  const foreignOwners = new Map(); // masked email -> row count
  let malformedOwnerRows = 0;
  const idEmailConflicts = [];

  for (const row of roaRows) {
    const email = normalizeEmail(row.advisor_email);
    if (!email) { malformedOwnerRows += 1; continue; }

    if (row.advisor_user_id) addToSet(emailsByLegacyId, row.advisor_user_id, email);

    const crmUser = row.advisor_user_id ? crmById.get(row.advisor_user_id) : null;
    if (crmUser && normalizeEmail(crmUser.email) !== email) {
      idEmailConflicts.push({ rowId: row.id ?? null, advisorEmail: maskEmail(row.advisor_email) });
    }

    if (!byEmail.has(email)) {
      bump(foreignOwners, maskEmail(row.advisor_email));
      continue;
    }
    bump(rowsByBroker, email);
    if (row.advisor_user_id) addToSet(legacyIdsByEmail, email, row.advisor_user_id);
  }

  const ambiguousLegacyIds = Array.from(emailsByLegacyId.entries())
    .filter(([, emails]) => emails.size > 1)
    .map(([id, emails]) => ({ legacyId: `${id.slice(0, 8)}…`, emailCount: emails.size }));

  const perBroker = brokers.map((broker) => ({
    name: broker.name,
    crmStatus: crmStatusByEmail.get(broker.email),
    submissions: rowsByBroker.get(broker.email) || 0,
    distinctLegacyIds: (legacyIdsByEmail.get(broker.email) || new Set()).size,
  }));

  const foreignRowTotal = Array.from(foreignOwners.values()).reduce((a, b) => a + b, 0);
  const rowsAwaitingCrmAccount = perBroker
    .filter((b) => b.crmStatus !== 'ready')
    .reduce((sum, b) => sum + b.submissions, 0);
  const rowsReachableAtCutover = perBroker
    .filter((b) => b.crmStatus === 'ready')
    .reduce((sum, b) => sum + b.submissions, 0);

  const exceptions = {
    directoryIssues,
    brokersWithoutReadyCrmAccount: perBroker.filter((b) => b.crmStatus !== 'ready').map((b) => ({ name: b.name, status: b.crmStatus })),
    ambiguousLegacyIds,
    idEmailConflicts,
    foreignOwnerEmails: Array.from(foreignOwners.entries()).map(([maskedEmail, rows]) => ({ maskedEmail, rows })),
    malformedOwnerRows,
  };

  return {
    summary: {
      directoryBrokers: brokers.length,
      crmAccountsReady: accounts.ready.length,
      crmAccountsMissing: accounts.missing.length,
      crmAccountsUnconfirmed: accounts.unconfirmed.length,
      crmAccountsBanned: accounts.banned.length,
      crmAccountsAnonymous: accounts.anonymous.length,
      crmAccountsDuplicate: accounts.duplicate.length,
      crmAccountsOutsideDirectory: crmNotInDirectory,
      crmAccountsWithoutUsableEmail: crmWithoutUsableEmail,
      submissionsTotal: roaRows.length,
      submissionsReachableAtCutover: rowsReachableAtCutover,
      submissionsAwaitingCrmAccount: rowsAwaitingCrmAccount,
      submissionsWithForeignOwner: foreignRowTotal,
      submissionsWithMalformedOwner: malformedOwnerRows,
    },
    accounts,
    perBroker,
    exceptions,
    // Blocking = would hide records from, or misattribute them to, a broker.
    needsAttention:
      directoryIssues.length > 0
      || ambiguousLegacyIds.length > 0
      || idEmailConflicts.length > 0
      || foreignRowTotal > 0
      || malformedOwnerRows > 0
      || accounts.duplicate.length > 0,
  };
}

export function formatReconciliation(result) {
  const s = result.summary;
  const lines = [
    'Broker identity reconciliation (read-only)',
    '',
    `Approved brokers in directory ........ ${s.directoryBrokers}`,
    `  with a ready CRM account ........... ${s.crmAccountsReady}`,
    `  with NO CRM account ................ ${s.crmAccountsMissing}${result.accounts.missing.length ? `  → ${result.accounts.missing.join(', ')}` : ''}`,
    `  CRM account unconfirmed ............ ${s.crmAccountsUnconfirmed}${result.accounts.unconfirmed.length ? `  → ${result.accounts.unconfirmed.join(', ')}` : ''}`,
    `  CRM account banned ................. ${s.crmAccountsBanned}${result.accounts.banned.length ? `  → ${result.accounts.banned.join(', ')}` : ''}`,
    `  duplicate CRM accounts ............. ${s.crmAccountsDuplicate}${result.accounts.duplicate.length ? `  → ${result.accounts.duplicate.join(', ')}` : ''}`,
    `CRM accounts outside the directory ... ${s.crmAccountsOutsideDirectory} (expected: other CRM staff; they cannot use ROA)`,
    '',
    `ROA submissions ...................... ${s.submissionsTotal}`,
    `  reachable by a ready CRM account ... ${s.submissionsReachableAtCutover}`,
    `  waiting on a CRM account ........... ${s.submissionsAwaitingCrmAccount} (kept intact; visible once the account exists)`,
    `  owned by a non-directory email ..... ${s.submissionsWithForeignOwner} (UNREACHABLE after cutover)`,
    `  with a missing/malformed owner ..... ${s.submissionsWithMalformedOwner} (UNREACHABLE after cutover)`,
    '',
    'Per broker (submissions · distinct historic ROA ids · CRM status)',
    ...result.perBroker.map((b) => `  ${b.name.padEnd(22)} ${String(b.submissions).padStart(5)} · ${b.distinctLegacyIds} · ${b.crmStatus}`),
  ];

  const ex = result.exceptions;
  const problems = [];
  for (const issue of ex.directoryIssues) problems.push(`directory: ${issue.name} → ${issue.issue}`);
  for (const a of ex.ambiguousLegacyIds) problems.push(`ambiguous: historic id ${a.legacyId} appears under ${a.emailCount} different emails`);
  for (const c of ex.idEmailConflicts) problems.push(`conflict: row ${c.rowId} carries a CRM user id whose email differs from ${c.advisorEmail}`);
  for (const f of ex.foreignOwnerEmails) problems.push(`orphaned owner: ${f.maskedEmail} → ${f.rows} row(s) not in the directory`);

  lines.push('', problems.length ? 'Exceptions needing a decision:' : 'Exceptions: none', ...problems.map((p) => `  - ${p}`));
  return lines.join('\n');
}
