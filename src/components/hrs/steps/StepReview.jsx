import { Check, AlertTriangle } from "lucide-react";
import FormCard from "../FormCard";
import SectionTitle from "../SectionTitle";
import NavBar from "../NavBar";
import { RISK_CATEGORIES } from "../../../lib/hrsConstants";

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
        {checked ? <><Check className="w-3.5 h-3.5" /> Acknowledged</> : <><AlertTriangle className="w-3.5 h-3.5" /> Not ticked</>}
      </span>
    </div>
  );
}

function yn(val) {
  if (val === "yes") return "Yes";
  if (val === "no") return "No";
  return "Not answered";
}

export default function StepReview({ data, onPrev, onSubmit }) {
  return (
    <div>
      <FormCard>
        <SectionTitle>Review Your Submission</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-7">Please verify all details before submitting the advice record.</p>

        <ReviewSection title="Client Details">
          <ReviewRow label="Broker / Advisor" value={data.brokerName} />
          <ReviewRow label="Title" value={data.title} />
          <ReviewRow label="Initial(s)" value={data.initials} />
          <ReviewRow label="First Name" value={data.firstName} />
          <ReviewRow label="Surname" value={data.surname} />
          <ReviewRow label="ID / Passport" value={data.idNumber} />
          <ReviewRow label="Email" value={data.email} />
          <ReviewRow label="Cell" value={data.cell} />
          <ReviewRow label="Occupation" value={data.occupation} />
          <ReviewRow label="Marital Status" value={data.maritalStatus} />
          <ReviewRow label="Street" value={[data.streetNumber, data.streetName].filter(Boolean).join(' ')} />
          {data.complexName ? <ReviewRow label="Complex / Building" value={data.complexName} /> : null}
          <ReviewRow label="Suburb" value={data.suburb} />
          <ReviewRow label="City" value={data.city} />
          <ReviewRow label="Province" value={data.province} />
          <ReviewRow label="Postal Code" value={data.postalCode} />
        </ReviewSection>

        <ReviewSection title="Recommended Product">
          <ReviewRow label="Insurer" value={data.recInsurer} />
          <ReviewRow label="Option 1" value={`${data.ins0 || "—"} — R${data.prem0 || "—"}`} />
          <ReviewRow label="Option 2" value={`${data.ins1 || "—"} — R${data.prem1 || "—"}`} />
          <ReviewRow label="Option 3 (Rec)" value={`${data.ins2 || "—"} — R${data.prem2 || "—"}`} />
          <ReviewRow label="Broker Fee" value={(() => {
            if (!data.brokerFeePercent) return "—";
            const net = parseFloat(data.prem2) || 0;
            const fee = parseFloat(data.brokerFeePercent) || 0;
            if (data.brokerFeeType === 'fixed') return `R ${fee.toFixed(2)}`;
            return `${fee}% (R ${(net * fee / 100).toFixed(2)})`;
          })()} />
        </ReviewSection>

        <ReviewSection title="Risk Categories">
          {RISK_CATEGORIES.map((cat, i) => {
            const s = data.riskState[i];
            let cv = "—";
            if (s.cover === "yes") cv = "✓ YES";
            if (s.cover === "no") cv = "✗ NO";
            if (s.sasria && s.cover === "yes") cv += " · SASRIA ✓";
            return <ReviewRow key={i} label={cat.name} value={cv} />;
          })}
        </ReviewSection>

        <ReviewSection title="Banking & Debit">
          <ReviewRow label="Bank" value={data.bankName} />
          <ReviewRow label="Account Type" value={data.accountType} />
          <ReviewRow label="Deduction Date" value={data.deductionDate} />
          <ReviewRow label="Amount" value={data.deductionAmount ? `R ${data.deductionAmount}` : "—"} />
          <ReviewRow label="Inception" value={data.inceptionDate} />
          <ReviewRow label="Insurer" value={data.doInsurer} />
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
            className="flex-1 px-6 py-3 rounded-lg font-body font-semibold text-[0.9rem] bg-hrs-orange text-white border-none transition-all hover:bg-hrs-orange-light"
          >
            ✓ Submit Advice Record
          </button>

        </div>
      </FormCard>

      <NavBar onPrev={onPrev} showNext={false} />
    </div>
  );
}