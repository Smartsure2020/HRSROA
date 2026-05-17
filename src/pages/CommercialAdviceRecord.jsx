import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { EMAIL_TO_BROKER } from '../lib/hrsConstants';
import { syncCommercialROAToCRM } from '@/lib/crmSync';
import { supabase } from '@/lib/supabaseClient';
import { Check } from 'lucide-react';
import { Building2 } from 'lucide-react';
import AppHeader from '../components/hrs/AppHeader';
import {
  COMMERCIAL_STEPS,
  getCommercialStepErrors,
  getCommercialInitialFormData,
} from '../lib/hrsCommercialConstants';
import CommercialStepClientDetails from '../components/hrs/commercial/steps/CommercialStepClientDetails';
import CommercialStepInsuranceHistory from '../components/hrs/commercial/steps/CommercialStepInsuranceHistory';
import CommercialStepProductsAdvice from '../components/hrs/commercial/steps/CommercialStepProductsAdvice';
import CommercialStepReplacementPolicy from '../components/hrs/commercial/steps/CommercialStepReplacementPolicy';
import CommercialStepPrinciples from '../components/hrs/commercial/steps/CommercialStepPrinciples';
import CommercialStepRiskCategories from '../components/hrs/commercial/steps/CommercialStepRiskCategories';
import CommercialStepSignatures from '../components/hrs/commercial/steps/CommercialStepSignatures';
import CommercialStepChecklist from '../components/hrs/commercial/steps/CommercialStepChecklist';

function CommercialStepProgress({ currentStep, onGoTo }) {
  return (
    <div className="bg-card border-b border-hrs-border overflow-x-auto">
      <div className="flex min-w-[700px] px-4 sm:px-8">
        {COMMERCIAL_STEPS.slice(0, -1).map((step, i) => {
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
              <span
                className={`
                  w-[22px] h-[22px] rounded-full flex items-center justify-center text-[0.7rem] font-semibold flex-shrink-0 transition-colors
                  ${isActive ? "bg-hrs-orange text-white" : ""}
                  ${isDone ? "bg-hrs-green text-white" : ""}
                  ${!isActive && !isDone ? "bg-muted text-hrs-muted" : ""}
                `}
              >
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

export default function CommercialAdviceRecord() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState(getCommercialInitialFormData());
  const [stepErrors, setStepErrors] = useState([]);

  const crmSynced = useRef(false);

  useEffect(() => {
    if (user?.email && EMAIL_TO_BROKER[user.email] && !formData.brokerName) {
      setFormData(prev => ({ ...prev, brokerName: EMAIL_TO_BROKER[user.email] }));
    }
  }, [user?.email]);

  useEffect(() => {
    if (step === 7 && !crmSynced.current) {
      crmSynced.current = true;
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          syncCommercialROAToCRM(formData, session)
            .then(r => r.success
              ? console.log('CRM sync OK — client:', r.clientId, 'deal:', r.dealId)
              : console.warn('CRM sync failed:', r.error)
            );
        }
      });
    }
  }, [step, formData]);

  const totalSteps = COMMERCIAL_STEPS.length;
  const isChecklist = step === totalSteps - 1;

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

  const restart = () => {
    setFormData(getCommercialInitialFormData());
    setStep(0);
    setStepErrors([]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const stepProps = { data: formData, onChange: setFormData, onNext: tryNext, onPrev: goPrev };

  return (
    <div className="min-h-screen bg-background">
      {/* Same header as personal */}
      <AppHeader title="Advice Record – New Commercial Insurance" />

      {/* Back to home + breadcrumb bar */}
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

      {/* Step progress — matches personal exactly */}
      {!isChecklist && (
        <CommercialStepProgress currentStep={step} onGoTo={goTo} />
      )}

      {/* Step errors */}
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

        {/* Info banner — matches personal style */}
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
        {step === 6 && <CommercialStepSignatures {...stepProps} />}
        {step === 7 && <CommercialStepChecklist data={formData} onRestart={restart} />}
      </main>
    </div>
  );
}