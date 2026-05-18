import FormCard from "../../FormCard";
import SectionTitle from "../../SectionTitle";
import FormField from "../../FormField";
import TextInput from "../../TextInput";
import NavBar from "../../NavBar";

function ProductCard({ number, label, insValue, premValue, onInsChange, onPremChange, recommended }) {
  return (
    <div className={`border-[1.5px] rounded-lg p-5 relative ${recommended ? "border-hrs-orange bg-amber-50/40" : "border-hrs-border bg-secondary"}`}>
      {recommended && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-hrs-orange text-white text-[0.68rem] font-bold px-3 py-0.5 rounded-full tracking-[0.08em] uppercase">
          Recommended
        </span>
      )}
      <h4 className="text-[0.78rem] uppercase tracking-[0.08em] text-hrs-muted mb-3.5">{label}</h4>
      <FormField label="Insurer / Product" className="mb-2.5">
        <TextInput
          value={insValue}
          onChange={onInsChange}
          placeholder={`e.g. ${number === 3 ? "Stratsys / Smartsure" : number === 1 ? "Santam Commercial" : "Outsurance Business"}`}
        />
      </FormField>
      <FormField label="Monthly Premium (R)">
        <TextInput
          type="number"
          value={premValue}
          onChange={onPremChange}
          placeholder={`e.g. ${number === 3 ? "4500" : number === 1 ? "5200" : "4800"}`}
        />
      </FormField>
    </div>
  );
}

export default function CommercialStepProductsAdvice({ data, onChange, onNext, onPrev }) {
  const set = (key) => (val) => onChange({ ...data, [key]: val });
  const setE = (key) => (e) => onChange({ ...data, [key]: e.target.value });
  const feeType = data.brokerFeeType || 'percent';

  const netPrem = parseFloat(data.prem2) || 0;
  const feeVal = parseFloat(data.brokerFeePercent) || 0;
  const feeAmount = feeType === 'fixed' ? feeVal : (netPrem * feeVal / 100);

  return (
    <div>
      <FormCard>
        <SectionTitle>Comparison of Products Considered</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-7">List up to 3 insurers/products considered and their premiums</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ProductCard number={1} label="Option 1" insValue={data.ins0} premValue={data.prem0}
            onInsChange={set("ins0")} onPremChange={set("prem0")} />
          <ProductCard number={2} label="Option 2" insValue={data.ins1} premValue={data.prem1}
            onInsChange={set("ins1")} onPremChange={set("prem1")} />
          <ProductCard number={3} label="Option 3 (Recommended)" insValue={data.ins2} premValue={data.prem2}
            onInsChange={set("ins2")} onPremChange={set("prem2")} recommended />
        </div>
      </FormCard>

      <FormCard>
        <SectionTitle>Recommended Product & Reason</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-7">Explain why the recommended product is the most suitable for this client</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <FormField label="Recommended Insurer" required>
            <TextInput value={data.recInsurer} onChange={set("recInsurer")} placeholder="e.g. Stratsys / Holistic Risk Services" />
          </FormField>
          <FormField label="Broker Fee">
            <div className="flex gap-0">
              <button
                type="button"
                onClick={() => onChange({ ...data, brokerFeeType: 'percent' })}
                className={`px-3 py-2 text-[0.78rem] font-semibold border-[1.5px] rounded-l-lg transition-all ${
                  feeType === 'percent' ? 'bg-hrs-blue text-white border-hrs-blue' : 'border-hrs-border text-hrs-blue2 hover:border-hrs-orange-light'
                }`}
              >%</button>
              <button
                type="button"
                onClick={() => onChange({ ...data, brokerFeeType: 'fixed' })}
                className={`px-3 py-2 text-[0.78rem] font-semibold border-[1.5px] border-l-0 rounded-r-lg transition-all ${
                  feeType === 'fixed' ? 'bg-hrs-blue text-white border-hrs-blue' : 'border-hrs-border text-hrs-blue2 hover:border-hrs-orange-light'
                }`}
              >R</button>
              <TextInput
                type="number"
                value={data.brokerFeePercent}
                onChange={set('brokerFeePercent')}
                placeholder={feeType === 'percent' ? 'e.g. 5' : 'e.g. 350'}
                className="ml-2 flex-1"
                min="0"
              />
            </div>
            {data.brokerFeePercent && (
              <p className="text-[0.75rem] text-hrs-muted mt-1">
                = R {feeAmount.toFixed(2)} on recommended premium
              </p>
            )}
          </FormField>
        </div>

        <div className="mt-4">
          <FormField label="Reasons why this product is suitable" required>
            <TextInput type="textarea" value={data.recReasons} onChange={set("recReasons")}
              placeholder="e.g. Competitive premium, comprehensive commercial cover including SASRIA..." rows={3} />
          </FormField>
        </div>

        <div className="h-px bg-hrs-border my-6" />

        <SectionTitle size="sm">Basis of Advice</SectionTitle>
        <div className="mt-3 space-y-4">
          <FormField label="Information considered about the business's needs & risk profile">
            <TextInput type="textarea" value={data.basisInfo} onChange={set("basisInfo")} rows={2} />
          </FormField>
          <FormField label="Recommendations made">
            <TextInput type="textarea" value={data.basisRec} onChange={set("basisRec")} rows={2} />
          </FormField>
          <FormField label="Client's decision">
            <TextInput type="textarea" value={data.basisDecision} onChange={set("basisDecision")} rows={2} />
          </FormField>
        </div>

        <div className="h-px bg-hrs-border my-6" />

        <SectionTitle size="sm">Commission & Fees</SectionTitle>
        <div className="bg-hrs-blue/5 border border-hrs-border rounded-lg p-4 mt-3">
          <p className="text-[0.82rem] font-semibold text-hrs-blue mb-1">Standard Commission (regulated by the Short-Term Insurance Act 53 of 1998):</p>
          <p className="text-[0.82rem] text-hrs-muted">12.5% on Motor &nbsp;|&nbsp; 20% on Non-Motor</p>
        </div>
        <div className="mt-4">
          <FormField label="Agreed Fees (if applicable)">
            <TextInput value={data.agreedFees} onChange={set("agreedFees")} placeholder="Describe any additional agreed fees" />
          </FormField>
        </div>
      </FormCard>

      <NavBar onPrev={onPrev} onNext={onNext} nextLabel="Next: Replacement Policy" />
    </div>
  );
}