import { useState, useRef, useEffect } from "react";
import { CheckCircle, FileDown, FilePlus, Send, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import FormCard from "../../FormCard";
import WorkflowStatusPanel from "../../WorkflowStatusPanel";
import { generateCommercialCombinedPDF } from "../../../../lib/hrsCommercialPdfGenerator";
import { MANAGER_NAME } from "../../../../lib/hrsConstants";
import { syncCommercialROAToCRM } from "../../../../lib/crmAdapter";
import { useCrmSyncStatus } from "../../../../lib/useCrmSyncStatus";
import { toast } from "@/components/ui/use-toast";
import { buildSignatureSendFeedback } from "../../../../lib/signatureSendFeedback";
import {
  attachCrmIds,
  downloadEvidencePdf,
  refreshSubmission,
  sendForSignature as sendForSignatureApi,
} from "../../../../lib/roaSubmissionClient";

function InfoRow({ label, value }) {
  return (
    <div className="flex border-b border-hrs-border py-1.5 gap-3">
      <span className="text-[0.75rem] font-semibold text-hrs-blue2 min-w-[150px] flex-shrink-0">{label}</span>
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
        {['yes', 'no'].map(v => (
          <button key={v} type="button" onClick={() => onChange(value === v ? null : v)}
            className={`px-3 py-0.5 rounded border text-[0.72rem] font-semibold transition-all ${value === v ? v === 'yes' ? 'bg-hrs-green text-white border-hrs-green' : 'bg-hrs-red text-white border-hrs-red' : 'border-hrs-border text-hrs-muted hover:border-hrs-green'}`}>
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
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
  "CELLPHONES | MAKE | MODEL | IMEI NO'S",
  "ELECTRONICS | MAKE | MODEL | SERIAL NO'S",
  "VEHICLE REGISTRATION CERTIFICATES",
  "VEHICLE REGISTRATION - ENGINE AND VIN NO'S",
  "PROOF OF TRACKING DEVICE INSTALLATIONS",
  "PROOF OF PURCHASES ON HIGH VALUE ITEMS",
  "VALUATION CERTIFICATES ON HIGH VALUE ITEMS",
  "COMPANY REGISTRATION DOCUMENTS",
  "PROOF OF BUSINESS ASSETS",
];

const COMMISSION_ROWS = ["Brokerage (HRS)", "Broker", "Referror", "Other"];

export default function CommercialStepChecklist({ data, submission, onSubmissionUpdate, onRestart }) {
  const navigate = useNavigate();
  const [smartsure, setSmartsure] = useState(null);
  const [directInsurer, setDirectInsurer] = useState(null);
  const [complianceDocs, setComplianceDocs] = useState({});
  const [additionalDocs, setAdditionalDocs] = useState({});
  const [comments, setComments] = useState('');
  const [trackDates, setTrackDates] = useState({ docs: '', submitted: '', email: '' });
  const [businessType, setBusinessType] = useState('Commercial');
  const [acctExec, setAcctExec] = useState(data.brokerName || MANAGER_NAME);
  const [downloading, setDownloading] = useState(null);
  const [downloaded, setDownloaded] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [commissions, setCommissions] = useState({
    "Brokerage (HRS)": "",
    "Broker": "",
    "Referror": "",
    "Other": "",
  });

  // Provider-neutral e-signature state — derived from `submission` so it survives refreshes.
  const [sigSending, setSigSending] = useState(false);
  const [sigError, setSigError] = useState(null);
  const sigSent = Boolean(submission?.signingEnvelopeId || submission?.docusignEnvelopeId);
  const sigEnvelopeId = submission?.signingEnvelopeId || submission?.docusignEnvelopeId || null;
  const sigSentAt = submission?.sentForSignatureAt || null;

  // CRM sync + retry — same pattern and shared hook as the Personal checklist.
  const crm = useCrmSyncStatus(syncCommercialROAToCRM);
  const crmTriggered = useRef(false);
  const crmAttachedIdsRef = useRef(false);
  useEffect(() => {
    if (crmTriggered.current) return;
    crmTriggered.current = true;
    crm.sync(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      .catch(() => { /* silent */ });
  }, [crm.status, crm.result, submission?.submissionId, onSubmissionUpdate]);

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
      } catch { /* transient */ }
    }
    tick();
    const interval = setInterval(tick, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [submission?.submissionId, submission?.status, submission?.signingProvider, submission?.hasSignedPdf, submission?.hasCertificate, submission?.hasAuditLog, onSubmissionUpdate]);

  const netPrem = parseFloat(data.prem2) || 0;
  const feeVal = parseFloat(data.brokerFeePercent) || 0;
  const feeAmount = data.brokerFeeType === 'fixed' ? feeVal : (netPrem * feeVal / 100);
  const totalPrem = netPrem + feeAmount;

  const signerName = data.contactPerson || data.companyName || 'Client';
  const signerEmail = data.email;

  const handleDownload = async () => {
    if (!submission?.submissionId) return;
    setDownloading('roa');
    try {
      await downloadEvidencePdf(submission.submissionId, 'canonical', `HRS_Commercial_ROA_${submission.submissionId}.pdf`);
      setDownloaded(true);
    } finally { setDownloading(null); }
  };

  const handleDownloadCombined = async () => {
    setDownloading('combined');
    try {
      await generateCommercialCombinedPDF(data, {
        smartsure, directInsurer, complianceDocs, additionalDocs,
        comments, trackDates, businessType, acctExec, commissions,
      });
      setDownloaded(true);
    } finally { setDownloading(null); }
  };

  const handleDownloadSigned = async () => {
    if (!submission?.submissionId || !submission.hasSignedPdf) return;
    setDownloading('signed');
    try {
      await downloadEvidencePdf(submission.submissionId, 'signed', `HRS_Commercial_ROA_${submission.submissionId}_signed.pdf`);
    } finally { setDownloading(null); }
  };

  const handleDownloadCertificate = async () => {
    if (!submission?.submissionId || !submission.hasCertificate) return;
    setDownloading('certificate');
    try {
      await downloadEvidencePdf(submission.submissionId, 'certificate', `HRS_Commercial_ROA_${submission.submissionId}_certificate.pdf`);
    } finally { setDownloading(null); }
  };

  const handleDownloadAuditLog = async () => {
    if (!submission?.submissionId || !submission.hasAuditLog) return;
    setDownloading('audit-log');
    try {
      await downloadEvidencePdf(submission.submissionId, 'audit-log', `HRS_Commercial_ROA_${submission.submissionId}_audit-log.pdf`);
    } finally { setDownloading(null); }
  };

  const handleSendForSignature = async () => {
    if (!submission?.submissionId) return;
    if (!signerEmail) {
      setSigError('No client email address found. Please ensure the email was entered in Step 1.');
      return;
    }

    setSigSending(true);
    setSigError(null);
    try {
      const result = await sendForSignatureApi({
        submissionId: submission.submissionId,
        signerName,
        signerEmail,
        subject: `Please sign your Record of Advice – ${data.companyName} | HRS Insurance`,
        message: `Dear ${signerName},\n\nPlease review and sign the Commercial Lines Record of Advice for ${data.companyName} from Holistic Risk Services (Pty) Ltd. This document is required under the Financial Advisory and Intermediary Services (FAIS) Act.\n\nKind regards,\n${data.brokerName}\nHolistic Risk Services (Pty) Ltd\nFSP No. 28582`,
      });
      if (result.submission && onSubmissionUpdate) onSubmissionUpdate(result.submission);
      toast(buildSignatureSendFeedback(result, signerEmail));
    } catch (err) {
      setSigError(err.message || 'Could not send signature request. Please try again.');
    } finally {
      setSigSending(false);
    }
  };

  return (
    <div>
      <div className="bg-gradient-to-br from-hrs-blue to-hrs-blue2 text-white rounded-xl p-5 mb-6 flex items-start gap-4">
        <CheckCircle className="w-9 h-9 text-hrs-orange flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h2 className="font-heading text-[1.2rem] text-hrs-orange mb-1">Commercial Advice Record Submitted</h2>
          <p className="text-[0.82rem] opacity-80 leading-relaxed">
            Record for <strong>{data.companyName || 'Client'}</strong> submitted. Complete the checklist and download or send for signature below.
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            <button type="button" onClick={() => navigate('/')} className="px-3 py-2 rounded-md border border-white/30 bg-white/10 text-[0.76rem] font-semibold hover:bg-white/20">
              Back to Home
            </button>
            <button type="button" onClick={() => navigate('/roas')} className="px-3 py-2 rounded-md bg-hrs-orange text-white text-[0.76rem] font-semibold hover:bg-hrs-orange-light">
              View My ROAs
            </button>
          </div>
        </div>
      </div>

      <WorkflowStatusPanel
        roaPrepared
        emailStatus="sent"
        crmStatus={crm.status}
        crmSyncedAt={crm.status === 'synced' ? crm.result?.lastAttemptAt : null}
        checklistComplete={downloaded}
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
            <p className="text-[0.7rem] text-hrs-muted uppercase tracking-widest">Commercial Lines  |  FSP No. 28582</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          <InfoRow label="Insured" value={data.companyName} />
          <InfoRow label="Reg No." value={data.registrationNo} />
          <InfoRow label="Contact Person" value={data.contactPerson} />
          <InfoRow label="VAT No." value={data.vatNo} />
          <InfoRow label="Nature of Business" value={data.natureOfBusiness} />
          <InfoRow label="Inception Date" value={data.inceptionDate} />
          <div className="sm:col-span-2"><InfoRow label="Risk Address" value={data.riskAddress} /></div>
          <InfoRow label="Email" value={data.email} />
          <InfoRow label="Contact No." value={data.contactNo} />
          <InfoRow label="Insurer" value={data.recInsurer} />
          <div className="flex border-b border-hrs-border py-1.5 gap-3 items-center">
            <span className="text-[0.75rem] font-semibold text-hrs-blue2 min-w-[150px] flex-shrink-0">Business Type</span>
            <select value={businessType} onChange={(e) => setBusinessType(e.target.value)}
              className="text-[0.82rem] text-hrs-blue bg-secondary border border-hrs-border rounded px-2 py-0.5 outline-none focus:border-hrs-orange">
              <option value="Commercial">Commercial</option>
              <option value="Personal">Personal</option>
            </select>
          </div>
          <div className="flex border-b border-hrs-border py-1.5 gap-3 items-center">
            <span className="text-[0.75rem] font-semibold text-hrs-blue2 min-w-[150px] flex-shrink-0">Accounts Executive</span>
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
            <div className="border border-hrs-border border-t-0 p-2">
              {[
                { label: "NET Premium", value: netPrem ? `R ${netPrem.toFixed(2)}` : "" },
                { label: "SASRIA", value: "" },
                { label: "HRS Fee", value: feeAmount ? `R ${feeAmount.toFixed(2)}` : "" },
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 mt-2">
          <div>
            <SectionBar title="Compliance Documentation" />
            <div className="border border-hrs-border border-t-0 p-2">
              <p className="text-[0.68rem] text-hrs-muted mb-2 italic">Completed, Signed, Submitted and Available</p>
              {COMPLIANCE_DOCS.map(item => (
                <CheckItem key={item} label={item} checked={!!complianceDocs[item]}
                  onChange={v => setComplianceDocs(prev => ({ ...prev, [item]: v }))} />
              ))}
            </div>
          </div>
          <div>
            <SectionBar title="Additional Confirmation" />
            <div className="border border-hrs-border border-t-0 p-2">
              <p className="text-[0.68rem] text-hrs-muted mb-2 italic">Verification of Specific Details</p>
              {ADDITIONAL_DOCS.map(item => (
                <CheckItem key={item} label={item} checked={!!additionalDocs[item]}
                  onChange={v => setAdditionalDocs(prev => ({ ...prev, [item]: v }))} />
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

        <div className="flex gap-3 flex-wrap mb-3">
          <button onClick={handleDownload} disabled={!!downloading || !submission?.submissionId}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-lg font-body font-semibold text-[0.88rem] bg-hrs-orange text-white border-none transition-all hover:bg-hrs-orange-light disabled:opacity-60">
            <FileDown className="w-4 h-4" />
            {downloading === 'roa' ? 'Downloading...' : 'Download Commercial ROA PDF (canonical)'}
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
                ✓ Signature request sent to {signerEmail}
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
              {sigSending ? 'Sending signature request...' : `Send to ${signerEmail || 'client'} for e-signature`}
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
              <p className="text-white font-semibold mb-2">Have you downloaded the ROA PDF?</p>
              <p className="text-white/70 mb-3 text-[0.78rem]">All data will be lost once you start a new record.</p>
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
            <button onClick={() => !downloaded ? setConfirmRestart(true) : onRestart()}
              className="w-full px-5 py-2.5 rounded-lg font-body font-semibold text-[0.85rem] bg-transparent text-white/70 border-[1px] border-white/20 transition-all hover:border-white/40 hover:text-white">
              + New Advice Record
            </button>
          )}
        </div>
      </FormCard>
    </div>
  );
}
