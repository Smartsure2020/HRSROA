// Server-trusted subject/body for the e-signature invitation.
//
// Built only from the authenticated broker (directory lookup) and the frozen signer name,
// never from browser input, so the client sees exactly which broker invited them while the
// request cannot be used to inject arbitrary email text. The visible From name/address is NOT
// set here: it is controlled by the signing provider's own email configuration (see
// ROA_Post_Production_Polish.md), while replies go to the broker via `emailReplyTo`.

export function buildSigningInviteCopy({ signerName, brokerName }) {
  const broker = String(brokerName || '').trim() || 'your HRS broker';
  const client = String(signerName || '').trim();
  return {
    subject: `Please sign your Record of Advice from ${broker} | HRS Insurance`,
    message: [
      client ? `Dear ${client},` : 'Hello,',
      '',
      `${broker} of Holistic Risk Services (Pty) Ltd (FSP No. 28582) has sent you your Record of Advice to review and sign. This document is required under the Financial Advisory and Intermediary Services (FAIS) Act.`,
      '',
      `If you have any questions, simply reply to this email to reach ${broker} directly.`,
      '',
      'Kind regards,',
      broker,
      'Holistic Risk Services (Pty) Ltd',
    ].join('\n'),
  };
}
