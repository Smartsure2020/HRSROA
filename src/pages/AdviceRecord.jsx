import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import AppHeader from "../components/hrs/AppHeader";
import StepProgress from "../components/hrs/StepProgress";
import StepClientDetails from "../components/hrs/steps/StepClientDetails";
import StepInsuranceHistory from "../components/hrs/steps/StepInsuranceHistory";
import StepProductsAdvice from "../components/hrs/steps/StepProductsAdvice";
import StepRiskCategories from "../components/hrs/steps/StepRiskCategories";
import StepPrinciples from "../components/hrs/steps/StepPrinciples";
import StepSignatures from "../components/hrs/steps/StepSignatures";
import StepChecklist from "../components/hrs/steps/StepChecklist";
import StepReview from "../components/hrs/steps/StepReview";
import { getInitialFormData, getStepErrors, BROKER_EMAIL_MAP, DEFAULT_BROKER_EMAIL, EMAIL_TO_BROKER } from "../lib/hrsConstants";
import { useAuth } from '@/lib/AuthContext';
import { generateROABase64 } from "../lib/hrsPdfGenerator";
import { toast } from "@/components/ui/use-toast";

const TOTAL_STEPS = 7;
const SESSION_KEY = 'hrs_roa_draft';

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function writeSession(data) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch { /* private browsing */ }
}
function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

export default function AdviceRecord() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState(getInitialFormData);
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showRestoreBanner, setShowRestoreBanner] = useState(false);

  useEffect(() => {
    if (readSession()) setShowRestoreBanner(true);
  }, []);

  useEffect(() => {
    if (user?.email && EMAIL_TO_BROKER[user.email] && !formData.brokerName) {
      setFormData(prev => ({ ...prev, brokerName: EMAIL_TO_BROKER[user.email] }));
    }
  }, [user?.email]);

  useEffect(() => {
    if (submitted) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [submitted]);

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

  const goTo = useCallback((step) => {
    if (step <= currentStep) {
      setCurrentStep(step);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [currentStep]);

  const handleNext = useCallback(() => {
    const errors = getStepErrors(currentStep, formData);
    if (errors.length > 0) {
      toast({
        variant: "destructive",
        title: "Please complete required fields",
        description: errors.join(" · "),
      });
      return;
    }
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep((s) => s + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [currentStep, formData]);

  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [currentStep]);

  const handleSubmit = async () => {
    const allErrors = [0, 1, 2, 3, 4, 5].flatMap((step) =>
      getStepErrors(step, formData).map((e) => `Step ${step + 1}: ${e}`)
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
      const { base64, filename } = await generateROABase64(formData);

      const brokerEmail = BROKER_EMAIL_MAP[formData.brokerName] || DEFAULT_BROKER_EMAIL;
      const subject = `New Advice Record – ${formData.firstName} ${formData.surname} (${formData.brokerName})`;
      const body = `New Advice Record Submitted
============================
Broker / Advisor: ${formData.brokerName}
Client: ${formData.firstName} ${formData.surname}
ID/Passport: ${formData.idNumber}
Email: ${formData.email}
Cell: ${formData.cell}
Address: ${[formData.streetNumber, formData.streetName, formData.complexName, formData.suburb, formData.city, formData.province, formData.postalCode].filter(Boolean).join(', ')}
Occupation: ${formData.occupation}
Marital Status: ${formData.maritalStatus}

Recommended Insurer: ${formData.recInsurer}
Broker Fee: ${formData.brokerFeePercent ? formData.brokerFeePercent + '%' : '-'}
Option 1: ${formData.ins0 || '-'} — R${formData.prem0 || '-'}
Option 2: ${formData.ins1 || '-'} — R${formData.prem1 || '-'}
Option 3 (Recommended): ${formData.ins2 || '-'} — R${formData.prem2 || '-'}

Banking:
Bank: ${formData.bankName} | Account: ${formData.accountNumber} | Type: ${formData.accountType}
Deduction: R${formData.deductionAmount || '-'} on the ${formData.deductionDate || '-'}
Inception Date: ${formData.inceptionDate}
Insurer (Debit Order): ${formData.doInsurer}

Signature Date: ${formData.sigDate}

All acknowledgements completed: ${
  [formData.ackPrinciples, formData.ackAdvisor, formData.ackClient, formData.ackPopia, formData.ackTermination, formData.ackBrokerFee, formData.ackBrokerAppointment, formData.ackBrokerAuth].every(Boolean)
    ? 'Yes' : 'No – some acknowledgements outstanding'
}

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

      clearSession();
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
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

  const handleRestart = () => {
    clearSession();
    setFormData(getInitialFormData());
    setCurrentStep(0);
    setSubmitted(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleGoHome = () => {
    if (!submitted && Object.values(formData).some(v => v)) {
      const confirm = window.confirm('You have an ROA in progress. Are you sure you want to go back to the home screen? Your progress will be saved in this session.');
      if (!confirm) return;
    }
    navigate('/');
  };

  const renderStep = () => {
    if (submitted) {
      return <StepChecklist data={formData} onRestart={handleRestart} />;
    }

    const common = { data: formData, onChange: updateFormData, onNext: handleNext, onPrev: prevStep };

    switch (currentStep) {
      case 0: return <StepClientDetails {...common} />;
      case 1: return <StepInsuranceHistory {...common} />;
      case 2: return <StepProductsAdvice {...common} />;
      case 3: return <StepRiskCategories {...common} />;
      case 4: return <StepPrinciples {...common} />;
      case 5: return <StepSignatures {...common} />;
      case 6: return <StepReview data={formData} onPrev={prevStep} onSubmit={handleSubmit} isSubmitting={isSubmitting} />;
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      {/* Back to home bar */}
      {!submitted && (
        <div className="bg-hrs-blue/95 border-b border-hrs-orange/40 px-4 py-2 flex items-center gap-3">
          <button
            onClick={handleGoHome}
            className="flex items-center gap-1.5 text-white/70 hover:text-white text-[0.78rem] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Home
          </button>
          <span className="text-white/20 text-[0.75rem]">|</span>
          <span className="text-white/50 text-[0.75rem]">Personal Lines ROA</span>
        </div>
      )}

      {showRestoreBanner && (
        <div className="bg-hrs-blue text-white text-[0.82rem] px-4 py-2.5 flex items-center justify-between gap-4">
          <span>You have an unsaved ROA in progress — continue?</span>
          <div className="flex gap-3 flex-shrink-0">
            <button onClick={handleRestore} className="underline font-semibold">Continue</button>
            <button onClick={handleDismissRestore} className="opacity-70 hover:opacity-100">Discard</button>
          </div>
        </div>
      )}

      {!submitted && <StepProgress currentStep={currentStep} onGoTo={goTo} />}
      <main className="max-w-[860px] mx-auto px-3 sm:px-5 py-9 pb-20">
        {renderStep()}
      </main>
    </div>
  );
}