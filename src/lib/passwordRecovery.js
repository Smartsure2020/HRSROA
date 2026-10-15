// Password recovery for brokers — runs entirely against the CRM Supabase Auth
// project (the same account and password the broker uses in the CRM).
//
// Open-redirect posture: the `redirectTo` we hand to Supabase is built from the
// app's OWN origin plus a fixed path. No query string, no user input and no
// attacker-controllable value is ever included, and the post-reset destination is
// fixed in ResetPassword.jsx. Supabase additionally only honours redirect URLs on
// the CRM project's allowlist (see ROA_CRM_Auth_Integration.md).

export const RESET_PASSWORD_PATH = '/reset-password';
export const MIN_PASSWORD_LENGTH = 8;

/** The only redirect destination ROA ever asks Supabase to use for recovery. */
export function passwordResetRedirectUrl(origin) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error('invalid_origin');
  }
  const isHttp = parsed.protocol === 'https:' || parsed.protocol === 'http:';
  if (!isHttp || parsed.username || parsed.password) throw new Error('invalid_origin');
  return `${parsed.origin}${RESET_PASSWORD_PATH}`;
}

/** Sends the recovery email through the given (CRM-bound) Supabase client. */
export async function requestPasswordReset(client, email, origin) {
  const redirectTo = passwordResetRedirectUrl(origin);
  const { error } = await client.auth.resetPasswordForEmail(String(email).trim(), { redirectTo });
  if (error) throw error;
}

/**
 * Reads whatever Supabase put on the recovery link. Supabase can deliver the
 * session three ways depending on the project's email template / flow type:
 *   • URL fragment tokens   (implicit flow; supabase-js consumes these itself)
 *   • `?code=`              (PKCE)
 *   • `?token_hash=&type=`  (custom template using verifyOtp)
 * and reports an expired/used link via error parameters.
 */
export function parseRecoveryLink(search = '', hash = '') {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(String(hash).replace(/^#/, ''));

  const error = query.get('error_description') || fragment.get('error_description')
    || query.get('error') || fragment.get('error');
  return {
    error: error || null,
    code: query.get('code'),
    tokenHash: query.get('token_hash'),
    type: query.get('type') || fragment.get('type'),
    hasFragmentTokens: fragment.has('access_token'),
  };
}

/**
 * Turns a recovery link into a session where the link requires an explicit
 * exchange. Fragment tokens need nothing here — supabase-js consumes them when the
 * client is created. Returns whether an exchange was attempted.
 */
export async function exchangeRecoveryLink(client, link) {
  if (link.tokenHash && (link.type === 'recovery' || !link.type)) {
    const { error } = await client.auth.verifyOtp({ token_hash: link.tokenHash, type: 'recovery' });
    if (error) throw error;
    return true;
  }
  if (link.code) {
    const { error } = await client.auth.exchangeCodeForSession(link.code);
    if (error) throw error;
    return true;
  }
  return false;
}

/** Client-side password rules; Supabase's own policy still has the final say. */
export function validateNewPassword(password, confirmation) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirmation) return 'The two passwords do not match.';
  return null;
}
