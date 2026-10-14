#!/usr/bin/env node
// READ-ONLY reconciliation of approved ROA brokers against CRM Auth accounts and
// existing ROA submission ownership. Run it yourself — it needs privileged keys that
// are deliberately NOT part of the application's configuration:
//
//   RECON_CRM_SUPABASE_URL           https://<crm-project-ref>.supabase.co
//   RECON_CRM_SERVICE_ROLE_KEY       CRM project service-role key (Auth admin: list users)
//   RECON_ROA_SUPABASE_URL           https://<roa-project-ref>.supabase.co
//   RECON_ROA_SERVICE_ROLE_KEY       ROA project service-role key (select on roa_submissions)
//
//   node scripts/reconcile-broker-identities.mjs [--fail-on-exceptions]
//
// What it does: lists CRM Auth users (id, email, confirmation/ban flags only) and
// selects three columns from roa_submissions (id, advisor_user_id, advisor_email) —
// never snapshot_json, banking fields or evidence. It performs NO writes.
// What it prints: counts, directory broker names (already public in this repo) and
// MASKED addresses for anything outside the directory. No passwords, tokens, keys or
// full third-party emails.

import { createClient } from '@supabase/supabase-js';
import { formatReconciliation, reconcileBrokerIdentities } from './lib/brokerReconciliation.mjs';

const REQUIRED = [
  'RECON_CRM_SUPABASE_URL',
  'RECON_CRM_SERVICE_ROLE_KEY',
  'RECON_ROA_SUPABASE_URL',
  'RECON_ROA_SERVICE_ROLE_KEY',
];
const PAGE = 1000;

const failOnExceptions = process.argv.includes('--fail-on-exceptions');
if (process.argv.slice(2).some((arg) => /key|secret|token/i.test(arg))) {
  console.error('Pass keys through the environment, never on the command line.');
  process.exit(2);
}
const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exit(2);
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const crm = createClient(process.env.RECON_CRM_SUPABASE_URL, process.env.RECON_CRM_SERVICE_ROLE_KEY, options);
const roa = createClient(process.env.RECON_ROA_SUPABASE_URL, process.env.RECON_ROA_SERVICE_ROLE_KEY, options);

async function listCrmUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await crm.auth.admin.listUsers({ page, perPage: PAGE });
    if (error) throw new Error(`CRM user listing failed: ${error.message}`);
    for (const u of data.users) {
      users.push({
        id: u.id,
        email: u.email,
        email_confirmed_at: u.email_confirmed_at,
        banned_until: u.banned_until,
        is_anonymous: u.is_anonymous,
      });
    }
    if (data.users.length < PAGE) return users;
  }
}

async function listRoaOwnership() {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await roa
      .from('roa_submissions')
      .select('id,advisor_user_id,advisor_email')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`ROA submission listing failed: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

try {
  const [crmUsers, roaRows] = await Promise.all([listCrmUsers(), listRoaOwnership()]);
  const result = reconcileBrokerIdentities({ crmUsers, roaRows });
  console.log(formatReconciliation(result));
  if (failOnExceptions && result.needsAttention) process.exit(1);
} catch (err) {
  console.error(String(err.message || err));
  process.exit(2);
}
