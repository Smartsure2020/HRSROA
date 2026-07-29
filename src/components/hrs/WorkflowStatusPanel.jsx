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
 * @param {object} props
 * @param {boolean} [props.roaPrepared]
 * @param {'sent'|'failed'|'not_attempted'} [props.emailStatus]
 * @param {string|null} [props.emailSentAt]
 * @param {'idle'|'syncing'|'synced'|'failed'} [props.crmStatus]
 * @param {string|null} [props.crmSyncedAt]
 * @param {boolean} [props.checklistComplete]
 * @param {'not_sent'|'envelope_created'} [props.docusignStatus]
 * @param {string|null} [props.docusignSentAt]
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
}) {
  return (
    <div className="rounded-lg border border-hrs-border bg-card p-3.5">
      <p className="text-[0.7rem] uppercase tracking-[0.1em] text-hrs-muted mb-2">Workflow Status</p>

      <StatusRow label="ROA prepared" tone={roaPrepared ? "good" : "neutral"} icon={roaPrepared ? Check : Minus}>
        {roaPrepared ? "Complete" : "Not yet generated"}
      </StatusRow>

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
        label="DocuSign"
        tone={docusignStatus === 'envelope_created' ? "pending" : "neutral"}
        icon={docusignStatus === 'envelope_created' ? Check : Minus}
        timestamp={fmtTime(docusignSentAt)}
      >
        {docusignStatus === 'envelope_created' ? "Envelope created" : "Not sent"}
      </StatusRow>

      <StatusRow label="Client signature" tone="neutral" icon={Minus}>
        {docusignStatus === 'envelope_created' ? "Awaiting external confirmation" : "Not tracked"}
      </StatusRow>

      <StatusRow label="Final signed document" tone="neutral" icon={Minus}>
        Not yet stored by the ROA application
      </StatusRow>
    </div>
  );
}
