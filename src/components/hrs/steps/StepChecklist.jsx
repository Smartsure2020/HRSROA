import { useState, useRef, useEffect } from "react";
import { CheckCircle, FileDown, FilePlus, Send, RefreshCw } from "lucide-react";
import FormCard from "../FormCard";
import WorkflowStatusPanel from "../WorkflowStatusPanel";
import { generateCombinedPDF } from "../../../lib/hrsPdfGenerator";
import { MANAGER_NAME } from "../../../lib/hrsConstants";
import { syncPersonalROAToCRM } from "../../../lib/crmAdapter";
import { useCrmSyncStatus } from "../../../lib/useCrmSyncStatus";
import { toast } from "@/components/ui/use-toast";
import { buildSignatureSendFeedback } from "../../../lib/signatureSendFeedback";
import {
  attachCrmIds,
  downloadEvidencePdf,
  refreshSubmission,
  sendForSignature as sendForSignatureApi,
} from "../../../lib/roaSubmissionClient";

function InfoRow({ label, value }) {
  return (
    <div className="flex border-b border-hrs-border py-1.5 gap-3">
      <span className="text-[0.75rem] font-semibold text-hrs-blue2 min-w-[140px] flex-shrink-0">{label}</span>
      <span className="text-[0.82rem] text-hrs-blue flex-1">{value || ""}</span>
    </div>
  );
}

function SectionBar({ title, right }) {
  return (
    <div className="flex items-center justify-between bg-hrs-blue text-white px-3 py-1.5 mt-4 mb-0 rounded-t-md">
      <span className="text-[0.72rem] font-bold uppercase tracking-[0.1em]">{title}</span>
      {right && <span className="text-[0.68rem] opacity-80">{right}</span>}
    </div>
  );
}

function YesNoRow({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-hrs-border gap-3">
      <span className="text-[0.78rem] text-hrs-blue flex-1">{label}</span>
      <div className="flex gap-1.5 flex-shrink-0">
        <button type="button" onClick={() => onChange(value === 'yes' ? null : 'yes')}
          className={`px-3 py-0.5 rounded border text-[0.72rem] font-semibold transition-all ${value === 'yes' ? 'bg-hrs-green text-white border-hrs-green' : 'border-hrs-border text-hrs-muted hover:border-hrs-green'}`}>
          Yes
        </button>
        <button type="button" onClick={() => onChange(value === 'no' ? null : 'no')}
          className={`px-3 py-0.5 rounded border text-[0.72rem] font-semibold transition-all ${value === 'no' ? 'bg-hrs-red text-white border-hrs-red' : 'border-hrs-border text-hrs-muted hover:border-hrs-red'}`}>
          No
        </button>
      </div>
    </div>
  );
}

function CheckItem({ label, checked, onChange }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-hrs-border cursor-pointer" onClick={() => onChange(!checked)}>
      <div className={`w-4 h-4 rounded border-[1.5px] flex-shrink-0 flex items-center justify-center transition-colors ${checked ? "bg-hrs-green border-hrs-green" : "border-hrs-border bg-white"}`}>
        {checked && <span className="text-white text-[0.6rem] font-bold">✓</span>}
      </div>
      <span className="text-[0.75rem] text-hrs-blue">{label}</span>
    </div>
  );
}

const COMPLIANCE_DOCS = [
  "PROPOSAL", "BROKER APPOINTMENT", "DEBIT ORDER AUTHORITY",
  "ROA | RECORD OF ADVICE", "CURRENT POLICY SCHEDULE",
  "PROOF OF PREVIOUS INSURANCE", "SEC 13 CERTIFICATE AND DISCLOSURE",
  "CLIENT CONSENT TO CHARGE BROKER FEE",
];

const ADDITIONAL_DOCS = [
  "CELLPHONES | MAKE | MODEL | IMEI NO'S", "ELECTRONICS | MAKE | MODEL | SERIAL NO'S",
  "VEHICLE REGISTRATION CERTIFICATES", "VEHICLE REGISTRATION - ENGINE AND VIN NO'S",
  "PROOF OF TRACKING DEVICE INSTALLATIONS", "PROOF OF PURCHASES ON HIGH VALUE ITEMS",
  "VALUATION CERTIFICATES ON HIGH VALUE JEWELLERY",
];

const COMMISSION_ROWS = ["Brokerage (HRS)", "Broker", "Referror", "Other"];

export default function StepChecklist({ data, submission, onSubmissionUpdate, onRestart }) {
  const fullName = [data.title, data.firstName, data.surname].filter(Boolean).join(' ') || '-';
  const address = [data.streetNumber, data.streetName, data.complexName, data.suburb, data.city, data.province, data.postalCode].filter(Boolean).join(', ') || '-';

  const [smartsure, setSmartsure] = useState(null);
  const [directInsurer, setDirectInsurer] = useState(null);
  const [complianceDocs, setComplianceDocs] = useState({});
  const [additionalDocs, setAdditionalDocs] = useState({});
  const [comments, setComments] = useState('');
  const [trackDates, setTrackDates] = useState({ docs: '', submitted: '', email: '' });
  const [businessType, setBusinessType] = useState('Personal');
  const [acctExec, setAcctExec] = useState(data.brokerName || MANAGER_NAME);
  const [downloading, setDownloading] = useState(null);
  const [combinedDownloaded, setCombinedDownloaded] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [commissions, setCommissions] = useState({
    "Brokerage (HRS)": "",
    "Broker": "",
    "Referror": "",
    "Other": "",
  });

  // Provider-neutral e-signature state — derived from `submission` so
  // a page refresh does not reset the "sent" indicator.
  const [sigSending, setSigSending] = useState(false);
  const [sigError, setSigError] = useState(null);
  const sigSent = Boolean(submission?.signingEnvelopeId || submission?.docusignEnvelopeId);
  const sigEnvelopeId = submission?.signingEnvelopeId || submission?.docusignEnvelopeId || null;
  const sigSentAt = submission?.sentForSignatureAt || null;

  // CRM sync status + retry (Phase 3, section 9). Triggered once on mount — the ROA email
  // has already been sent successfully by the time this screen is reachable.
  const crm = useCrmSyncStatus(syncPersonalROAToCRM);
  const crmTriggered = useRef(false);
  const crmAttachedIdsRef = useRef(false);
  useEffect(() => {
    if (crmTriggered.current) return;
    crmTriggered.current = true;
    crm.sync(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After a successful CRM sync, attach the returned CRM ids to the durable
  // roa_submissions row so the two systems can be reconciled later.
  useEffect(() => {
    if (crmAttachedIdsRef.current) return;
    if (!submission?.submissionId) return;
    if (crm.status !== 'synced') return;
    if (!crm.result?.clientId && !crm.result?.dealId) return;
    crmAttachedIdsRef.current = true;
    attachCrmIds(submission.submissionId, {
      crmClientId: crm.result.clientId,
      crmDealId: crm.result.dealId,
    })
      .then((updated) => { if (updated && onSubmissionUpdate) onSubmissionUpdate(updated); })
      .catch(() => { /* silent — CRM ids are non-critical for ROA lifecycle */ });
  }, [crm.status, crm.result, submission?.submissionId, onSubmissionUpdate]);

  // Poll signing status on mount + until all provider evidence is retained.
  // The browser only calls the provider-neutral server endpoint.
  useEffect(() => {
    if (!submission?.submissionId) return;
    const isTerminal = submission.status === 'completed'
      && submission.hasSignedPdf
      && submission.hasCertificate
      && (submission.signingProvider !== 'documenso' || submission.hasAuditLog);
    if (isTerminal) return;
    let cancelled = false;
    async function tick() {
      try {
        const updated = await refreshSubmission(submission.submissionId);
        if (!cancelled && updated && onSubmissionUpdate) onSubmissionUpdate(updated);
      } catch { /* transient — will retry */ }
    }
    tick();
    const interval = setInterval(tick, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [submission?.submissionId, submission?.status, submission?.signingProvider, submission?.hasSignedPdf, submission?.hasCertificate, submission?.hasAuditLog, onSubmissionUpdate]);

  const netPrem = parseFloat(data.prem2) || 0;
  const feeVal = parseFloat(data.brokerFeePercent) || 0;
  const feeAmount = data.brokerFeeType === 'fixed' ? feeVal : (netPrem * feeVal / 100);
  const totalPrem = netPrem + feeAmount;
  const feeDisplayStr = data.brokerFeePercent
    ? (data.brokerFeeType === 'fixed' ? `R ${feeVal.toFixed(2)}` : `R ${feeAmount.toFixed(2)} (${feeVal}%)`)
    : '';

  const getChecklistState = () => ({
    smartsure, directInsurer, complianceDocs, additionalDocs,
    comments, trackDates, businessType, acctExec, commissions,
  });

  const handleDownloadROA = async () => {
    if (!submission?.submissionId) return;
    setDownloading('roa');
    try {
      await downloadEvidencePdf(submission.submissionId, 'canonical', `HRS_ROA_${submission.submissionId}.pdf`);
    } finally {
      setDownloading(null);
    }
  };

  // Combined ROA + Checklist is a working document for HRS admin. Post-ROA-1
  // the canonical ROA is authoritative and must not be regenerated from
  // formData; the combined download therefore only augments the on-screen
  // wizard data with the checklist, and the resulting file is explicitly a
  // working copy — not the canonical evidence. Encourage the broker to use
  // the canonical download for the authoritative record.
  const handleDownloadCombined = async () => {
    setDownloading('combined');
    try { await generateCombinedPDF(data, getChecklistState()); }
    finally { setDownloading(null); }
    setCombinedDownloaded(true);
  };

  const handleDownloadSigned = async () => {
    if (!submission?.submissionId || !submission.hasSignedPdf) return;
    setDownloading('signed');
    try {
      await downloadEvidencePdf(submission.submissionId, 'signed', `HRS_ROA_${submission.submissionId}_signed.pdf`);
    } finally {
      setDownloading(null);
    }
  };

  const handleDownloadCertificate = async () => {
    if (!submission?.submissionId || !submission.hasCertificate) return;
    setDownloading('certificate');
    try {
      await downloadEvidencePdf(submission.submissionId, 'certificate', `HRS_ROA_${submission.submissionId}_certificate.pdf`);
    } finally {
      setDownloading(null);
    }
  };

  const handleDownloadAuditLog = async () => {
    if (!submission?.submissionId || !submission.hasAuditLog) return;
    setDownloading('audit-log');
    try {
      await downloadEvidencePdf(submission.submissionId, 'audit-log', `HRS_ROA_${submission.submissionId}_audit-log.pdf`);
    } finally { setDownloading(null); }
  };

  const handleSendForSignature = async () => {
    if (!submission?.submissionId) return;
    const clientEmail = data.email;
    const clientName = fullName;
    if (!clientEmail) {
      setSigError('No client email address found. Please ensure the client email was entered in Step 1.');
      return;
    }

    setSigSending(true);
    setSigError(null);
    try {
      const result = await sendForSignatureApi({
        submissionId: submission.submissionId,
        signerName: clientName,
        signerEmail: clientEmail,
        subject: `Please sign your Record of Advice – ${clientName} | HRS Insurance`,
        message: `Dear ${clientName},\n\nPlease review and sign your Personal Lines Record of Advice from Holistic Risk Services (Pty) Ltd. This document is required under the Financial Advisory and Intermediary Services (FAIS) Act.\n\nKind regards,\n${data.brokerName}\nHolistic Risk Services (Pty) Ltd\nFSP No. 28582`,
      });
      if (result.submission && onSubmissionUpdate) onSubmissionUpdate(result.submission);
      toast(buildSignatureSendFeedback(result, clientEmail));
    } catch (err) {
      setSigError(err.message || 'Could not send signature request. Please try again.');
    } finally {
      setSigSending(false);
    }
  };

  const handleRestartClick = () => {
    if (!combinedDownloaded) {
      setConfirmRestart(true);
    } else {
      onRestart();
    }
  };

  return (
    <div>
      <div className="bg-gradient-to-br from-hrs-blue to-hrs-blue2 text-white rounded-xl p-5 mb-6 flex items-start gap-4">
        <CheckCircle className="w-9 h-9 text-hrs-orange flex-shrink-0 mt-0.5" />
        <div>
          <h2 className="font-heading text-[1.2rem] text-hrs-orange mb-1">Advice Record Submitted</h2>
          <p className="text-[0.82rem] opacity-80 leading-relaxed">
            Record for <strong>{fullName}</strong> submitted. Complete the checklist and download or send for signature below.
          </p>
        </div>
      </div>

      <WorkflowStatusPanel
        roaPrepared
        emailStatus="sent"
        crmStatus={crm.status}
        crmSyncedAt={crm.status === 'synced' ? crm.result?.lastAttemptAt : null}
        checklistComplete={combinedDownloaded}
        docusignStatus={sigSent ? 'envelope_created' : 'not_sent'}
        docusignSentAt={sigSentAt}
        submission={submission}
      />

      {crm.status === 'syncing' && (
        <div className="mt-3 bg-hrs-blue/5 border border-hrs-border rounded-lg px-4 py-2.5 text-[0.8rem] text-hrs-blue2">
          Syncing client and ROA details to CRM…
        </div>
      )}
      {crm.status === 'synced' && (
        <div className="mt-3 bg-hrs-green/10 border border-hrs-green/30 rounded-lg px-4 py-2.5 text-[0.8rem] text-hrs-green font-medium">
          ✓ CRM synced successfully
        </div>
      )}
      {crm.status === 'failed' && (
        <div className="mt-3 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3">
          <p className="text-[0.82rem] font-semibold text-amber-800">The ROA was processed, but the CRM record could not be updated.</p>
          {crm.result?.error && <p className="text-[0.76rem] text-amber-700 mt-0.5">{crm.result.error}</p>}
          <button
            type="button"
            onClick={() => crm.retry(data)}
            className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-amber-400 text-amber-800 text-[0.76rem] font-semibold hover:bg-amber-100 transition-colors disabled:opacity-50"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Retry CRM Sync
          </button>
        </div>
      )}

      <FormCard>
        <div className="flex items-center justify-between mb-4 pb-3 border-b-2 border-hrs-orange">
          <img src="/assets/hrs-logo.png" alt="HRS" className="h-10" />
          <div className="text-right">
            <h2 className="font-heading text-[1.1rem] text-hrs-blue">HRS - NEW BUSINESS CHECKLIST</h2>
            <p className="text-[0.7rem] text-hrs-muted uppercase tracking-widest">FSP No. 28582</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          <InfoRow label="Insured" value={fullName} />
          <InfoRow label="Co Reg No" value="" />
          <InfoRow label="ID Number" value={data.idNumber} />
          <InfoRow label="Vat No" value="" />
          <InfoRow label="Contact Person" value={fullName} />
          <div />
          <div className="sm:col-span-2"><InfoRow label="Risk Address" value={address} /></div>
          <InfoRow label="Email Address" value={data.email} />
          <div />
          <InfoRow label="Phone (Work)" value={data.workNumber} />
          <InfoRow label="Phone (Cell)" value={data.cell} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 mt-2">
          <InfoRow label="Insurer" value={data.recInsurer} />
          <InfoRow label="Inception Date" value={data.inceptionDate} />
          <div className="flex border-b border-hrs-border py-1.5 gap-3 items-center">
            <span className="text-[0.75rem] font-semibold text-hrs-blue2 min-w-[140px] flex-shrink-0">Business Type</span>
            <select value={businessType} onChange={(e) => setBusinessType(e.target.value)}
              className="text-[0.82rem] text-hrs-blue bg-secondary border border-hrs-border rounded px-2 py-0.5 outline-none focus:border-hrs-orange">
              <option value="Personal">Personal</option>
              <option value="Business">Business</option>
            </select>
          </div>
          <div className="flex border-b border-hrs-border py-1.5 gap-3 items-center">
            <span className="text-[0.75rem] font-semibold text-hrs-blue2 min-w-[140px] flex-shrink-0">Accounts Executive</span>
            <input type="text" value={acctExec} onChange={(e) => setAcctExec(e.target.value)}
              className="text-[0.82rem] text-hrs-blue bg-secondary border border-hrs-border rounded px-2 py-0.5 outline-none focus:border-hrs-orange flex-1" />
          </div>
        </div>

        <div className="mt-2 border border-hrs-border rounded-b-md p-2 border-t-0">
          <YesNoRow label="Smartsure Facility" value={smartsure} onChange={setSmartsure} />
          <YesNoRow label="Direct Insurer" value={directInsurer} onChange={setDirectInsurer} />
        </div>

        {/* Premium Summary + Editable Commission */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 mt-2">
          <div>
            <SectionBar title="Premium Summary" />
            <div className="border border-hrs-border border-t-0 p-2 space-y-0.5">
              {[
                { label: "NET Premium", value: netPrem ? `R ${netPrem.toFixed(2)}` : "" },
                { label: "SASRIA", value: "" },
                { label: "VAPS", value: "" },
                { label: "HRS Fee", value: feeDisplayStr },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between py-1 border-b border-hrs-border">
                  <span className="text-[0.75rem] text-hrs-muted">{label}</span>
                  <span className="text-[0.78rem] font-medium text-hrs-blue">{value}</span>
                </div>
              ))}
              <div className="flex justify-between py-1.5 bg-hrs-blue/10 px-2 rounded mt-1">
                <span className="text-[0.78rem] font-bold text-hrs-blue">Total Premium</span>
                <span className="text-[0.82rem] font-bold text-hrs-orange">{totalPrem ? `R ${totalPrem.toFixed(2)}` : ""}</span>
              </div>
            </div>
          </div>
          <div>
            <SectionBar title="HRS - Commission Allocation" />
            <div className="border border-hrs-border border-t-0 p-2 space-y-0.5">
              {COMMISSION_ROWS.map((label) => (
                <div key={label} className="flex items-center justify-between py-1 border-b border-hrs-border">
                  <span className="text-[0.75rem] text-hrs-muted">{label}</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={commissions[label]}
                      onChange={(e) => setCommissions(prev => ({ ...prev, [label]: e.target.value }))}
                      className="text-[0.72rem] w-12 text-right border-b border-hrs-border bg-transparent outline-none focus:border-hrs-orange text-hrs-blue"
                      placeholder="0"
                    />
                    <span className="text-[0.72rem] text-hrs-muted">%</span>
                  </div>
                </div>
              ))}
              <div className="flex justify-between py-1.5 bg-hrs-blue/10 px-2 rounded mt-1">
                <span className="text-[0.78rem] font-bold text-hrs-blue">Monthly</span>
                <span className="text-[0.78rem] font-bold text-hrs-blue">{totalPrem ? `R ${totalPrem.toFixed(2)}` : ""}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Compliance + Additional Docs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 mt-2">
          <div>
            <SectionBar title="Compliance Documentation" />
            <div className="border border-hrs-border border-t-0 p-2">
              <p className="text-[0.68rem] text-hrs-muted mb-2 italic">Completed, Signed, Submitted and Available</p>
              {COMPLIANCE_DOCS.map((item) => (
                <CheckItem key={item} label={item} checked={!!complianceDocs[item]}
                  onChange={(v) => setComplianceDocs(prev => ({ ...prev, [item]: v }))} />
              ))}
            </div>
          </div>
          <div>
            <SectionBar title="Additional Confirmation" />
            <div className="border border-hrs-border border-t-0 p-2">
              <p className="text-[0.68rem] text-hrs-muted mb-2 italic">Verification of Specific Details</p>
              {ADDITIONAL_DOCS.map((item) => (
                <CheckItem key={item} label={item} checked={!!additionalDocs[item]}
                  onChange={(v) => setAdditionalDocs(prev => ({ ...prev, [item]: v }))} />
              ))}
            </div>
          </div>
        </div>

        <SectionBar title="Comments" />
        <div className="border border-hrs-border border-t-0 p-3">
          <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3}
            placeholder="Add comments here..."
            className="w-full text-[0.82rem] text-hrs-blue bg-transparent border-none outline-none resize-none placeholder:text-hrs-muted" />
        </div>

        <SectionBar title="Tracking and Admin" right="Dates" />
        <div className="border border-hrs-border border-t-0 p-2">
          {[
            { label: "Full documentation handed in to upload", key: "docs" },
            { label: "Documentation submitted to insurer / UMA", key: "submitted" },
            { label: "Email to commissions@hrsinsurance.co.za", key: "email" },
          ].map(({ label, key }) => (
            <div key={key} className="flex items-center gap-3 py-1.5 border-b border-hrs-border">
              <span className="text-[0.78rem] text-hrs-blue flex-1">{label}</span>
              <input type="date" value={trackDates[key] || ''}
                onChange={(e) => setTrackDates(prev => ({ ...prev, [key]: e.target.value }))}
                className="text-[0.75rem] text-hrs-blue border border-hrs-border rounded px-2 py-0.5 bg-secondary outline-none focus:border-hrs-orange" />
            </div>
          ))}
        </div>

      </FormCard>

      {/* Actions */}
      <FormCard className="bg-gradient-to-br from-hrs-blue to-hrs-blue2 text-white">
        <div className="font-heading text-[1.05rem] text-hrs-orange mb-3">Documents</div>

        {/* Download buttons — canonical ROA is the stored authoritative PDF. */}
        <div className="flex gap-3 flex-wrap mb-3">
          <button onClick={handleDownloadROA} disabled={!!downloading || !submission?.submissionId}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-lg font-body font-semibold text-[0.88rem] bg-hrs-orange text-white border-none transition-all hover:bg-hrs-orange-light disabled:opacity-60">
            <FileDown className="w-4 h-4" />
            {downloading === 'roa' ? 'Downloading...' : 'Download ROA PDF (canonical)'}
          </button>
          <button onClick={handleDownloadCombined} disabled={!!downloading}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-lg font-body font-semibold text-[0.88rem] bg-transparent text-white border-[1.5px] border-white/50 transition-all hover:border-white disabled:opacity-60"
            title="Working copy including the internal checklist. The canonical ROA above is the authoritative signed document.">
            <FilePlus className="w-4 h-4" />
            {downloading === 'combined' ? 'Generating...' : 'ROA + Checklist (working copy)'}
          </button>
        </div>
        {submission?.hasSignedPdf && (
          <div className="flex gap-3 flex-wrap mb-3">
            <button onClick={handleDownloadSigned} disabled={!!downloading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-body font-semibold text-[0.82rem] bg-white/10 text-white border border-white/30 transition-all hover:bg-white/20 disabled:opacity-60">
              <FileDown className="w-4 h-4" />
              {downloading === 'signed' ? 'Downloading...' : 'Download signed ROA'}
            </button>
            {submission?.hasCertificate && (
              <button onClick={handleDownloadCertificate} disabled={!!downloading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-body font-semibold text-[0.82rem] bg-white/10 text-white border border-white/30 transition-all hover:bg-white/20 disabled:opacity-60">
                <FileDown className="w-4 h-4" />
                {downloading === 'certificate' ? 'Downloading...' : 'Download Certificate of Completion'}
              </button>
            )}
            {submission?.hasAuditLog && (
              <button onClick={handleDownloadAuditLog} disabled={!!downloading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-body font-semibold text-[0.82rem] bg-white/10 text-white border border-white/30 transition-all hover:bg-white/20 disabled:opacity-60">
                <FileDown className="w-4 h-4" />
                {downloading === 'audit-log' ? 'Downloading...' : 'Download Audit Log'}
              </button>
            )}
          </div>
        )}
        {submission?.submissionId && (
          <p className="text-[0.7rem] text-white/60 -mt-1 mb-2 uppercase tracking-wider">
            Submission {submission.submissionId} · SHA-256 {String(submission.pdfSha256 || '').slice(0, 12)}…
          </p>
        )}

        {/* Provider-neutral e-signature */}
        <div className="mt-1 pt-3 border-t border-white/20">
          <p className="text-[0.72rem] text-white/60 mb-2 font-semibold uppercase tracking-wider">
            E-signature
          </p>
          {sigSent ? (
            <div className="bg-hrs-green/20 border border-hrs-green/40 rounded-lg px-4 py-3">
              <p className="text-[0.82rem] font-semibold text-white">
                ✓ Signature request sent to {data.email}
              </p>
              <p className="text-[0.75rem] text-white/60 mt-0.5">
                This ROA will update automatically as signing progresses. Signing provider: {submission?.signingProvider || 'configured provider'}. Reference: {sigEnvelopeId}
              </p>
            </div>
          ) : (
            <button
              onClick={handleSendForSignature}
              disabled={sigSending || !!downloading}
              className="w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg font-body font-semibold text-[0.85rem] bg-white/10 text-white border border-white/30 transition-all hover:bg-white/20 hover:border-white/60 disabled:opacity-60"
            >
              <Send className="w-4 h-4" />
              {sigSending ? 'Sending signature request...' : `Send to ${data.email || 'client'} for e-signature`}
            </button>
          )}
          {sigError && (
            <p className="text-red-300 text-[0.75rem] mt-2">{sigError}</p>
          )}
        </div>

        {/* Restart */}
        <div className="mt-3 pt-3 border-t border-white/20">
          {confirmRestart ? (
            <div className="rounded-lg border border-hrs-orange/60 bg-white/10 px-4 py-3 text-[0.82rem]">
              <p className="text-white font-semibold mb-2">Have you downloaded the ROA + Checklist PDF?</p>
              <p className="text-white/70 mb-3 text-[0.78rem]">The checklist data will be lost once you start a new record.</p>
              <div className="flex gap-3">
                <button onClick={onRestart}
                  className="flex-1 px-4 py-2 rounded-lg font-body font-semibold text-[0.82rem] bg-hrs-orange text-white transition-all hover:bg-hrs-orange-light">
                  Yes, start new record
                </button>
                <button onClick={() => setConfirmRestart(false)}
                  className="flex-1 px-4 py-2 rounded-lg font-body font-semibold text-[0.82rem] bg-transparent text-white border border-white/40 transition-all hover:border-white">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={handleRestartClick}
              className="w-full px-5 py-2.5 rounded-lg font-body font-semibold text-[0.85rem] bg-transparent text-white/70 border-[1px] border-white/20 transition-all hover:border-white/40 hover:text-white">
              + New Advice Record
            </button>
          )}
        </div>
      </FormCard>
    </div>
  );
}
