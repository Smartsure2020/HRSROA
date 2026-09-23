// Compact, truthful workflow-status panel.
//
// Only shows states the application can prove from durable ROA evidence and
// provider metadata. It does not infer which recipient has signed unless the
// provider lifecycle explicitly proves overall completion.
import { Check, X, Loader2, Minus } from "lucide-react";

const TONE_CLASSES = {
  good: "bg-hrs-green/10 text-hrs-green border-hrs-green/30",
  bad: "bg-hrs-red/10 text-hrs-red border-hrs-red/30",
  neutral: "bg-secondary text-hrs-muted border-hrs-border",
  pending: "bg-amber-50 text-amber-700 border-amber-300",
};

function Badge({ tone, icon: Icon, children }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[0.72rem] font-semibold ${TONE_CLASSES[tone]}`}>
      {Icon && <Icon className="w-3 h-3" />}
      {children}
    </span>
  );
}

function StatusRow({ label, tone, icon, children, timestamp = null }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-hrs-border last:border-b-0">
      <span className="text-[0.78rem] text-hrs-blue2 font-medium">{label}</span>
      <div className="flex items-center gap-2">
        {timestamp && <span className="text-[0.68rem] text-hrs-muted">{timestamp}</span>}
        <Badge tone={tone} icon={icon}>{children}</Badge>
      </div>
    </div>
  );
}

function fmtTime(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString('en-ZA', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

function signatureStatusLabel(status) {
  if (!status) return 'Not tracked';

  return {
    draft: 'Preparing envelope',
    pending: 'Awaiting signatures',
    completed: 'Signed',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
  }[status] || status;
}

export default function WorkflowStatusPanel({
  roaPrepared = true,
  emailStatus = 'not_attempted',
  emailSentAt = null,
  crmStatus = 'idle',
  crmSyncedAt = null,
  checklistComplete = false,
  signatureStatus = 'not_sent',
  signatureSentAt = null,
  submission = null,
}) {
  const canonicalStored = Boolean(submission?.hasCanonicalPdf);
  const envelopeId = submission?.signatureEnvelopeId || null;
  const provider = submission?.signatureProvider || (envelopeId ? 'documenso' : null);
  const providerStatus = submission?.signatureStatus || null;
  const sentAt = submission?.sentForSignatureAt || signatureSentAt;
  const signedStored = Boolean(submission?.hasSignedPdf);
  const certificateStored = Boolean(submission?.hasCertificate);
  const auditStored = Boolean(submission?.hasAuditLog);
  const completedAt = submission?.completedAt || null;
  const evidenceRetrievedAt = submission?.evidenceRetrievedAt || null;
  const sha256Frag = submission?.pdfSha256
    ? `SHA-256 ${String(submission.pdfSha256).slice(0, 12)}…`
    : null;

  const envelopeCreated = Boolean(envelopeId);
  const providerComplete = providerStatus === 'completed';

  return (
    <div className="rounded-lg border border-hrs-border bg-card p-3.5">
      <p className="text-[0.7rem] uppercase tracking-[0.1em] text-hrs-muted mb-2">Workflow Status</p>

      <StatusRow label="ROA prepared" tone={roaPrepared ? "good" : "neutral"} icon={roaPrepared ? Check : Minus}>
        {roaPrepared ? "Complete" : "Not yet generated"}
      </StatusRow>

      {submission && (
        <StatusRow
          label="Canonical PDF stored"
          tone={canonicalStored ? "good" : "bad"}
          icon={canonicalStored ? Check : X}
          timestamp={fmtTime(submission?.submittedAt)}
        >
          {canonicalStored ? (sha256Frag || 'Stored') : 'Not stored'}
        </StatusRow>
      )}

      <StatusRow
        label="Submission email"
        tone={emailStatus === 'sent' ? "good" : emailStatus === 'failed' ? "bad" : "neutral"}
        icon={emailStatus === 'sent' ? Check : emailStatus === 'failed' ? X : Minus}
        timestamp={fmtTime(emailSentAt)}
      >
        {emailStatus === 'sent' ? "Sent" : emailStatus === 'failed' ? "Failed" : "Not attempted"}
      </StatusRow>

      <StatusRow
        label="CRM synchronisation"
        tone={crmStatus === 'synced' ? "good" : crmStatus === 'failed' ? "bad" : crmStatus === 'syncing' ? "pending" : "neutral"}
        icon={crmStatus === 'synced' ? Check : crmStatus === 'failed' ? X : crmStatus === 'syncing' ? Loader2 : Minus}
        timestamp={fmtTime(crmSyncedAt)}
      >
        {crmStatus === 'synced' ? "Synced" : crmStatus === 'failed' ? "Failed — retry available" : crmStatus === 'syncing' ? "Syncing…" : "Not attempted"}
      </StatusRow>

      <StatusRow label="Checklist" tone={checklistComplete ? "good" : "pending"} icon={checklistComplete ? Check : Minus}>
        {checklistComplete ? "Complete" : "In progress"}
      </StatusRow>

      <StatusRow
        label="Signing envelope"
        tone={envelopeCreated ? (providerStatus === 'draft' ? "pending" : "good") : "neutral"}
        icon={envelopeCreated ? Check : Minus}
        timestamp={fmtTime(sentAt)}
      >
        {envelopeCreated
          ? `${provider === 'documenso' ? 'Documenso' : 'Provider'} · ${envelopeId.slice(0, 8)}…`
          : (signatureStatus === 'envelope_created' ? "Preparing…" : "Not sent")}
      </StatusRow>

      <StatusRow
        label="E-signature status"
        tone={providerComplete ? "good" : providerStatus === 'rejected' || providerStatus === 'cancelled' ? "bad" : providerStatus ? "pending" : "neutral"}
        icon={providerComplete ? Check : providerStatus === 'rejected' || providerStatus === 'cancelled' ? X : Minus}
        timestamp={fmtTime(completedAt)}
      >
        {signatureStatusLabel(providerStatus)}
      </StatusRow>

      <StatusRow
        label="Final signed document stored"
        tone={signedStored ? "good" : providerComplete ? "pending" : "neutral"}
        icon={signedStored ? Check : Minus}
      >
        {signedStored ? "Stored" : providerComplete ? "Retrieving…" : "Not yet"}
      </StatusRow>

      <StatusRow
        label="Signing certificate stored"
        tone={certificateStored ? "good" : providerComplete ? "pending" : "neutral"}
        icon={certificateStored ? Check : Minus}
      >
        {certificateStored ? "Stored" : providerComplete ? "Retrieving…" : "Not yet"}
      </StatusRow>

      <StatusRow
        label="Signing audit log stored"
        tone={auditStored ? "good" : providerComplete ? "pending" : "neutral"}
        icon={auditStored ? Check : Minus}
        timestamp={fmtTime(evidenceRetrievedAt)}
      >
        {auditStored ? "Stored" : providerComplete ? "Retrieving…" : "Not yet"}
      </StatusRow>
    </div>
  );
}
