// DocuSign JWT bearer helper (Phase ROA-1 — extracted from send-for-signature.js).
//
// Turns the DOCUSIGN_INTEGRATION_KEY / DOCUSIGN_USER_ID / DOCUSIGN_PRIVATE_KEY
// tuple into a short-lived access token via the DocuSign OAuth JWT grant.
// The private key normalisation (PKCS#1 → PKCS#8) is preserved verbatim from
// the ROA-0 implementation so behaviour does not drift.

import { SignJWT, importPKCS8 } from 'jose';
import { createPrivateKey } from 'crypto';

export async function getDocusignAccessToken(authServer) {
  const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY;
  const userId = process.env.DOCUSIGN_USER_ID;
  const privateKeyRaw = process.env.DOCUSIGN_PRIVATE_KEY;

  if (!integrationKey || !userId || !privateKeyRaw) {
    throw new Error('Missing DocuSign JWT credentials');
  }
  if (!authServer) throw new Error('getDocusignAccessToken: authServer is required');

  // Vercel stores multiline env vars with literal \n — normalise them.
  const privateKeyPem = privateKeyRaw.replace(/\\n/g, '\n');

  // DocuSign exports PKCS#1 keys (BEGIN RSA PRIVATE KEY); jose requires PKCS#8.
  const pkcs8Pem = privateKeyPem.includes('BEGIN PRIVATE KEY')
    ? privateKeyPem
    : createPrivateKey(privateKeyPem).export({ type: 'pkcs8', format: 'pem' });

  const privateKey = await importPKCS8(pkcs8Pem, 'RS256');

  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({
    iss: integrationKey,
    sub: userId,
    aud: authServer,
    iat: now,
    exp: now + 3600,
    scope: 'signature impersonation',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .sign(privateKey);

  const response = await fetch(`https://${authServer}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error_description || data?.error || 'Failed to get DocuSign access token');
  }
  return data.access_token;
}
