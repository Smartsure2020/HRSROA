import FormCard from "../../FormCard";
import SectionTitle from "../../SectionTitle";
import FormField from "../../FormField";
import TextInput from "../../TextInput";
import YesNoToggle from "../../YesNoToggle";
import NavBar from "../../NavBar";

export default function CommercialStepInsuranceHistory({ data, onChange, onNext, onPrev }) {
  const set = (key) => (val) => onChange({ ...data, [key]: val });

  return (
    <div>
      <FormCard>
        <SectionTitle>Insurance History</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-7">Summary of the business's previous short-term insurance experience</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <p className="text-[0.8rem] font-semibold text-hrs-blue2 tracking-[0.03em] uppercase mb-2">
              Uninterrupted Short-Term Insurance
            </p>
            <YesNoToggle value={data.uninterruptedInsurance} onChange={set('uninterruptedInsurance')} />
          </div>
          <FormField label="Number of Years Insured">
            <TextInput type="number" value={data.yearsInsured} onChange={set('yearsInsured')} placeholder="e.g. 5" min="0" />
          </FormField>
        </div>

        <div className="h-px bg-hrs-border my-6" />

        <p className="text-[0.8rem] font-semibold text-hrs-blue2 tracking-[0.03em] uppercase mb-2">
          Have special terms been imposed, or has cover ever been refused / cancelled?
        </p>
        <YesNoToggle value={data.specialTerms} onChange={set('specialTerms')} />

        {data.specialTerms === 'yes' && (
          <div className="mt-4">
            <FormField label="Reason for Refusal / Cancellation / Special Terms">
              <TextInput type="textarea" value={data.cancelReasonText} onChange={set('cancelReasonText')} placeholder="Please provide details..." />
            </FormField>
          </div>
        )}

        <div className="h-px bg-hrs-border my-6" />

        <SectionTitle size="sm">Business Needs & Objectives</SectionTitle>
        <div className="mt-3">
          <FormField label="Summary of the Business Owner's Specific Needs">
            <TextInput type="textarea" value={data.clientNeeds} onChange={set('clientNeeds')} rows={3} />
          </FormField>
        </div>
      </FormCard>

      <NavBar onPrev={onPrev} onNext={onNext} nextLabel="Next: Products & Advice" />
    </div>
  );
}
