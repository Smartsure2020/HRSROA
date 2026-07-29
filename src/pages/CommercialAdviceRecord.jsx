import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { BROKER_EMAIL_MAP, DEFAULT_BROKER_EMAIL, EMAIL_TO_BROKER } from '../lib/hrsConstants';
import { Check } from 'lucide-react';
import { Building2 } from 'lucide-react';
import AppHeader from '../components/hrs/AppHeader';
import { toast } from "@/components/ui/use-toast";
import {
  getCommercialStepErrors,
  getCommercialInitialFormData,
  applyConditionalCleanup,
} from '../lib/hrsCommercialConstants';
import { generateCommercialROABase64 } from '../lib/hrsCommercialPdfGenerator';
import { getDraftStatus, saveRoaDraft, clearRoaDraft, hasMeaningfulDraftData } from '@/lib/roaDraftStorage';
import { getBrokerFeeSummary } from '@/lib/brokerFee';
import CommercialStepClientDetails from '../components/hrs/commercial/steps/CommercialStepClientDetails';
import CommercialStepInsuranceHistory from '../components/hrs/commercial/steps/CommercialStepInsuranceHistory';
import CommercialStepProductsAdvice from '../components/hrs/commercial/steps/CommercialStepProductsAdvice';
import CommercialStepReplacementPolicy from '../components/hrs/commercial/steps/CommercialStepReplacementPolicy';
import CommercialStepPrinciples from '../components/hrs/commercial/steps/CommercialStepPrinciples';
import CommercialStepRiskCategories from '../components/hrs/commercial/steps/CommercialStepRiskCategories';
import CommercialStepSignatures from '../components/hrs/commercial/steps/CommercialStepSignatures';
import CommercialStepReview from '../components/hrs/commercial/steps/CommercialStepReview';
import CommercialStepChecklist from '../components/hrs/commercial/steps/CommercialStepChecklist';
import { COMMERCIAL_STEPS, getActiveSteps, getNextButtonText, getStepIndex, getStepId } from '../lib/flowSteps';
import SignatureIncompleteDialog from '../components/hrs/SignatureIncompleteDialog';

function CommercialStepProgress({ currentStep, onGoTo }) {
  const visibleSteps = COMMERCIAL_STEPS;
  return (
    <div className="bg-card border-b border-hrs-border overflow-x-auto">
      <div className="flex min-w-[700px] px-4 sm:px-8">
        {visibleSteps.map((step, i) => {
          const isActive = i === currentStep;
          const isDone = i < currentStep;
          return (
            <button
              key={i}
              onClick={() => i <= currentStep && onGoTo(i)}
              className={`
                flex-1 flex items-center gap-2 py-3.5 px-2.5 border-b-[3px] transition-colors text-[0.78rem] font-medium whitespace-nowrap select-none
                ${isActive ? "border-hrs-orange text-hrs-blue" : "border-transparent"}
                ${isDone ? "text-hrs-green cursor-pointer" : ""}
                ${!isActive && !isDone ? "text-hrs-muted cursor-default" : ""}
                ${isActive ? "cursor-default" : ""}
                ${isDone ? "hover:text-hrs-blue2" : ""}
              `}
            >
              <span className={`
                w-[22px] h-[22px] rounded-full flex items-center justify-center text-[0.7rem] font-semibold flex-shrink-0 transition-colors
                ${isActive ? "bg-hrs-orange text-white" : ""}
                ${isDone ? "bg-hrs-green text-white" : ""}
                ${!isActive && !isDone ? "bg-muted text-hrs-muted" : ""}
              `}>
                {isDone ? <Check className="w-3 h-3" /> : i + 1}
              </span>
              <span className="hidden lg:inline">{step.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const TOTAL_STEPS = COMMERCIAL_STEPS.length + 1; // review steps + checklist
const CHECKLIST_STEP = TOTAL_STEPS - 1; // 8
const FLOW_TYPE = 'commercial';

export default function CommercialAdviceRecord() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState(getCommercialInitialFormData());
  const [stepErrors, setStepErrors] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRestoreBanner, setShowRestoreBanner] = useState(false);
  const [signatureDialogOpen, setSignatureDialogOpen] = useState(false);
  const pendingDraftRef = useRef(null);

  useEffect(() => {
    const { status, draft } = getDraftStatus(FLOW_TYPE);
    if (status === 'expired') {
      toast({
        title: "Draft expired",
        description: "Your previous draft expired for privacy and security. Please start again.",
      });
    } else if (status === 'valid') {
      pendingDraftRef.current = draft;
      setShowRestoreBanner(true);
    }
  }, []);

  useEffect(() => {
    if (user?.email && EMAIL_TO_BROKER?.[user.email] && !formData.brokerName) {
      setFormData(prev => ({ ...prev, brokerName: EMAIL_TO_BROKER[user.email] }));
    }
  }, [user?.email]);

  useEffect(() => {
    const isChecklistStep = step === CHECKLIST_STEP;
    if (isChecklistStep) return;
    if (pendingDraftRef.current) return;
    saveRoaDraft(FLOW_TYPE, { currentStep: step, formData });
  }, [step, formData]);

  useEffect(() => {
    if (step === CHECKLIST_STEP) return; // submitted — nothing left to lose
    if (!hasMeaningfulDraftData(FLOW_TYPE, formData)) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [step, formData]);

  const updateFormData = (updater) => {
    setFormData((prev) => {
      const raw = typeof updater === 'function' ? updater(prev) : updater;
      return applyConditionalCleanup(raw);
    });
  };

  const handleRestoreDraft = () => {
    const draft = pendingDraftRef.current;
    if (draft) {
      setFormData(draft.formData);
      setStep(draft.currentStep || 0);
    }
    pendingDraftRef.current = null;
    setShowRestoreBanner(false);
  };

  const handleDismissDraft = () => {
    clearRoaDraft(FLOW_TYPE);
    pendingDraftRef.current = null;
    setShowRestoreBanner(false);
  };

  const isChecklist = step === CHECKLIST_STEP;

  const tryNext = () => {
    // Signatures step (6) — optional if sending via DocuSign
    const errors = getCommercialStepErrors(step, formData);
    if (errors.length && step !== 6) {
      setStepErrors(errors);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    // For signatures step, warn but allow proceeding
    if (step === getStepIndex(COMMERCIAL_STEPS, 'signatures', formData) && errors.length) {
      setSignatureDialogOpen(true);
      return;
    }
    setStepErrors([]);
    setStep(s => Math.min(s + 1, COMMERCIAL_STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goToSignatures = () => {
    setSignatureDialogOpen(false);
    setStep(getStepIndex(COMMERCIAL_STEPS, 'signatures', formData));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goPrev = () => {
    setStepErrors([]);
    setStep(s => Math.max(s - 1, 0));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goTo = (i) => {
    if (i <= step) {
      setStepErrors([]);
      setStep(i);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSubmit = async () => {
    // Validate all steps except signatures (6) which is optional
    const allErrors = [0, 1, 2, 3, 4, 5].flatMap((s) =>
      getCommercialStepErrors(s, formData).map((e) => `Step ${s + 1}: ${e}`)
    );
    if (allErrors.length > 0) {
      toast({
        variant: "destructive",
        title: "Please complete required fields",
        description: allErrors.join(" · "),
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const { base64, filename } = await generateCommercialROABase64(formData);
      const brokerEmail = BROKER_EMAIL_MAP[formData.brokerName] || DEFAULT_BROKER_EMAIL;
      const subject = `New Commercial Advice Record – ${formData.companyName} (${formData.brokerName})`;
      const body = `New Commercial Advice Record Submitted
========================================
Broker / Advisor: ${formData.brokerName}
Company Name: ${formData.companyName}
Registration No.: ${formData.registrationNo || '-'}
VAT No.: ${formData.vatNo || '-'}
Nature of Business: ${formData.natureOfBusiness}
Risk Address: ${formData.riskAddress}
Contact Person: ${formData.contactPerson}
Email: ${formData.email}
Contact No.: ${formData.contactNo}
Inception Date: ${formData.inceptionDate}

Recommended Insurer: ${formData.recInsurer}
Broker Fee: ${getBrokerFeeSummary(formData).consentRequired ? getBrokerFeeSummary(formData).displayValue : 'No broker fee applicable'}
Option 1: ${formData.ins0 || '-'} — R${formData.prem0 || '-'}
Option 2: ${formData.ins1 || '-'} — R${formData.prem1 || '-'}
Option 3 (Recommended): ${formData.ins2 || '-'} — R${formData.prem2 || '-'}

Replacing Existing Policy: ${formData.replacingExisting === 'yes' ? 'Yes' : 'No'}
Signature Date: ${formData.sigDate}

---
Holistic Risk Services (Pty) Ltd – FSP 28582`.trim();

      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: brokerEmail, subject, body, pdfBase64: base64, pdfFilename: filename }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to send email');
      }

      clearRoaDraft(FLOW_TYPE);
      // CRM sync now runs (with visible status + retry) on the Checklist screen itself —
      // see CommercialStepChecklist.jsx — rather than fire-and-forget here.

      setStep(CHECKLIST_STEP);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Submission failed",
        description: err.message || "Could not send the email. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const restart = () => {
    clearRoaDraft(FLOW_TYPE);
    setFormData(getCommercialInitialFormData());
    setStep(0);
    setStepErrors([]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const activeSteps = getActiveSteps(COMMERCIAL_STEPS, formData);
  const currentStepId = getStepId(activeSteps, step, formData);
  const stepProps = {
    data: formData,
    onChange: updateFormData,
    onNext: tryNext,
    onPrev: goPrev,
    nextLabel: getNextButtonText(activeSteps, currentStepId, formData),
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Advice Record – New Commercial Insurance" />

      {!isChecklist && (
        <div className="bg-hrs-blue/95 border-b border-hrs-orange/40 px-4 py-2 flex items-center gap-3">
          <button onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-white/70 hover:text-white text-[0.78rem] transition-colors">
            ← Back to Home
          </button>
          <span className="text-white/20 text-[0.75rem]">|</span>
          <span className="text-white/50 text-[0.75rem]">Commercial Lines ROA</span>
        </div>
      )}

      {showRestoreBanner && (
        <div className="bg-hrs-blue text-white text-[0.82rem] px-4 py-2.5 flex items-center justify-between gap-4">
          <span>You have an unsaved Commercial ROA in progress — continue? (Signatures will need to be recaptured.)</span>
          <div className="flex gap-3 flex-shrink-0">
            <button onClick={handleRestoreDraft} className="underline font-semibold">Continue</button>
            <button onClick={handleDismissDraft} className="opacity-70 hover:opacity-100">Discard</button>
          </div>
        </div>
      )}

      {!isChecklist && <CommercialStepProgress currentStep={step} onGoTo={goTo} />}

      {stepErrors.length > 0 && (
        <div className="max-w-[860px] mx-auto px-3 sm:px-5 pt-5">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-[0.8rem] font-semibold text-red-700 mb-1">Please complete the following required fields:</p>
              <ul className="list-disc pl-4">
                {stepErrors.map(e => <li key={e} className="text-[0.78rem] text-red-600">{e}</li>)}
              </ul>
            </div>
            <button onClick={() => setStepErrors([])} className="text-red-400 hover:text-red-600 flex-shrink-0 mt-0.5">✕</button>
          </div>
        </div>
      )}

      <main className="max-w-[860px] mx-auto px-3 sm:px-5 py-9 pb-20">
        {!isChecklist && (
          <div className="bg-hrs-blue text-white rounded-xl p-5 mb-6 flex items-start gap-4">
            <Building2 className="w-9 h-9 text-hrs-orange flex-shrink-0 mt-0.5" />
            <div>
              <h2 className="font-heading text-[1.1rem] text-hrs-orange mb-1">
                Advice Record – New Commercial Insurance
              </h2>
              <p className="text-[0.82rem] opacity-80 leading-relaxed">
                This record is created in terms of the Financial Advisory and Intermediary Services (FAIS) Act. Please complete all fields accurately. Holistic Risk Services (Pty) Ltd – FSP 28582
              </p>
            </div>
          </div>
        )}

        {step === 0 && <CommercialStepClientDetails {...stepProps} />}
        {step === 1 && <CommercialStepInsuranceHistory {...stepProps} />}
        {step === 2 && <CommercialStepProductsAdvice {...stepProps} />}
        {step === 3 && <CommercialStepReplacementPolicy {...stepProps} />}
        {step === 4 && <CommercialStepPrinciples {...stepProps} />}
        {step === 5 && <CommercialStepRiskCategories {...stepProps} />}
        {step === 6 && (
          <CommercialStepSignatures
            {...stepProps}
            onNext={tryNext}
            isSubmitting={false}
            nextLabel={getNextButtonText(activeSteps, currentStepId, formData)}
          />
        )}
        {step === 7 && (
          <CommercialStepReview
            data={formData}
            onPrev={goPrev}
            onSubmit={handleSubmit}
            isSubmitting={isSubmitting}
          />
        )}
        {step === 8 && <CommercialStepChecklist data={formData} onRestart={restart} />}
      </main>
      <SignatureIncompleteDialog
        open={signatureDialogOpen}
        onOpenChange={setSignatureDialogOpen}
        onGoToSignatures={goToSignatures}
        signingRoute="docusign"
      />
    </div>
  );
}
