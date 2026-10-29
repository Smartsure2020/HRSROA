import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import AppHeader from '../components/hrs/AppHeader';
import AdviceRecord from './AdviceRecord';
import CommercialAdviceRecord from './CommercialAdviceRecord';
import { useAuth } from '@/lib/AuthContext';
import { EMAIL_TO_BROKER } from '../lib/hrsConstants';
import { getAmendmentSource } from '../lib/roaSubmissionClient';
import { isSubmissionId } from '../lib/roaSubmissionSnapshot';
import { prefillFormDataFromSnapshot } from '../lib/roaAmendmentPrefill';
import {
  AMEND_DETAIL_MAX,
  AMEND_REASONS,
  AMENDMENT_BLOCK_MESSAGES,
  validateAmendmentReason,
} from '../lib/roaAmendment';

// What the status means for this amendment, in plain language. No status blocks the broker
// from editing; the status only decides what "send for signature" will later have to do.
const STATUS_NOTES = Object.freeze({
  submitted: 'This ROA has not been sent for signature yet.',
  awaiting_signature:
    'This ROA is awaiting signature. Opening the editor changes nothing: the current signature request '
    + 'stays live while you edit, and is cancelled automatically only when you send the amended revision for signature.',
  signature_failed: 'Sending this ROA for signature previously failed, so no signature request exists.',
  completed:
    'This ROA is signed. The signed document, certificate and audit log stay unchanged and downloadable; '
    + 'the amended revision is a new document that must be signed separately.',
  declined: 'The client declined the previous signature request.',
  voided: 'The previous signature request was voided.',
  expired: 'The previous signature request expired.',
});

function Shell({ title, children }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background">
      <AppHeader title={title} />
      <main className="max-w-[760px] mx-auto px-4 py-8">
        <button
          type="button"
          onClick={() => navigate('/roas')}
          className="inline-flex items-center gap-1 text-[0.78rem] text-hrs-muted hover:text-hrs-blue mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to My ROAs
        </button>
        {children}
      </main>
    </div>
  );
}

function ReasonStep({ source, onContinue }) {
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [error, setError] = useState('');

  const submit = () => {
    const checked = validateAmendmentReason({ reason, reasonDetail: detail });
    if (!checked.ok) {
      setError(AMENDMENT_BLOCK_MESSAGES[checked.error] || 'Please check the reason.');
      return;
    }
    setError('');
    onContinue({ reason: checked.reason, reasonDetail: checked.reasonDetail });
  };

  return (
    <Shell title="Amend ROA">
      <h1 className="font-heading text-2xl text-hrs-blue mb-1">Amend ROA</h1>
      <p className="text-[0.82rem] text-hrs-muted mb-4">
        {source.clientReference || source.submissionId} · Revision {source.revisionNo} → Revision {source.nextRevisionNo}
      </p>

      <div className={`rounded-lg border p-3 mb-5 text-[0.8rem] ${source.willCancelSigningRequest ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-hrs-border bg-card text-hrs-blue2'}`}>
        {source.willCancelSigningRequest && <AlertTriangle className="w-4 h-4 inline mr-1.5 -mt-0.5" />}
        {STATUS_NOTES[source.status] || ''}
      </div>

      <p className="text-[0.8rem] text-hrs-blue2 mb-3">
        An amendment creates a new revision with its own document, hash and signing request. The original is never
        edited, and its signed evidence is kept.
      </p>

      <fieldset className="mb-4">
        <legend className="text-[0.78rem] font-semibold text-hrs-blue mb-2">Reason for the amendment (required)</legend>
        <div className="space-y-2">
          {AMEND_REASONS.map((option) => (
            <label
              key={option.code}
              className={`flex items-center gap-3 p-3 border-[1.5px] rounded-lg cursor-pointer text-[0.83rem] ${reason === option.code ? 'border-hrs-blue bg-hrs-blue/5' : 'border-hrs-border'}`}
            >
              <input
                type="radio"
                name="amend-reason"
                value={option.code}
                checked={reason === option.code}
                onChange={() => setReason(option.code)}
              />
              <span className="text-hrs-blue">{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block text-[0.78rem] font-semibold text-hrs-blue mb-1" htmlFor="amend-detail">
        {reason === 'other' ? 'Describe the reason (required)' : 'Note (optional)'}
      </label>
      <textarea
        id="amend-detail"
        value={detail}
        maxLength={AMEND_DETAIL_MAX}
        rows={3}
        onChange={(e) => setDetail(e.target.value)}
        className="w-full rounded-md border border-hrs-border bg-card p-2 text-[0.82rem] text-hrs-blue mb-3"
      />

      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-[0.8rem] text-red-700">{error}</div>}

      <button
        type="button"
        onClick={submit}
        className="px-5 py-2.5 rounded-lg bg-hrs-blue text-white font-semibold text-[0.85rem] hover:bg-hrs-blue2"
      >
        Continue to edit
      </button>
    </Shell>
  );
}

export default function AmendRoa() {
  const { submissionId } = useParams();
  const { user } = useAuth();
  const [source, setSource] = useState(null);
  const [failure, setFailure] = useState('');
  const [chosen, setChosen] = useState(null);

  const idOk = isSubmissionId(submissionId);

  useEffect(() => {
    if (!idOk) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const loaded = await getAmendmentSource(submissionId);
        if (!cancelled) setSource(loaded);
      } catch (err) {
        if (cancelled) return;
        setFailure(
          err.code === 'not_found'
            ? 'This ROA could not be found.'
            : AMENDMENT_BLOCK_MESSAGES[err.code] || err.message || 'This ROA cannot be amended right now.',
        );
      }
    })();
    return () => { cancelled = true; };
  }, [idOk, submissionId]);

  const prefilled = useMemo(() => {
    if (!source || !chosen) return null;
    return prefillFormDataFromSnapshot(source.roaType, source.snapshot, {
      brokerName: user?.email ? EMAIL_TO_BROKER[user.email] : undefined,
    });
  }, [source, chosen, user?.email]);

  if (!idOk) {
    return <Shell title="Amend ROA"><p className="text-[0.85rem] text-hrs-blue">That is not a valid ROA reference.</p></Shell>;
  }
  if (failure) {
    return (
      <Shell title="Amend ROA">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-[0.85rem] text-red-700">{failure}</div>
      </Shell>
    );
  }
  if (!source) {
    return (
      <Shell title="Amend ROA">
        <div className="w-6 h-6 border-4 border-hrs-border border-t-hrs-orange rounded-full animate-spin" />
      </Shell>
    );
  }
  if (!chosen) return <ReasonStep source={source} onContinue={setChosen} />;

  const amendment = {
    supersedesSubmissionId: source.submissionId,
    nextRevisionNo: source.nextRevisionNo,
    reason: chosen.reason,
    reasonDetail: chosen.reasonDetail,
    willCancelSigningRequest: source.willCancelSigningRequest,
    initialFormData: prefilled.formData,
    warnings: [...prefilled.warnings, ...prefilled.droppedKeys.map((key) => `${key}_not_carried_over`)],
  };

  return source.roaType === 'Commercial'
    ? <CommercialAdviceRecord amendment={amendment} />
    : <AdviceRecord amendment={amendment} />;
}
