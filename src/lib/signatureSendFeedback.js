export function buildSignatureSendFeedback(result, recipientEmail) {
  const title = result?.alreadySent
    ? 'Signature request already sent'
    : result?.recovered
      ? 'Signature request recovered'
      : 'Signature request sent';
  return {
    title,
    description: `Sent to ${recipientEmail}. This ROA will update automatically as signing progresses.`,
  };
}
