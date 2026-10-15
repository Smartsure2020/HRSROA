// Password recovery must run against the CRM Supabase Auth project, return to this
// app's own /reset-password page, and never carry user-controlled data in the
// redirect.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  MIN_PASSWORD_LENGTH,
  exchangeRecoveryLink,
  parseRecoveryLink,
  passwordResetRedirectUrl,
  requestPasswordReset,
  validateNewPassword,
} from '../src/lib/passwordRecovery.js';

describe('redirect destination (no open redirect)', () => {
  it('is the app\'s own origin plus the fixed /reset-password path', () => {
    expect(passwordResetRedirectUrl('https://roa.hrsinsurance.co.za')).toBe('https://roa.hrsinsurance.co.za/reset-password');
    expect(passwordResetRedirectUrl('http://localhost:5173')).toBe('http://localhost:5173/reset-password');
  });

  it('drops any path, query or fragment smuggled into the origin', () => {
    expect(passwordResetRedirectUrl('https://roa.hrsinsurance.co.za/anything?next=https://evil.example#x'))
      .toBe('https://roa.hrsinsurance.co.za/reset-password');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>1</script>',
    'ftp://roa.hrsinsurance.co.za',
    'https://user:secret@roa.hrsinsurance.co.za',
    '//evil.example',
    'not a url',
    '',
  ])('refuses an unusable origin: %s', (origin) => {
    expect(() => passwordResetRedirectUrl(origin)).toThrow('invalid_origin');
  });
});

describe('requesting a reset', () => {
  it('goes through the supplied (CRM-bound) client, with the fixed redirect and the email only as the recipient', async () => {
    const client = { auth: { resetPasswordForEmail: vi.fn(async () => ({ error: null })) } };

    await requestPasswordReset(client, '  andrew@hrsinsurance.co.za ', 'https://roa.hrsinsurance.co.za');

    expect(client.auth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
    const [email, options] = client.auth.resetPasswordForEmail.mock.calls[0];
    expect(email).toBe('andrew@hrsinsurance.co.za');
    expect(options).toEqual({ redirectTo: 'https://roa.hrsinsurance.co.za/reset-password' });
    // Nothing the user typed leaks into the redirect URL.
    expect(options.redirectTo).not.toContain('andrew');
  });

  it('surfaces a Supabase error and does not call out when the origin is unusable', async () => {
    const failing = { auth: { resetPasswordForEmail: vi.fn(async () => ({ error: new Error('rate limited') })) } };
    await expect(requestPasswordReset(failing, 'a@b.co', 'https://roa.hrsinsurance.co.za')).rejects.toThrow('rate limited');

    const untouched = { auth: { resetPasswordForEmail: vi.fn() } };
    await expect(requestPasswordReset(untouched, 'a@b.co', 'javascript:alert(1)')).rejects.toThrow('invalid_origin');
    expect(untouched.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe('recovery link handling', () => {
  it('recognises fragment tokens, PKCE codes, token hashes and error links', () => {
    expect(parseRecoveryLink('', '#access_token=a&refresh_token=r&type=recovery')).toMatchObject({
      hasFragmentTokens: true, type: 'recovery', error: null,
    });
    expect(parseRecoveryLink('?code=abc', '')).toMatchObject({ code: 'abc', hasFragmentTokens: false });
    expect(parseRecoveryLink('?token_hash=h&type=recovery', '')).toMatchObject({ tokenHash: 'h', type: 'recovery' });
    expect(parseRecoveryLink('', '#error=access_denied&error_description=Email+link+is+invalid+or+has+expired').error)
      .toBe('Email link is invalid or has expired');
  });

  it('exchanges a token hash for a recovery session via verifyOtp (type fixed to "recovery")', async () => {
    const client = { auth: { verifyOtp: vi.fn(async () => ({ error: null })), exchangeCodeForSession: vi.fn() } };
    expect(await exchangeRecoveryLink(client, parseRecoveryLink('?token_hash=h&type=recovery', ''))).toBe(true);
    expect(client.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'h', type: 'recovery' });
  });

  it('does not let a link choose a non-recovery OTP type', async () => {
    const client = { auth: { verifyOtp: vi.fn(), exchangeCodeForSession: vi.fn() } };
    // e.g. an "invite"/"email_change" link must not be consumed by the reset page.
    expect(await exchangeRecoveryLink(client, parseRecoveryLink('?token_hash=h&type=email_change', ''))).toBe(false);
    expect(client.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('exchanges a PKCE code, and leaves fragment tokens to supabase-js', async () => {
    const client = { auth: { verifyOtp: vi.fn(), exchangeCodeForSession: vi.fn(async () => ({ error: null })) } };
    expect(await exchangeRecoveryLink(client, parseRecoveryLink('?code=abc', ''))).toBe(true);
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(await exchangeRecoveryLink(client, parseRecoveryLink('', '#access_token=a&type=recovery'))).toBe(false);
  });

  it('throws when the link cannot be exchanged', async () => {
    const client = { auth: { verifyOtp: vi.fn(async () => ({ error: new Error('Token has expired or is invalid') })), exchangeCodeForSession: vi.fn() } };
    await expect(exchangeRecoveryLink(client, parseRecoveryLink('?token_hash=h&type=recovery', ''))).rejects.toThrow('expired');
  });

  it('enforces the client-side password rules', () => {
    expect(validateNewPassword('short', 'short')).toContain(String(MIN_PASSWORD_LENGTH));
    expect(validateNewPassword('long-enough-1', 'different-1')).toMatch(/do not match/);
    expect(validateNewPassword('long-enough-1', 'long-enough-1')).toBeNull();
    expect(validateNewPassword(undefined, undefined)).not.toBeNull();
  });
});

describe('contract: recovery is wired to the CRM auth client only', () => {
  const root = new URL('../', import.meta.url);
  const srcDir = fileURLToPath(new URL('src/', root));

  function files(dir) {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return files(full);
      return /\.(js|jsx)$/.test(name) ? [full] : [];
    });
  }

  it('only passwordRecovery.js calls resetPasswordForEmail, and no browser file builds its own redirect', () => {
    const callers = files(srcDir).filter((f) => readFileSync(f, 'utf8').includes('resetPasswordForEmail'));
    expect(callers.map((f) => f.replace(/\\/g, '/').split('/src/')[1])).toEqual(['lib/passwordRecovery.js']);
    for (const file of files(srcDir)) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/redirectTo\s*:\s*`/);
    }
  });

  it('the sign-in page uses the shared auth client and the recovery helper', () => {
    const login = readFileSync(new URL('src/pages/Login.jsx', root), 'utf8');
    expect(login).toContain("from '@/lib/supabaseClient'");
    expect(login).toContain("from '@/lib/passwordRecovery'");
    expect(login).toContain('requestPasswordReset(supabase, resetEmail, window.location.origin)');
  });

  it('/reset-password is routed outside the sign-in gate, and the post-reset destination is fixed', () => {
    const app = readFileSync(new URL('src/App.jsx', root), 'utf8');
    const resetRoute = app.indexOf('path="/reset-password"');
    const gate = app.indexOf('<AuthGate>');
    expect(resetRoute).toBeGreaterThan(-1);
    expect(resetRoute).toBeLessThan(gate);

    const page = readFileSync(new URL('src/pages/ResetPassword.jsx', root), 'utf8');
    expect(page).toContain("window.location.assign('/')");
    expect(page).not.toMatch(/location\.assign\([^)]*(search|searchParams|hash|get\()/);
  });

  it('never renders text taken from the recovery URL (anyone can craft a link to the page)', () => {
    const page = readFileSync(new URL('src/pages/ResetPassword.jsx', root), 'utf8');
    expect(page).not.toMatch(/setMessage\(\s*link\./);
    expect(page).not.toMatch(/\{\s*link\./);
    expect(page).not.toMatch(/dangerouslySetInnerHTML/);
  });
});
