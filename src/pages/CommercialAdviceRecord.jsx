import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { BROKER_EMAIL_MAP, DEFAULT_BROKER_EMAIL, EMAIL_TO_BROKER } from '../lib/hrsConstants';
import { syncCommercialROAToCRM } from '@/lib/crmSync';
import { supabase } from '@/lib/supabaseClient';
import { Building2 } from 'lucide-react';
import AppHeader from '../components/hrs/AppHeader';
import StepProgress from '../components/hrs/StepProgress';
import { toast } from "@/components/ui/use-toast";
import {
  COMMERCIAL_STEPS,
  getCommercialStepErrors,
  getCommercialInitialFormData,
} from '../lib/hrsCommercialConstants';
import { generateCommercialROABase64 } from '../lib/hrsCommercialPdfGenerator';
import CommercialStepClientDetails from '../components/hrs/commercial/steps/CommercialStepClientDetails';
import CommercialStepInsuranceHistory from '../components/hrs/commercial/steps/CommercialStepInsuranceHistory';
import CommercialStepProductsAdvice from '../components/hrs/commercial/steps/CommercialStepProductsAdvice';
import CommercialStepReplacementPolicy from '../components/hrs/commercial/steps/CommercialStepReplacementPolicy';
import CommercialStepPrinciples from '../components/hrs/commercial/steps/CommercialStepPrinciples';
import CommercialStepRiskCategories from '../components/hrs/commercial/steps/CommercialStepRiskCategories';
import CommercialStepSignatures from '../components/hrs/commercial/steps/CommercialStepSignatures';
import CommercialStepChecklist from '../components/hrs/commercial/steps/CommercialStepChecklist';


const SESSION_KEY = 'hrs_commercial_roa_draft';

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function writeSession(data) {
  // Exclude base64 signatures — they can be 100–200KB each and risk hitting the ~5MB sessionStorage quota
  const { clientSig: _c, advisorSig: _a, ...rest } = data;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(rest)); } catch { /* private browsing */ }
}
function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

export default function CommercialAdviceRecord() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState(getCommercialInitialFormData());
  const [stepErrors, setStepErrors] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRestoreBanner, setShowRestoreBanner] = useState(false);

  const totalSteps = COMMERCIAL_STEPS.length;
  const isChecklist = step === totalSteps - 1;

  useEffect(() => {
    if (readSession()) setShowRestoreBanner(true);
  }, []);

  useEffect(() => {
    if (isChecklist) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isChecklist]);

  useEffect(() => {
    if (user?.email && EMAIL_TO_BROKER?.[user.email] && !formData.brokerName) {
      setFormData(prev => ({ ...prev, brokerName: EMAIL_TO_BROKER[user.email] }));
    }
  }, [user?.email]);

  const updateFormData = useCallback((updater) => {
    setFormData((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      writeSession(next);
      return next;
    });
  }, []);

  const handleRestore = () => {
    const saved = readSession();
    if (saved) setFormData(saved);
    setShowRestoreBanner(false);
  };

  const handleDismissRestore = () => {
    clearSession();
    setShowRestoreBanner(false);
  };

  const tryNext = () => {
    const errors = getCommercialStepErrors(step, formData);
    if (errors.length) {
      setStepErrors(errors);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setStepErrors([]);
    setStep(s => Math.min(s + 1, totalSteps - 1));
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
    // Validate all steps
    const allErrors = [0, 1, 2, 3, 4, 5, 6].flatMap((s) =>
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
ID Number: ${formData.idNo || '-'}
Email: ${formData.email}
Contact No.: ${formData.contactNo}
Inception Date: ${formData.inceptionDate}

Recommended Insurer: ${formData.recInsurer}
Broker Fee: ${formData.brokerFeePercent ? formData.brokerFeePercent + (formData.brokerFeeType === 'percent' ? '%' : ' (fixed)') : '-'}
Option 1: ${formData.ins0 || '-'} — R${formData.prem0 || '-'}
Option 2: ${formData.ins1 || '-'} — R${formData.prem1 || '-'}
Option 3 (Recommended): ${formData.ins2 || '-'} — R${formData.prem2 || '-'}

Replacing Existing Policy: ${formData.replacingExisting === 'yes' ? 'Yes' : formData.replacingExisting === 'no' ? 'No' : 'Not answered'}
${formData.replacingExisting === 'yes' ? `Current Insurer: ${formData.currentInsurer || '-'} → New Insurer: ${formData.newInsurer || '-'}` : ''}

Signature Date: ${formData.sigDate}

Acknowledgements:
- Short-Term Insurance Principles: ${formData.ackPrinciples ? 'Acknowledged' : 'Not acknowledged'}
- POPIA Consent: ${formData.ackPopia ? 'Acknowledged' : 'Not acknowledged'}
- Intermediary Agreement: ${formData.ackIntermediaryAgreement ? 'Acknowledged' : 'Not acknowledged'}

---
Holistic Risk Services (Pty) Ltd – FSP 28582`.trim();

      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: brokerEmail,
          subject,
          body,
          pdfBase64: base64,
          pdfFilename: filename,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to send email');
      }

      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          syncCommercialROAToCRM(formData, session)
            .then(r => r.success
              ? console.log('CRM sync OK — client:', r.clientId, 'deal:', r.dealId)
              : console.warn('CRM sync failed:', r.error)
            );
        }
      });

      clearSession();
      setStep(totalSteps - 1);
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
    clearSession();
    setFormData(getCommercialInitialFormData());
    setStep(0);
    setStepErrors([]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const stepProps = {
    data: formData,
    onChange: updateFormData,
    onNext: tryNext,
    onPrev: goPrev,
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Advice Record – New Commercial Insurance" />

      {!isChecklist && (
        <div className="bg-hrs-blue/95 border-b border-hrs-orange/40 px-4 py-2 flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-white/70 hover:text-white text-[0.78rem] transition-colors"
          >
            ← Back to Home
          </button>
          <span className="text-white/20 text-[0.75rem]">|</span>
          <span className="text-white/50 text-[0.75rem]">Commercial Lines ROA</span>
        </div>
      )}

      {showRestoreBanner && (
        <div className="bg-hrs-blue text-white text-[0.82rem] px-4 py-2.5 flex items-center justify-between gap-4">
          <span>You have an unsaved Commercial ROA in progress — continue?</span>
          <div className="flex gap-3 flex-shrink-0">
            <button onClick={handleRestore} className="underline font-semibold">Continue</button>
            <button onClick={handleDismissRestore} className="opacity-70 hover:opacity-100">Discard</button>
          </div>
        </div>
      )}

      {!isChecklist && (
        <StepProgress currentStep={step} onGoTo={goTo} steps={COMMERCIAL_STEPS.slice(0, -1)} />
      )}

      {stepErrors.length > 0 && (
        <div className="max-w-[860px] mx-auto px-3 sm:px-5 pt-5">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-[0.8rem] font-semibold text-red-700 mb-1">Please complete the following required fields:</p>
            <ul className="list-disc pl-4">
              {stepErrors.map(e => (
                <li key={e} className="text-[0.78rem] text-red-600">{e}</li>
              ))}
            </ul>
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
        {step === 4 && <CommercialStepRiskCategories {...stepProps} />}
        {step === 5 && <CommercialStepPrinciples {...stepProps} />}
        {step === 6 && (
          <CommercialStepSignatures
            {...stepProps}
            onNext={handleSubmit}
            isSubmitting={isSubmitting}
            nextLabel="Submit & Send"
          />
        )}
        {step === 7 && <CommercialStepChecklist data={formData} onRestart={restart} />}
      </main>
    </div>
  );
}