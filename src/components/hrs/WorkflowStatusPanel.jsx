// Compact, truthful workflow-status panel (Phase 3, section 10).
//
// Deliberately small — a row of badges, not a dashboard. Only shows statuses this
// application can actually prove; never claims "Client signed", "Advisor signed" or
// "Final document stored" without evidence, and uses neutral language ("Not tracked",
// "Status not yet tracked") where the app has no visibility into a downstream system.
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
    return new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}

/**
 * Truthful workflow-status panel. Phase ROA-1 adds durable states derived
 * from the `submission` row when available:
 *   • Canonical PDF stored → good (with SHA-256 fragment)
 *   • Signing-provider envelope + status (sent / delivered / completed / declined / …)
 *   • Final signed document stored → good iff signed.pdf exists
 *   • Certificate of Completion stored → good iff certificate.pdf exists
 *
 * When `submission` is absent the panel falls back to the ROA-0 prop-driven
 * behaviour so pre-submit / older callers still work.
 */
export default function WorkflowStatusPanel({
  roaPrepared = true,
  emailStatus = 'not_attempted',
  emailSentAt = null,
  crmStatus = 'idle',
  crmSyncedAt = null,
  checklistComplete = false,
  docusignStatus = 'not_sent',
  docusignSentAt = null,
  submission = null,
}) {
  const canonicalStored = Boolean(submission?.hasCanonicalPdf);
  const envelopeId = submission?.signingEnvelopeId || submission?.docusignEnvelopeId || null;
  const signingStatus = submission?.signingStatus || submission?.docusignStatus || null;
  const signingProvider = submission?.signingProvider || (submission?.docusignEnvelopeId ? 'docusign' : null);
  const docusignSentAtDerived = submission?.sentForSignatureAt || docusignSentAt;
  const signedStored = Boolean(submission?.hasSignedPdf);
  const certificateStored = Boolean(submission?.hasCertificate);
  const auditLogStored = Boolean(submission?.hasAuditLog);
  const completedAt = submission?.completedAt || null;
  const evidenceRetrievedAt = submission?.evidenceRetrievedAt || null;
  const sha256Frag = submission?.pdfSha256 ? `SHA-256 ${String(submission.pdfSha256).slice(0, 12)}…` : null;

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
        label="Signing provider"
        tone={envelopeId ? "good" : (docusignStatus === 'envelope_created' ? "pending" : "neutral")}
        icon={envelopeId ? Check : (docusignStatus === 'envelope_created' ? Check : Minus)}
        timestamp={fmtTime(docusignSentAtDerived)}
      >
        {envelopeId
          ? `${signingProvider || 'E-signature'} · ${envelopeId.slice(0, 8)}…`
          : (docusignStatus === 'envelope_created' ? "Envelope created" : "Not sent")}
      </StatusRow>

      <StatusRow
        label="Signature status"
        tone={signingStatus === 'completed' ? "good" : (signingStatus ? "pending" : "neutral")}
        icon={signingStatus === 'completed' ? Check : Minus}
        timestamp={fmtTime(completedAt)}
      >
        {!signingStatus && "Not tracked"}
        {signingStatus === 'sent' && "Awaiting client signature"}
        {signingStatus === 'delivered' && "Client viewed — awaiting signature"}
        {signingStatus === 'completed' && "Signed"}
        {signingStatus === 'declined' && "Declined"}
        {signingStatus === 'voided' && "Voided"}
        {signingStatus === 'expired' && "Expired"}
        {signingStatus && !['sent','delivered','completed','declined','voided','expired'].includes(signingStatus) && signingStatus}
      </StatusRow>

      <StatusRow
        label="Final signed document stored"
        tone={signedStored ? "good" : (signingStatus === 'completed' ? "pending" : "neutral")}
        icon={signedStored ? Check : Minus}
      >
        {signedStored ? "Stored" : (signingStatus === 'completed' ? "Retrieving…" : "Not yet")}
      </StatusRow>

      <StatusRow
        label="Certificate of Completion stored"
        tone={certificateStored ? "good" : (signingStatus === 'completed' ? "pending" : "neutral")}
        icon={certificateStored ? Check : Minus}
        timestamp={fmtTime(evidenceRetrievedAt)}
      >
        {certificateStored ? "Stored" : (signingStatus === 'completed' ? "Retrieving…" : "Not yet")}
      </StatusRow>

      <StatusRow
        label="Audit log stored"
        tone={auditLogStored ? "good" : (signingStatus === 'completed' ? "pending" : "neutral")}
        icon={auditLogStored ? Check : Minus}
      >
        {auditLogStored ? "Stored" : (signingStatus === 'completed' ? "Retrieving…" : "Not yet")}
      </StatusRow>
    </div>
  );
}
