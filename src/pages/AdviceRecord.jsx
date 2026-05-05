import { useState, useCallback } from "react";
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
import { getInitialFormData } from "../lib/hrsConstants";


const TOTAL_STEPS = 7;

export default function AdviceRecord() {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState(getInitialFormData);
  const [submitted, setSubmitted] = useState(false);


  const goTo = useCallback((step) => {
    if (step <= currentStep) {
      setCurrentStep(step);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [currentStep]);

  const nextStep = useCallback(() => {
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep((s) => s + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [currentStep]);

  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [currentStep]);

  const handleSubmit = async () => {
    setSubmitted(true);
    window.scrollTo({ top: 0, behavior: "smooth" });

    // Send notification email to HRS with full summary
    const riskSummary = formData.riskState
      .map((s, i) => {
        const name = formData.riskState[i];
        return s.cover ? `${i + 1}. ${s.cover === 'yes' ? 'YES' : 'NO'}${s.sasria ? ' (SASRIA)' : ''}` : null;
      })
      .filter(Boolean).join('\n');

    const emailBody = `
New Advice Record Submitted
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
  [formData.ackPrinciples, formData.ackAdvisor, formData.ackClient, formData.ackPopia, formData.ackTermination, formData.ackBrokerFee, formData.ackDebit].every(Boolean)
    ? 'Yes' : 'No – some acknowledgements outstanding'
}

---
Holistic Risk Services (Pty) Ltd – FSP 28582
    `.trim();

    // Map broker name to email
    const brokerEmailMap = {
      'Aedan Doubell': 'aedan@hrsinsurance.co.za',
      'Andrew Penney': 'andrew@hrsinsurance.co.za',
      'Charmaine Brogden': 'charmaine@hrsinsurance.co.za',
      'Daniel Pottier': 'daniel@hrsinsurance.co.za',
      'Jaryd Browne': 'jaryd@hrsinsurance.co.za',
      'Juan-Paul vd Merwe': 'juan-paul@hrsinsurance.co.za',
      'Werner Joubert': 'werner@hrsinsurance.co.za',
    };
    const brokerEmail = brokerEmailMap[formData.brokerName] || 'info@hrsinsurance.co.za';

    console.log("Email would be sent to:", brokerEmail);
console.log("Email subject:", `New Advice Record – ${formData.firstName} ${formData.surname} (${formData.brokerName})`);
console.log("Email body:", emailBody);
  };

  const handleRestart = () => {
    setFormData(getInitialFormData());
    setCurrentStep(0);
    setSubmitted(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const renderStep = () => {
    if (submitted) {
      return <StepChecklist data={formData} onRestart={handleRestart} />;
    }

    const common = { data: formData, onChange: setFormData, onNext: nextStep, onPrev: prevStep };

    switch (currentStep) {
      case 0: return <StepClientDetails {...common} />;
      case 1: return <StepInsuranceHistory {...common} />;
      case 2: return <StepProductsAdvice {...common} />;
      case 3: return <StepRiskCategories {...common} />;
      case 4: return <StepPrinciples {...common} />;
      case 5: return <StepSignatures {...common} />;
      case 6: return <StepReview data={formData} onPrev={prevStep} onSubmit={handleSubmit} />;
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      {!submitted && <StepProgress currentStep={currentStep} onGoTo={goTo} />}
      <main className="max-w-[860px] mx-auto px-3 sm:px-5 py-9 pb-20">
        {renderStep()}
      </main>
    </div>
  );
}