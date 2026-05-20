// api/send-for-signature.js
// Dropbox Sign (HelloSign) e-signature integration
// Requires: DROPBOX_SIGN_API_KEY environment variable in Vercel
// Free tier: 3 signature requests/month. Paid: $15/month for 15 requests.
// Docs: https://developers.hellosign.com/api/reference/

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    signerName,       // Client full name
    signerEmail,      // Client email
    brokerName,       // Broker name
    brokerEmail,      // Broker email
    pdfBase64,        // The completed ROA PDF as base64
    pdfFilename,      // e.g. HRS_ROA_John_Smith_2026-05-20.pdf
    subject,          // Email subject for the signing request
    message,          // Message shown to signer
  } = req.body ?? {};

  if (!signerName || !signerEmail || !brokerName || !brokerEmail || !pdfBase64 || !pdfFilename) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const apiKey = process.env.DROPBOX_SIGN_API_KEY;
  if (!apiKey) {
    console.log('\n✍️  [DEV] Dropbox Sign mocked (no DROPBOX_SIGN_API_KEY configured)');
    console.log('  Signer:', signerName, signerEmail);
    console.log('  Broker:', brokerName, brokerEmail);
    console.log('  Document:', pdfFilename, '\n');
    return res.status(200).json({
      ok: true,
      signatureRequestId: 'dev-mock-id',
      signingUrl: null,
      message: 'Dev mock — no actual request sent',
    });
  }

  try {
    // Convert base64 PDF to a Buffer
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');

    // Build multipart form data for Dropbox Sign API
    const { FormData, Blob } = await import('formdata-node');
    const form = new FormData();

    // Document
    form.set('file[0]', new Blob([pdfBuffer], { type: 'application/pdf' }), pdfFilename);

    // Title and message
    form.set('title', subject || `ROA Signature Request – ${signerName}`);
    form.set('message', message || `Please review and sign your Record of Advice from Holistic Risk Services (Pty) Ltd. This is a legally required document under the FAIS Act.`);

    // Signers — client first, then broker
    form.set('signers[0][name]', signerName);
    form.set('signers[0][email_address]', signerEmail);
    form.set('signers[0][order]', '0');

    form.set('signers[1][name]', brokerName);
    form.set('signers[1][email_address]', brokerEmail);
    form.set('signers[1][order]', '1');

    // Options
    form.set('test_mode', process.env.NODE_ENV === 'production' ? '0' : '1');
    form.set('use_text_tags', '0');
    form.set('hide_text_tags', '0');
    form.set('allow_decline', '1');
    form.set('allow_reassign', '0');

    // CC the HRS info address for audit trail
    form.set('cc_email_addresses[0]', 'info@hrsinsurance.co.za');

    const response = await fetch('https://api.hellosign.com/v3/signature_request/send', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
      },
      body: form,
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Dropbox Sign error:', data);
      return res.status(response.status).json({
        error: data?.error?.error_msg || 'Failed to send signature request',
      });
    }

    const signatureRequest = data.signature_request;

    return res.status(200).json({
      ok: true,
      signatureRequestId: signatureRequest.signature_request_id,
      signingUrl: signatureRequest.signing_url || null,
      detailsUrl: signatureRequest.details_url,
      message: `Signature request sent to ${signerEmail}`,
    });

  } catch (err) {
    console.error('send-for-signature error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}