import { Check, AlertTriangle } from "lucide-react";
import FormCard from "../../FormCard";
import SectionTitle from "../../SectionTitle";
import NavBar from "../../NavBar";
import { COMMERCIAL_RISK_CATEGORIES } from "../../../../lib/hrsCommercialConstants";

function ReviewSection({ title, children }) {
  return (
    <div className="mb-5">
      <h4 className="text-[0.78rem] uppercase tracking-[0.1em] text-hrs-muted mb-3 border-b border-hrs-border pb-1.5">
        {title}
      </h4>
      {children}
    </div>
  );
}

function ReviewRow({ label, value }) {
  return (
    <div className="flex py-2 border-b border-muted gap-4">
      <span className="text-[0.82rem] text-hrs-muted min-w-[190px] flex-shrink-0">{label}</span>
      <span className="text-[0.82rem] font-medium text-hrs-blue">{value || "—"}</span>
    </div>
  );
}

function AckStatus({ label, checked }) {
  return (
    <div className="flex py-2 border-b border-muted gap-4">
      <span className="text-[0.82rem] text-hrs-muted min-w-[190px] flex-shrink-0">{label}</span>
      <span className={`text-[0.82rem] font-medium flex items-center gap-1 ${checked ? "text-hrs-green" : "text-hrs-red"}`}>
        {checked
          ? <><Check className="w-3.5 h-3.5" /> Acknowledged</>
          : <><AlertTriangle className="w-3.5 h-3.5" /> Not ticked</>}
      </span>
    </div>
  );
}

function yn(val) {
  if (val === "yes") return "Yes";
  if (val === "no") return "No";
  return "Not answered";
}

export default function CommercialStepReview({ data, onPrev, onSubmit, isSubmitting }) {
  const netPrem = parseFloat(data.prem2) || 0;
  const feeVal = parseFloat(data.brokerFeePercent) || 0;
  const feeAmount = data.brokerFeeType === 'fixed' ? feeVal : (netPrem * feeVal / 100);

  return (
    <div>
      <FormCard>
        <SectionTitle>Review Your Submission</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-7">
          Please verify all details before submitting the commercial advice record.
        </p>

        <ReviewSection title="Client & Company Details">
          <ReviewRow label="Broker / Advisor" value={data.brokerName} />
          <ReviewRow label="Company Name" value={data.companyName} />
          <ReviewRow label="Registration No." value={data.registrationNo} />
          <ReviewRow label="VAT No." value={data.vatNo} />
          <ReviewRow label="Nature of Business" value={data.natureOfBusiness} />
          <ReviewRow label="Risk Address" value={data.riskAddress} />
          <ReviewRow label="Contact Person" value={data.contactPerson} />
          <ReviewRow label="ID Number" value={data.idNo} />
          <ReviewRow label="Email" value={data.email} />
          <ReviewRow label="Contact No." value={data.contactNo} />
          <ReviewRow label="Inception Date" value={data.inceptionDate} />
          <ReviewRow label="FAIS Disclosure Provided" value={yn(data.faisProvided)} />
          <ReviewRow label="Policy Type" value={data.policyType} />
          {data.existingPolicyRef ? <ReviewRow label="Existing Insurer / Policy No." value={data.existingPolicyRef} /> : null}
        </ReviewSection>

        <ReviewSection title="Insurance History">
          <ReviewRow label="Uninterrupted STI" value={yn(data.uninterruptedInsurance)} />
          <ReviewRow label="Years Insured" value={data.yearsInsured} />
          <ReviewRow label="Special Terms / Refused" value={yn(data.specialTerms)} />
          <ReviewRow label="Client Declined to Provide Info" value={yn(data.clientDeclinedInfo)} />
        </ReviewSection>

        <ReviewSection title="Needs Analysis">
          <ReviewRow label="Perils to be Insured" value={(data.perilsSelected || []).join(', ')} />
          <ReviewRow label="Value to be Insured" value={data.valueToBeInsured} />
          <ReviewRow label="Compulsory Excess" value={yn(data.compulsoryExcess)} />
          <ReviewRow label="Voluntary Excess" value={data.voluntaryExcess} />
          <ReviewRow label="No Claims Bonus" value={yn(data.noClaimsBonus)} />
          {data.riskProfileNotes ? <ReviewRow label="Risk Profile Notes" value={data.riskProfileNotes} /> : null}
        </ReviewSection>

        <ReviewSection title="Recommended Product">
          <ReviewRow label="Option 1" value={`${data.ins0 || '—'} — R${data.prem0 || '—'}`} />
          <ReviewRow label="Option 2" value={`${data.ins1 || '—'} — R${data.prem1 || '—'}`} />
          <ReviewRow label="Option 3 (Recommended)" value={`${data.ins2 || '—'} — R${data.prem2 || '—'}`} />
          <ReviewRow label="Recommended Insurer" value={data.recInsurer} />
          <ReviewRow label="Broker Fee" value={
            data.brokerFeePercent
              ? data.brokerFeeType === 'fixed'
                ? `R ${feeVal.toFixed(2)}`
                : `${feeVal}% (R ${feeAmount.toFixed(2)})`
              : '—'
          } />
        </ReviewSection>

        {data.replacingExisting === 'yes' && (
          <ReviewSection title="Replacement Policy">
            <ReviewRow label="Replacing Existing Policy" value="Yes" />
            <ReviewRow label="Like for Like" value={yn(data.likeForLike)} />
            <ReviewRow label="Current Insurer" value={data.currentInsurer} />
            <ReviewRow label="New Insurer" value={data.newInsurer} />
            <ReviewRow label="Reason for Replacement" value={data.replacementReason} />
          </ReviewSection>
        )}

        <ReviewSection title="Risk Categories">
          {COMMERCIAL_RISK_CATEGORIES.map((cat, i) => {
            const s = data.riskState?.[i];
            let cv = "—";
            if (s?.cover === "yes") cv = "✓ YES";
            if (s?.cover === "no") cv = "✗ NO";
            if (s?.sasria && s?.cover === "yes") cv += " · SASRIA ✓";
            return <ReviewRow key={i} label={cat.name} value={cv} />;
          })}
        </ReviewSection>

        <ReviewSection title="Acknowledgements">
          <AckStatus label="Insurance Principles" checked={data.ackPrinciples} />
          <AckStatus label="Advisor Obligations" checked={data.ackAdvisor} />
          <AckStatus label="Client Obligations" checked={data.ackClient} />
          <AckStatus label="POPIA Consent" checked={data.ackPopia} />
          <AckStatus label="Termination Terms" checked={data.ackTermination} />
          <AckStatus label="Broker Fee Consent" checked={data.ackBrokerFee} />
          <AckStatus label="Broker Appointment" checked={data.ackBrokerAppointment} />
          <AckStatus label="Broker Authorisation" checked={data.ackBrokerAuth} />
          <AckStatus label="Intermediary Agreement" checked={data.ackIntermediaryAgreement} />
          <AckStatus label="Statutory Disclosure (Sec 13)" checked={data.ackStatutoryDisclosure} />
          {data.changingBroker === "yes" ? <AckStatus label="Letter of Investigation" checked={data.ackLetterOfInvestigation} /> : null}
        </ReviewSection>

        <ReviewSection title="Client Declaration">
          <ReviewRow label="Election – Differs from Recommendation" value={data.electionDiffers ? "Yes" : "No"} />
          <ReviewRow label="Election – Not Follow Advice" value={data.electionNotFollow ? "Yes" : "No"} />
          <ReviewRow label="Election – More Limited Information" value={data.electionLimitedInfo ? "Yes" : "No"} />
          {(data.electionDiffers || data.electionNotFollow || data.electionLimitedInfo) && (
            <ReviewRow label="Client Initials" value={data.electionInitials} />
          )}
          <ReviewRow label="Final Declaration" value={data.declarationChoice === "decline" ? "Elects NOT to follow advice" : "Accepts advice & recommendations"} />
        </ReviewSection>

        <ReviewSection title="Signatures">
          <ReviewRow label="Signature Date" value={data.sigDate} />
          <ReviewRow label="Client Signature" value={data.clientSig ? "✓ Signed" : "Not signed (optional if sending via DocuSign)"} />
          <ReviewRow label="Advisor Signature" value={data.advisorSig ? "✓ Signed" : "Not signed (optional if sending via DocuSign)"} />
        </ReviewSection>
      </FormCard>

      <FormCard className="bg-gradient-to-br from-hrs-blue to-hrs-blue2 text-white">
        <div className="font-heading text-[1.15rem] text-hrs-orange mb-2">Ready to Submit?</div>
        <p className="text-[0.83rem] opacity-75 leading-relaxed mb-5">
          By submitting you confirm that all information is accurate and complete. This record will be saved in accordance with FAIS requirements and Holistic Risk Services record-keeping obligations.
        </p>
        <div className="flex gap-3.5 flex-wrap">
          <button
            onClick={onSubmit}
            disabled={isSubmitting}
            className="flex-1 px-6 py-3 rounded-lg font-body font-semibold text-[0.9rem] bg-hrs-orange text-white border-none transition-all hover:bg-hrs-orange-light disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Sending…" : "✓ Submit Commercial Advice Record"}
          </button>
        </div>
      </FormCard>

      <NavBar onPrev={onPrev} showNext={false} />
    </div>
  );
}