import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  COMMERCIAL_STEPS,
  getCommercialStepErrors,
  getCommercialInitialFormData,
} from '../lib/hrsCommercialConstants';
import { generateCommercialROABase64 } from '../lib/hrsCommercialPdfGenerator';
import { BROKER_EMAIL_MAP, DEFAULT_BROKER_EMAIL } from '../lib/hrsConstants';
import { toast } from '@/components/ui/use-toast';
import CommercialStepClientDetails from '../components/hrs/commercial/steps/CommercialStepClientDetails';
import CommercialStepInsuranceHistory from '../components/hrs/commercial/steps/CommercialStepInsuranceHistory';
import CommercialStepProductsAdvice from '../components/hrs/commercial/steps/CommercialStepProductsAdvice';
import CommercialStepReplacementPolicy from '../components/hrs/commercial/steps/CommercialStepReplacementPolicy';
import CommercialStepPrinciples from '../components/hrs/commercial/steps/CommercialStepPrinciples';
import CommercialStepRiskCategories from '../components/hrs/commercial/steps/CommercialStepRiskCategories';
import CommercialStepSignatures from '../components/hrs/commercial/steps/CommercialStepSignatures';
import CommercialStepChecklist from '../components/hrs/commercial/steps/CommercialStepChecklist';

const LAST_FORM_STEP = 6; // Signatures — step after this triggers submission

export default function CommercialAdviceRecord() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState(getCommercialInitialFormData);
  const [stepErrors, setStepErrors] = useState([]);
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const totalSteps = COMMERCIAL_STEPS.length;

  const handleSubmit = async () => {
    const allErrors = [0, 1, 2, 3, 4, 5, 6].flatMap((s) =>
      getCommercialStepErrors(s, formData).map((e) => `Step ${s + 1}: ${e}`)
    );
    if (allErrors.length > 0) {
      setStepErrors(allErrors);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setIsSubmitting(true);
    try {
      const { base64, filename } = await generateCommercialROABase64(formData);

      const brokerEmail = BROKER_EMAIL_MAP[formData.brokerName] || DEFAULT_BROKER_EMAIL;
      const subject = `New Commercial Advice Record – ${formData.companyName} (${formData.brokerName})`;
      const body = `New Commercial Advice Record Submitted
============================
Advisor: ${formData.brokerName}
Company: ${formData.companyName}
Registration No: ${formData.registrationNo}
VAT No: ${formData.vatNo || '-'}
Nature of Business: ${formData.natureOfBusiness}
Risk Address: ${formData.riskAddress}
Contact Person: ${formData.contactPerson}
Email: ${formData.email}
Contact No: ${formData.contactNo}

Recommended Insurer: ${formData.recInsurer}
Broker Fee: ${formData.brokerFeePercent ? formData.brokerFeePercent + (formData.brokerFeeType === 'fixed' ? ' (fixed)' : '%') : '-'}
Option 1: ${formData.ins0 || '-'} — R${formData.prem0 || '-'}
Option 2: ${formData.ins1 || '-'} — R${formData.prem1 || '-'}
Option 3 (Recommended): ${formData.ins2 || '-'} — R${formData.prem2 || '-'}
Reasons for Recommendation: ${formData.recReasons || '-'}

Replacement Policy: ${formData.replacingExisting === true ? 'Yes' : formData.replacingExisting === false ? 'No' : '-'}
Inception Date: ${formData.inceptionDate}
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

      setSubmitted(true);
      setStep(totalSteps - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Submission failed',
        description: err.message || 'Could not send the email. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const tryNext = () => {
    if (isSubmitting) return;
    const errors = getCommercialStepErrors(step, formData);
    if (errors.length) {
      setStepErrors(errors);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setStepErrors([]);
    if (step === LAST_FORM_STEP) {
      handleSubmit();
      return;
    }
    setStep(s => Math.min(s + 1, totalSteps - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goPrev = () => {
    setStepErrors([]);
    setStep(s => Math.max(s - 1, 0));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const restart = () => {
    setFormData(getCommercialInitialFormData());
    setStep(0);
    setStepErrors([]);
    setSubmitted(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const stepProps = { data: formData, onChange: setFormData, onNext: tryNext, onPrev: goPrev };

  const isChecklist = submitted && step === totalSteps - 1;

  return (
    <div className="min-h-screen bg-secondary">
      {/* Top bar */}
      <div className="bg-hrs-blue border-b-2 border-hrs-orange px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
        <button
          onClick={() => navigate('/')}
          className="text-white/60 hover:text-white transition-colors flex items-center gap-1.5 text-[0.78rem]"
        >
          <ArrowLeft className="w-4 h-4" /> Home
        </button>
        <div className="flex-1 text-center">
          <span className="text-white font-heading text-[0.95rem]">Commercial ROA</span>
          <span className="text-white/40 text-[0.75rem] ml-2">— New Business Insurance</span>
        </div>
        <span className="text-hrs-orange text-[0.78rem] font-semibold">
          {isChecklist ? 'Checklist' : `${step + 1} / ${totalSteps - 1}`}
        </span>
      </div>

      {/* Progress bar */}
      {!isChecklist && (
        <div className="bg-hrs-blue/10 border-b border-hrs-border px-4 py-3">
          <div className="max-w-2xl mx-auto">
            <div className="flex gap-1 mb-2">
              {COMMERCIAL_STEPS.slice(0, -1).map((s, i) => (
                <div
                  key={i}
                  className={`flex-1 h-1.5 rounded-full transition-all ${i <= step ? 'bg-hrs-orange' : 'bg-hrs-border'}`}
                />
              ))}
            </div>
            <p className="text-[0.75rem] text-hrs-blue2 font-semibold">
              Step {step + 1}: {COMMERCIAL_STEPS[step]?.label}
            </p>
          </div>
        </div>
      )}

      {/* Errors */}
      {stepErrors.length > 0 && (
        <div className="max-w-2xl mx-auto px-4 pt-4">
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

      {/* Steps */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        {isChecklist ? (
          <CommercialStepChecklist data={formData} onRestart={restart} />
        ) : (
          <>
            {step === 0 && <CommercialStepClientDetails {...stepProps} />}
            {step === 1 && <CommercialStepInsuranceHistory {...stepProps} />}
            {step === 2 && <CommercialStepProductsAdvice {...stepProps} />}
            {step === 3 && <CommercialStepReplacementPolicy {...stepProps} />}
            {step === 4 && <CommercialStepPrinciples {...stepProps} />}
            {step === 5 && <CommercialStepRiskCategories {...stepProps} />}
            {step === 6 && <CommercialStepSignatures {...stepProps} isSubmitting={isSubmitting} />}
          </>
        )}
      </div>
    </div>
  );
}