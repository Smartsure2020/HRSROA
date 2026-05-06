import FormCard from "../../FormCard";
import SectionTitle from "../../SectionTitle";
import FormField from "../../FormField";
import TextInput from "../../TextInput";
import NavBar from "../../NavBar";
import { INSURERS } from "../../../../lib/hrsConstants";

function InsurerOption({ label, recommended, insKey, premKey, data, onChange }) {
  const set = (key) => (val) => onChange({ ...data, [key]: val });
  const setE = (key) => (e) => onChange({ ...data, [key]: e.target.value });
  return (
    <div className={`rounded-xl border-2 p-4 ${recommended ? 'border-hrs-orange bg-hrs-blue/5' : 'border-hrs-border'}`}>
      <div className="flex items-center gap-2 mb-3">
        {recommended && (
          <span className="bg-hrs-orange text-white text-[0.68rem] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
            Recommended
          </span>
        )}
        <span className={`text-[0.78rem] font-semibold uppercase tracking-wider ${recommended ? 'text-hrs-orange' : 'text-hrs-muted'}`}>
          {label}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label="Insurer">
          <select
            value={data[insKey]}
            onChange={setE(insKey)}
            className="w-full rounded-lg border border-hrs-border bg-secondary px-3 py-2 text-[0.85rem] text-hrs-blue outline-none focus:border-hrs-orange transition-colors"
          >
            <option value="">Select insurer...</option>
            {INSURERS.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </FormField>
        <FormField label="Monthly Premium (R)">
          <TextInput type="number" value={data[premKey]} onChange={set(premKey)} placeholder="0.00" />
        </FormField>
      </div>
    </div>
  );
}

export default function CommercialStepProductsAdvice({ data, onChange, onNext, onPrev }) {
  const set = (key) => (val) => onChange({ ...data, [key]: val });
  const setE = (key) => (e) => onChange({ ...data, [key]: e.target.value });

  const netPrem = parseFloat(data.prem2) || 0;
  const feeVal = parseFloat(data.brokerFeePercent) || 0;
  const feeAmount = data.brokerFeeType === 'fixed' ? feeVal : (netPrem * feeVal / 100);

  return (
    <div>
      <FormCard>
        <SectionTitle>Comparison of Products Considered</SectionTitle>
        <div className="flex flex-col gap-4 mb-6">
          <InsurerOption label="Option 1" insKey="ins0" premKey="prem0" data={data} onChange={onChange} />
          <InsurerOption label="Option 2" insKey="ins1" premKey="prem1" data={data} onChange={onChange} />
          <InsurerOption label="Option 3 – Recommended" recommended insKey="ins2" premKey="prem2" data={data} onChange={onChange} />
        </div>

        <SectionTitle>Recommended Product & Reason</SectionTitle>

        <FormField label="Recommended Insurer" required>
          <select
            value={data.recInsurer}
            onChange={setE('recInsurer')}
            className="w-full rounded-lg border border-hrs-border bg-secondary px-3 py-2.5 text-[0.88rem] text-hrs-blue outline-none focus:border-hrs-orange transition-colors"
          >
            <option value="">Select insurer...</option>
            {INSURERS.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </FormField>

        <FormField label="Reasons Why Suitable" required>
          <textarea
            value={data.recReasons}
            onChange={setE('recReasons')}
            rows={3}
            className="w-full rounded-lg border border-hrs-border bg-secondary px-3 py-2.5 text-[0.88rem] text-hrs-blue outline-none focus:border-hrs-orange transition-colors resize-none"
          />
        </FormField>

        <SectionTitle>Basis of Advice</SectionTitle>

        <FormField label="Information Considered">
          <textarea value={data.basisInfo} onChange={setE('basisInfo')} rows={3}
            className="w-full rounded-lg border border-hrs-border bg-secondary px-3 py-2.5 text-[0.88rem] text-hrs-blue outline-none focus:border-hrs-orange transition-colors resize-none" />
        </FormField>
        <FormField label="Recommendations Made">
          <textarea value={data.basisRec} onChange={setE('basisRec')} rows={3}
            className="w-full rounded-lg border border-hrs-border bg-secondary px-3 py-2.5 text-[0.88rem] text-hrs-blue outline-none focus:border-hrs-orange transition-colors resize-none" />
        </FormField>
        <FormField label="Client Decision">
          <textarea value={data.basisDecision} onChange={setE('basisDecision')} rows={2}
            className="w-full rounded-lg border border-hrs-border bg-secondary px-3 py-2.5 text-[0.88rem] text-hrs-blue outline-none focus:border-hrs-orange transition-colors resize-none" />
        </FormField>

        <SectionTitle>Commission & Fees</SectionTitle>
        <div className="bg-hrs-blue/5 border border-hrs-border rounded-lg p-4 mb-4 text-[0.82rem] text-hrs-blue">
          <p className="font-semibold mb-1">Standard Commission (as regulated by the Short-Term Insurance Act 53 of 1998):</p>
          <p className="text-hrs-muted">12.5% on Motor &nbsp;|&nbsp; 20% on Non-Motor</p>
        </div>

        <FormField label="Broker Fee (%)">
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg border border-hrs-border overflow-hidden">
              {['percent', 'fixed'].map(t => (
                <button key={t} type="button"
                  onClick={() => onChange({ ...data, brokerFeeType: t })}
                  className={`px-3 py-2 text-[0.78rem] font-semibold transition-colors ${data.brokerFeeType === t ? 'bg-hrs-blue text-white' : 'text-hrs-muted hover:bg-hrs-border/30'}`}>
                  {t === 'percent' ? '%' : 'R Fixed'}
                </button>
              ))}
            </div>
            <TextInput type="number" value={data.brokerFeePercent} onChange={set('brokerFeePercent')}
              placeholder={data.brokerFeeType === 'percent' ? 'e.g. 5' : 'e.g. 250.00'} />
          </div>
          {data.brokerFeePercent && (
            <p className="text-[0.75rem] text-hrs-muted mt-1">
              = R {feeAmount.toFixed(2)} on recommended premium
            </p>
          )}
        </FormField>

        <FormField label="Agreed Fees (if applicable)">
          <TextInput value={data.agreedFees} onChange={set('agreedFees')} placeholder="Describe any additional agreed fees" />
        </FormField>
      </FormCard>
      <NavBar onPrev={onPrev} onNext={onNext} />
    </div>
  );
}