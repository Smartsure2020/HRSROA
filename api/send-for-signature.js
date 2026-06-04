// api/send-for-signature.js
// DocuSign eSignature integration using JWT authentication
// Uses 'jose' library for ESM-compatible JWT signing
// Run: npm install jose

import { SignJWT, importPKCS8 } from 'jose';
import { createPrivateKey } from 'crypto';

const DOCUSIGN_AUTH_SERVER = 'account-d.docusign.com'; // sandbox
const DOCUSIGN_BASE_URL = 'https://demo.docusign.net/restapi'; // sandbox

// For production, swap both to:
// const DOCUSIGN_AUTH_SERVER = 'account.docusign.com';
// const DOCUSIGN_BASE_URL = 'https://na4.docusign.net/restapi';

async function getJWTAccessToken() {
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
    aud: DOCUSIGN_AUTH_SERVER,
    iat: now,
    exp: now + 3600,
    scope: 'signature impersonation',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .sign(privateKey);

  const response = await fetch(`https://${DOCUSIGN_AUTH_SERVER}/oauth/token`, {
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

  // Dev mock if no credentials
  if (!process.env.DOCUSIGN_INTEGRATION_KEY) {
    console.log('\n✍️  [DEV] DocuSign mocked — no credentials configured');
    console.log('  Signer:', signerName, signerEmail);
    console.log('  Broker:', brokerName, brokerEmail);
    console.log('  Document:', pdfFilename);
    return res.status(200).json({
      ok: true,
      envelopeId: 'dev-mock-envelope-id',
      message: 'Dev mock — no actual request sent',
    });
  }

  try {
    const accessToken = await getJWTAccessToken();
    const accountId = process.env.DOCUSIGN_ACCOUNT_ID;

    const envelope = {
      emailSubject: subject || `Please sign your Record of Advice – ${signerName} | HRS Insurance`,
      emailBlurb: message || `Dear ${signerName},\n\nPlease review and sign your ${roaType} Lines Record of Advice from Holistic Risk Services (Pty) Ltd. This document is required under the Financial Advisory and Intermediary Services (FAIS) Act.\n\nKind regards,\nHolistic Risk Services (Pty) Ltd\nFSP No. 28582`,
      status: 'sent',
      documents: [
        {
          documentBase64: pdfBase64,
          name: pdfFilename.replace('.pdf', ''),
          fileExtension: 'pdf',
          documentId: '1',
        },
      ],
      recipients: {
        signers: [
          {
            name: signerName,
            email: signerEmail,
            recipientId: '1',
            routingOrder: '1',
            tabs: {
              signHereTabs: [
                {
                  documentId: '1',
                  pageNumber: '1',
                  anchorString: 'Client Signature',
                  anchorXOffset: '0',
                  anchorYOffset: '20',
                  anchorIgnoreIfNotPresent: 'true',
                },
              ],
              dateSignedTabs: [
                {
                  documentId: '1',
                  pageNumber: '1',
                  anchorString: 'Client Signature',
                  anchorXOffset: '0',
                  anchorYOffset: '35',
                  anchorIgnoreIfNotPresent: 'true',
                },
              ],
            },
          },
          {
            name: brokerName,
            email: brokerEmail,
            recipientId: '2',
            routingOrder: '2',
            tabs: {
              signHereTabs: [
                {
                  documentId: '1',
                  pageNumber: '1',
                  anchorString: 'Advisor / Broker Signature',
                  anchorXOffset: '0',
                  anchorYOffset: '20',
                  anchorIgnoreIfNotPresent: 'true',
                },
              ],
            },
          },
        ],
        carbonCopies: [
          {
            name: 'HRS Insurance',
            email: 'info@hrsinsurance.co.za',
            recipientId: '3',
            routingOrder: '3',
          },
        ],
      },
      notification: {
        useAccountDefaults: false,
        reminders: {
          reminderEnabled: 'true',
          reminderDelay: '1',
          reminderFrequency: '2',
        },
        expirations: {
          expireEnabled: 'true',
          expireAfter: '14',
          expireWarn: '2',
        },
      },
    };

    const response = await fetch(
      `${DOCUSIGN_BASE_URL}/v2.1/accounts/${accountId}/envelopes`,
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
      message: `Signature request sent to ${signerEmail}. ${brokerName} will countersign after client.`,
    });

  } catch (err) {
    console.error('send-for-signature error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}