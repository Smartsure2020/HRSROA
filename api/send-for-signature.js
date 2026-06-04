// api/send-for-signature.js
// DocuSign eSignature integration using JWT authentication
// Environment variables required:
//   DOCUSIGN_INTEGRATION_KEY
//   DOCUSIGN_SECRET_KEY
//   DOCUSIGN_ACCOUNT_ID
//   DOCUSIGN_USER_ID
//   DOCUSIGN_PRIVATE_KEY

import * as jwt from 'jsonwebtoken';

const DOCUSIGN_AUTH_SERVER = 'account-d.docusign.com'; // sandbox
const DOCUSIGN_BASE_URL = 'https://demo.docusign.net/restapi'; // sandbox

// For production, swap both to:
// const DOCUSIGN_AUTH_SERVER = 'account.docusign.com';
// const DOCUSIGN_BASE_URL = 'https://na4.docusign.net/restapi';

async function getJWTAccessToken() {
  const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY;
  const userId = process.env.DOCUSIGN_USER_ID;
  const privateKey = process.env.DOCUSIGN_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!integrationKey || !userId || !privateKey) {
    throw new Error('Missing DocuSign JWT credentials');
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: integrationKey,
    sub: userId,
    aud: DOCUSIGN_AUTH_SERVER,
    iat: now,
    exp: now + 3600,
    scope: 'signature impersonation',
  };

  const assertion = jwt.sign(payload, privateKey, { algorithm: 'RS256' });

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
    roaType = 'Personal', // 'Personal' or 'Commercial'
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

    // Build the DocuSign envelope
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
            // Client signs first
            name: signerName,
            email: signerEmail,
            recipientId: '1',
            routingOrder: '1',
            tabs: {
              signHereTabs: [
                {
                  // Position signature on the last page at the client signature area
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
            // Broker signs second
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
      message: `Signature request sent to ${signerEmail}. Broker (${brokerEmail}) will sign after client.`,
    });

  } catch (err) {
    console.error('send-for-signature error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}