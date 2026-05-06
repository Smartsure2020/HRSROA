import FormCard from "../../FormCard";
import SectionTitle from "../../SectionTitle";
import FormField from "../../FormField";
import TextInput from "../../TextInput";
import NavBar from "../../NavBar";

function YesNo({ value, onChange }) {
  return (
    <div className="flex gap-3 mt-1">
      {['yes', 'no'].map(v => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(value === v ? null : v)}
          className={`px-5 py-2 rounded-lg border text-[0.82rem] font-semibold transition-all ${
            value === v
              ? v === 'yes' ? 'bg-hrs-green text-white border-hrs-green' : 'bg-hrs-red text-white border-hrs-red'
              : 'border-hrs-border text-hrs-muted hover:border-hrs-orange'
          }`}
        >
          {v.charAt(0).toUpperCase() + v.slice(1)}
        </button>
      ))}
    </div>
  );
}

export default function CommercialStepInsuranceHistory({ data, onChange, onNext, onPrev }) {
  const setE = (key) => (e) => onChange({ ...data, [key]: e.target.value });

  return (
    <div>
      <FormCard>
        <SectionTitle>Insurance History</SectionTitle>

        <FormField label="Uninterrupted Short Term Insurance?" required>
          <YesNo value={data.uninterruptedInsurance} onChange={v => onChange({ ...data, uninterruptedInsurance: v })} />
        </FormField>

        <FormField label="Number of years insured">
          <TextInput type="number" value={data.yearsInsured} onChange={setE('yearsInsured')} placeholder="e.g. 5" />
        </FormField>

        <FormField label="Have special terms and conditions been imposed, or has cover ever been refused / cancelled for the applicant or any co-insured?" required>
          <YesNo value={data.specialTerms} onChange={v => onChange({ ...data, specialTerms: v })} />
        </FormField>

        {data.specialTerms === 'yes' && (
          <FormField label="Cancellation / Refusal Reason">
            <textarea
              value={data.cancelReasonText}
              onChange={setE('cancelReasonText')}
              rows={3}
              placeholder="Provide reason..."
              className="w-full rounded-lg border border-hrs-border bg-secondary px-3 py-2.5 text-[0.88rem] text-hrs-blue outline-none focus:border-hrs-orange transition-colors resize-none"
            />
          </FormField>
        )}

        <FormField label="Summary of the Business Owner's Specific Needs and Objectives" required>
          <textarea
            value={data.clientNeeds}
            onChange={setE('clientNeeds')}
            rows={4}
            className="w-full rounded-lg border border-hrs-border bg-secondary px-3 py-2.5 text-[0.88rem] text-hrs-blue outline-none focus:border-hrs-orange transition-colors resize-none"
          />
        </FormField>
      </FormCard>
      <NavBar onPrev={onPrev} onNext={onNext} />
    </div>
  );
}