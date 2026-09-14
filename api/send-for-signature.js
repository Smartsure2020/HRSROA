// api/send-for-signature.js
// DocuSign eSignature integration using JWT authentication.
//
// Phase ROA-0 hardening:
//   • Server-side HRS authentication (Supabase JWT) is required before any
//     envelope call — see api/_lib/auth.js.
//   • The DocuSign environment (sandbox / production) is now resolved explicitly
//     from DOCUSIGN_ENVIRONMENT — see api/_lib/docusignConfig.js.
//   • The envelope definition (anchors, fail-closed signHereTabs, routing) is
//     built by the shared api/_lib/buildEnvelope.js so both ROA types share one
//     tested contract and the Personal / Commercial signature-label mismatch
//     cannot recur.
//   • The caller's authenticated identity must match the requested broker.

import { SignJWT, importPKCS8 } from 'jose';
import { createPrivateKey } from 'crypto';
import { requireAuthenticatedBroker } from './_lib/auth.js';
import { getDocusignConfig } from './_lib/docusignConfig.js';
import { buildEnvelope } from './_lib/buildEnvelope.js';
import { ROA_TYPES } from '../src/lib/pdf/signatureLabels.js';
import { BROKER_EMAIL_MAP } from '../src/lib/brokerDirectory.js';

async function getJWTAccessToken(authServer) {
  const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY;
  const userId = process.env.DOCUSIGN_USER_ID;
  const privateKeyRaw = process.env.DOCUSIGN_PRIVATE_KEY;

  if (!integrationKey || !userId || !privateKeyRaw) {
    throw new Error('Missing DocuSign JWT credentials');
  }

  // Vercel stores multiline env vars with literal \n — normalise them
  const privateKeyPem = privateKeyRaw.replace(/\\n/g, '\n');

  // DocuSign exports PKCS#1 keys (BEGIN RSA PRIVATE KEY); jose requires PKCS#8.
  // Node's createPrivateKey handles both formats, so we normalise here.
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Server-side authentication (Phase ROA-0). Only a signed-in HRS broker may
  // create envelopes — the endpoint was previously open.
  const user = await requireAuthenticatedBroker(req, res);
  if (!user) return;

  const {
    signerName,
    signerEmail,
    brokerName,
    brokerEmail,
    pdfBase64,
    pdfFilename,
    subject,
    message,
    roaType = 'Personal',
  } = req.body ?? {};

  if (!signerName || !signerEmail || !brokerName || !brokerEmail || !pdfBase64 || !pdfFilename) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // ROA type must be one the anchor contract knows about — buildEnvelope also
  // enforces this, but rejecting early gives a clearer 400 than a 500.
  if (!ROA_TYPES.includes(roaType)) {
    return res.status(400).json({ error: `Invalid roaType: expected one of ${ROA_TYPES.join(', ')}` });
  }

  // The broker being asked to sign must match the caller's authenticated HRS
  // identity. The BROKER_EMAIL_MAP is the authoritative source used elsewhere
  // in the app; we compare case-insensitively.
  const canonicalBrokerEmail = BROKER_EMAIL_MAP[brokerName];
  if (!canonicalBrokerEmail) {
    return res.status(400).json({ error: 'Unknown broker' });
  }
  if (canonicalBrokerEmail.toLowerCase() !== String(brokerEmail).toLowerCase()) {
    return res.status(400).json({ error: 'Broker email does not match broker directory' });
  }
  if (user.email && user.email.toLowerCase() !== canonicalBrokerEmail.toLowerCase()) {
    return res.status(403).json({ error: 'Authenticated user does not match requested broker' });
  }

  // Explicit environment selection — fail loudly if DOCUSIGN_ENVIRONMENT is set
  // to something unexpected rather than silently falling back to sandbox.
  let docusignConfig;
  try {
    docusignConfig = getDocusignConfig();
  } catch (err) {
    console.error('DocuSign config error:', err);
    return res.status(500).json({ error: 'DocuSign environment misconfigured' });
  }

  // Dev mock if no DocuSign credentials — after auth so unauthenticated callers
  // still cannot probe the endpoint.
  if (!process.env.DOCUSIGN_INTEGRATION_KEY) {
    console.log('\n✍️  [DEV] DocuSign mocked — no credentials configured');
    console.log('  Environment:', docusignConfig.environment);
    console.log('  Signer:', signerName, signerEmail);
    console.log('  Broker:', brokerName, brokerEmail);
    console.log('  Document:', pdfFilename);
    return res.status(200).json({
      ok: true,
      envelopeId: 'dev-mock-envelope-id',
      environment: docusignConfig.environment,
      message: 'Dev mock — no actual request sent',
    });
  }

  try {
    const accessToken = await getJWTAccessToken(docusignConfig.authServer);
    const accountId = process.env.DOCUSIGN_ACCOUNT_ID;

    // Shared, tested envelope shape — anchors and fail-closed signHereTabs live
    // in api/_lib/buildEnvelope.js and are locked to src/lib/pdf/signatureLabels.js.
    const envelope = buildEnvelope({
      roaType,
      signerName,
      signerEmail,
      brokerName,
      brokerEmail,
      pdfBase64,
      pdfFilename,
      subject,
      message,
    });

    const response = await fetch(
      `${docusignConfig.baseUrl}/v2.1/accounts/${accountId}/envelopes`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(envelope),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('DocuSign envelope error:', data);
      return res.status(response.status).json({
        error: data?.message || data?.errorCode || 'Failed to create DocuSign envelope',
      });
    }

    return res.status(200).json({
      ok: true,
      envelopeId: data.envelopeId,
      status: data.status,
      environment: docusignConfig.environment,
      message: `Signature request sent to ${signerEmail}. ${brokerName} will countersign after client.`,
    });

  } catch (err) {
    console.error('send-for-signature error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
