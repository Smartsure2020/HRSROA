#!/usr/bin/env node
// Pre-cutover configuration check. Prints PASS/WARN/FAIL lines; never prints a key.
//
//   node scripts/check-auth-config.mjs [--env-file <path>] [--live]
//        [--expect-auth-ref <ref>] [--expect-data-ref <ref>] [--allow-same-project]
//
//   --env-file   read KEY=VALUE lines (e.g. a file you pulled from Vercel) instead of
//                / on top of the current environment. Values are never echoed.
//   --live       also GET <AUTH url>/auth/v1/settings (a public endpoint, anon key
//                only) to confirm email confirmation is required and see whether
//                public sign-up is open, and confirm the project rejects a forged
//                token.
//   --allow-same-project  downgrade "auth == data project" from FAIL to WARN
//                (use when validating the pre-cutover / rollback configuration).
//
// Exit code is 1 if any check FAILs.

import { readFileSync } from 'node:fs';
import {
  evaluateAuthEnvironment,
  evaluateAuthSettings,
  formatChecks,
} from './lib/authPreflight.mjs';

function parseArgs(argv) {
  const args = { live: false, requireSplit: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--live') args.live = true;
    else if (arg === '--allow-same-project') args.requireSplit = false;
    else if (arg === '--env-file') args.envFile = argv[++i];
    else if (arg === '--expect-auth-ref') args.expectedAuthRef = argv[++i];
    else if (arg === '--expect-data-ref') args.expectedDataRef = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function loadEnvFile(path) {
  const out = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

async function liveChecks(env) {
  const url = (env.AUTH_SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.AUTH_SUPABASE_ANON_KEY || '';
  if (!url || !key) return null;

  const results = [];
  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    results.push(...evaluateAuthSettings(await res.json()).checks);
  } catch (err) {
    results.push({ name: 'AUTH project settings readable', status: 'FAIL', detail: String(err.message || err) });
  }

  // A syntactically valid but unsigned token must be refused by the real project.
  try {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const forged = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
      iss: `${url}/auth/v1`, aud: 'authenticated', role: 'authenticated', sub: '00000000-0000-4000-8000-000000000000',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}.${Buffer.from('forged-signature').toString('base64url')}`;
    const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${forged}` } });
    results.push(res.status >= 400 && res.status < 500
      ? { name: 'AUTH project rejects a forged token', status: 'PASS', detail: `HTTP ${res.status}` }
      : { name: 'AUTH project rejects a forged token', status: 'FAIL', detail: `unexpected HTTP ${res.status}` });
  } catch (err) {
    results.push({ name: 'AUTH project rejects a forged token', status: 'FAIL', detail: String(err.message || err) });
  }
  return results;
}

const args = parseArgs(process.argv.slice(2));
const env = { ...process.env, ...(args.envFile ? loadEnvFile(args.envFile) : {}) };

const config = evaluateAuthEnvironment(env, {
  expectedAuthRef: args.expectedAuthRef,
  expectedDataRef: args.expectedDataRef,
  requireSplit: args.requireSplit,
});
console.log(formatChecks('Configuration', config.checks));

let ok = config.ok;
if (args.live) {
  const live = await liveChecks(env);
  if (live) {
    console.log(`\n${formatChecks('Live AUTH project', live)}`);
    ok = ok && live.every((c) => c.status !== 'FAIL');
  } else {
    console.log('\nLive AUTH project\n  [FAIL] AUTH_SUPABASE_URL / AUTH_SUPABASE_ANON_KEY are required for --live');
    ok = false;
  }
}

console.log(`\nResult: ${ok ? 'OK' : 'FAILED'}`);
process.exit(ok ? 0 : 1);
