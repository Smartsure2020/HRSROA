import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, RefreshCw, Send } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import AppHeader from '../components/hrs/AppHeader';
import SignatureReminderButton from '../components/hrs/SignatureReminderButton';
import {
  downloadEvidencePdf,
  isPendingSubmission,
  loadSubmissionRegister,
  refreshSubmissionRegister,
  sendForSignature,
  syncCrmSubmission,
} from '../lib/roaSubmissionClient';

const FILTERS = [
  ['all', 'All'],
  ['awaiting', 'Awaiting signature'],
  ['completed', 'Completed'],
  ['failed', 'Failed'],
  ['personal', 'Personal'],
  ['commercial', 'Commercial'],
];

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' });
}

function matchesFilter(item, filter) {
  if (filter === 'all') return true;
  if (filter === 'personal' || filter === 'commercial') return item.roaType?.toLowerCase() === filter;
  if (filter === 'awaiting') return item.status === 'awaiting_signature' || ['sent', 'delivered'].includes(item.signingStatus);
  if (filter === 'completed') return item.status === 'completed' || item.signingStatus === 'completed';
  if (filter === 'failed') return item.status === 'signature_failed' || String(item.signingStatus || '').startsWith('failed');
  return true;
}

export function crmStatusLabel(item) {
  if (item?.crmSyncStatus === 'linked') return 'Linked';
  if (item?.crmSyncStatus === 'failed') return 'Sync failed';
  if (item?.crmSyncStatus === 'partial' || item?.crmClientId || item?.crmDealId) return 'Partial';
  return 'Not linked';
}

/** Which signing evidence is filed in the CRM. Documenso also files its audit log. */
export function crmEvidenceLabel(item) {
  const needsAuditLog = item?.signingProvider === 'documenso';
  const filed = [
    item?.crmSignedRoaDocumentId && 'Signed ROA',
    item?.crmCertificateDocumentId && 'certificate',
    needsAuditLog && item?.crmAuditLogDocumentId && 'audit log',
  ].filter(Boolean);
  const expected = needsAuditLog ? 3 : 2;
  if (filed.length === 0) return 'Not filed';
  if (filed.length < expected) return `Partly filed (${filed.join(', ')})`;
  return needsAuditLog ? 'Signed ROA + certificate + audit log filed' : 'Signed ROA + certificate filed';
}

/** CRM sync is final when linked and, for Documenso, the audit log is filed too. */
export function isCrmSyncFinal(item) {
  if (item?.crmSyncStatus !== 'linked') return false;
  return item.signingProvider !== 'documenso' || Boolean(item.crmAuditLogDocumentId);
}

function EvidenceButton({ item, kind, label, available = true }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={!available || busy}
      onClick={async () => {
        setBusy(true);
        try { await downloadEvidencePdf(item.submissionId, kind); }
        finally { setBusy(false); }
      }}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-hrs-border text-[0.75rem] font-semibold text-hrs-blue hover:border-hrs-orange disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <Download className="w-3.5 h-3.5" /> {busy ? 'Downloading…' : label}
    </button>
  );
}

export default function RoaRegister() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [crmRetrying, setCrmRetrying] = useState(false);
  const [signatureSending, setSignatureSending] = useState(false);
  const refreshInFlight = useRef(false);

  const applyItems = useCallback((nextItems) => {
    setItems(nextItems);
    setSelected((current) => (
      current
        ? nextItems.find((item) => item.submissionId === current.submissionId) || null
        : null
    ));
  }, []);

  const load = useCallback(async ({ initial = false } = {}) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setLoading(true);
    setError('');
    try {
      const nextItems = initial
        ? await loadSubmissionRegister()
        : await refreshSubmissionRegister();
      applyItems(nextItems);
    }
    catch (err) { setError(err.message || 'Could not load the ROA register.'); }
    finally {
      refreshInFlight.current = false;
      setLoading(false);
    }
  }, [applyItems]);

  useEffect(() => { load({ initial: true }); }, [load]);
  const hasPending = useMemo(() => items.some(isPendingSubmission), [items]);
  useEffect(() => {
    if (!hasPending) return undefined;
    const interval = setInterval(() => { load(); }, 30000);
    return () => clearInterval(interval);
  }, [hasPending, load]);
  const visible = useMemo(() => items.filter((item) => matchesFilter(item, filter)), [items, filter]);

  const retryCrm = useCallback(async () => {
    if (!selected?.submissionId || crmRetrying) return;
    setCrmRetrying(true);
    setError('');
    try {
      const updated = await syncCrmSubmission(selected.submissionId);
      applyItems(items.map((item) => item.submissionId === updated.submissionId ? updated : item));
    } catch (err) {
      setError(err.message || 'CRM sync failed. The ROA evidence is still safely retained.');
      await load();
    } finally { setCrmRetrying(false); }
  }, [selected?.submissionId, crmRetrying, applyItems, items, load]);

  const sendSelectedForSignature = useCallback(async () => {
    if (!selected?.submissionId || signatureSending || selected.signingEnvelopeId || selected.docusignEnvelopeId) return;
    setSignatureSending(true);
    setError('');
    try {
      const result = await sendForSignature({ submissionId: selected.submissionId });
      const updated = result?.submission;
      if (updated) {
        applyItems(items.map((item) => item.submissionId === updated.submissionId ? updated : item));
      } else {
        await load();
      }
    } catch (err) {
      setError(err.message || 'Could not send this ROA for signature. Please try again.');
      await load();
    } finally { setSignatureSending(false); }
  }, [selected, signatureSending, applyItems, items, load]);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="My ROAs / ROA Register" />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <button onClick={() => navigate('/')} className="inline-flex items-center gap-1 text-[0.78rem] text-hrs-muted hover:text-hrs-blue mb-2">
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Home
            </button>
            <h1 className="font-heading text-2xl text-hrs-blue">My ROAs</h1>
            <p className="text-[0.82rem] text-hrs-muted mt-1">Your durable submission and signature evidence register.</p>
          </div>
          <button onClick={() => load()} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-hrs-border text-[0.78rem] font-semibold text-hrs-blue disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mb-5">
          {FILTERS.map(([value, label]) => (
            <button key={value} onClick={() => setFilter(value)} className={`px-3 py-1.5 rounded-full border text-[0.74rem] font-semibold ${filter === value ? 'bg-hrs-blue text-white border-hrs-blue' : 'bg-card text-hrs-muted border-hrs-border'}`}>
              {label}
            </button>
          ))}
        </div>

        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-[0.8rem] text-red-700">{error}</div>}

        <div className="rounded-xl border border-hrs-border bg-card overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead className="bg-hrs-blue text-white text-[0.72rem] uppercase tracking-wider">
              <tr><th className="p-3">Client</th><th className="p-3">Type</th><th className="p-3">Submission date</th><th className="p-3">Signature status</th><th className="p-3">CRM status</th></tr>
            </thead>
            <tbody>
              {!loading && visible.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-hrs-muted text-sm">No ROAs match this filter.</td></tr>}
              {visible.map((item) => (
                <tr key={item.submissionId} onClick={() => setSelected(item)} className="border-t border-hrs-border hover:bg-hrs-blue/5 cursor-pointer text-[0.8rem]">
                  <td className="p-3 font-semibold text-hrs-blue">{item.clientReference || item.submissionId}</td>
                  <td className="p-3 text-hrs-muted">{item.roaType}</td>
                  <td className="p-3 text-hrs-muted">{formatDate(item.submittedAt)}</td>
                  <td className="p-3 text-hrs-blue2">{item.signingStatus || item.status || 'Not sent'}</td>
                  <td className="p-3 text-hrs-muted">{crmStatusLabel(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selected && (
          <section className="mt-6 rounded-xl border border-hrs-border bg-card p-5">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div><h2 className="font-heading text-lg text-hrs-blue">{selected.clientReference || 'ROA detail'}</h2><p className="text-[0.72rem] text-hrs-muted mt-1 break-all">{selected.submissionId}</p></div>
              <button onClick={() => setSelected(null)} className="text-hrs-muted text-sm">Close</button>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-[0.78rem] mb-5">
              <div><span className="text-hrs-muted">Adviser</span><p className="text-hrs-blue">{selected.adviser || '—'}</p></div>
              <div><span className="text-hrs-muted">Signing provider</span><p className="text-hrs-blue">{selected.signingProvider || 'Not sent'}</p></div>
              <div><span className="text-hrs-muted">Signature status</span><p className="text-hrs-blue">{selected.signingStatus || selected.status || '—'}</p></div>
              <div><span className="text-hrs-muted">Submitted</span><p className="text-hrs-blue">{formatDate(selected.submittedAt)}</p></div>
              <div><span className="text-hrs-muted">Sent for signature</span><p className="text-hrs-blue">{formatDate(selected.sentForSignatureAt)}</p></div>
              <div><span className="text-hrs-muted">Completed</span><p className="text-hrs-blue">{formatDate(selected.completedAt)}</p></div>
              <div><span className="text-hrs-muted">Evidence retrieved</span><p className="text-hrs-blue">{formatDate(selected.evidenceRetrievedAt)}</p></div>
              <div><span className="text-hrs-muted">CRM client</span><p className="text-hrs-blue">{selected.crmClientId || '—'}</p></div>
              <div><span className="text-hrs-muted">CRM deal</span><p className="text-hrs-blue">{selected.crmDealId || '—'}</p></div>
              <div><span className="text-hrs-muted">CRM status</span><p className="text-hrs-blue">{crmStatusLabel(selected)}</p></div>
              <div><span className="text-hrs-muted">CRM last attempt</span><p className="text-hrs-blue">{formatDate(selected.crmSyncAttemptedAt)}</p></div>
              <div><span className="text-hrs-muted">CRM evidence</span><p className="text-hrs-blue">{crmEvidenceLabel(selected)}</p></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <EvidenceButton item={selected} kind="canonical" label="Original / Canonical ROA" available={selected.hasCanonicalPdf} />
              <EvidenceButton item={selected} kind="signed" label="Signed ROA" available={selected.hasSignedPdf} />
              <EvidenceButton item={selected} kind="certificate" label="Certificate of Completion" available={selected.hasCertificate} />
              <EvidenceButton item={selected} kind="audit-log" label="Audit Log" available={selected.hasAuditLog} />
              <EvidenceButton
                item={selected}
                kind="broker-appointment"
                label="Broker Appointment"
                available={selected.hasBrokerAppointmentDownload}
              />
              <EvidenceButton
                item={selected}
                kind="letter-investigation"
                label="Letter of Investigation"
                available={selected.hasLetterInvestigationDownload}
              />
              {!selected.signingEnvelopeId && !selected.docusignEnvelopeId && ['submitted', 'signature_failed'].includes(selected.status) && (
                <button
                  type="button"
                  onClick={sendSelectedForSignature}
                  disabled={signatureSending}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-hrs-orange text-[0.75rem] font-semibold text-hrs-blue disabled:opacity-40"
                >
                  <Send className="w-3.5 h-3.5" />
                  {signatureSending ? 'Sending…' : 'Send for signature'}
                </button>
              )}
              <SignatureReminderButton
                variant="light"
                submission={selected}
                onSubmissionUpdate={(updated) => applyItems(items.map((item) => item.submissionId === updated.submissionId ? updated : item))}
              />
              {!isCrmSyncFinal(selected) && (
                <button type="button" onClick={retryCrm} disabled={crmRetrying}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-hrs-orange text-[0.75rem] font-semibold text-hrs-blue disabled:opacity-40">
                  <RefreshCw className={`w-3.5 h-3.5 ${crmRetrying ? 'animate-spin' : ''}`} />
                  {crmRetrying ? 'Syncing CRM…' : 'Retry CRM sync'}
                </button>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
