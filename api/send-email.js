export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, subject, body, pdfBase64, pdfFilename } = req.body ?? {};

  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('\n📧 [DEV] Email send mocked (no RESEND_API_KEY configured)');
    console.log('  To:', to);
    console.log('  Subject:', subject);
    console.log('  Attachment:', pdfFilename || 'none', '\n');
    return res.status(200).json({ ok: true, id: 'dev-mock' });
  }

  const payload = {
    from: 'HRS Insurance <info@hrsinsurance.co.za>',
    to: [to],
    subject,
    text: body,
    ...(pdfBase64 && {
      attachments: [{ filename: pdfFilename || 'HRS_ROA.pdf', content: pdfBase64 }],
    }),
  };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Resend error:', data);
    return res.status(response.status).json({ error: data.message || 'Failed to send email' });
  }

  return res.status(200).json({ ok: true, id: data.id });
}