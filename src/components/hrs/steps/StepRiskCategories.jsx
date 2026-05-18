import FormCard from "../FormCard";
import SectionTitle from "../SectionTitle";
import FormField from "../FormField";
import TextInput from "../TextInput";
import NavBar from "../NavBar";
import { RISK_CATEGORIES } from "../../../lib/hrsConstants";

function RiskRow({ cat, state, onChange, shade }) {
  const setCover = (val) => onChange({ ...state, cover: state.cover === val ? null : val });
  const toggleSasria = () => onChange({ ...state, sasria: !state.sasria });

  return (
    <div className={`flex items-center gap-2 py-2 px-2 border-b border-hrs-border ${shade ? 'bg-hrs-blue/5' : ''}`}>
      <div className="flex-1 min-w-0">
        <p className="text-[0.78rem] font-semibold text-hrs-blue truncate">{cat.name}</p>
        {cat.note && <p className="text-[0.68rem] text-hrs-muted italic">{cat.note}</p>}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          type="button"
          onClick={() => setCover('yes')}
          className={`px-2.5 py-1 rounded text-[0.7rem] font-bold border transition-all ${state.cover === 'yes' ? 'bg-hrs-green text-white border-hrs-green' : 'border-hrs-border text-hrs-muted hover:border-hrs-green'}`}
        >
          YES
        </button>
        <button
          type="button"
          onClick={() => setCover('no')}
          className={`px-2.5 py-1 rounded text-[0.7rem] font-bold border transition-all ${state.cover === 'no' ? 'bg-hrs-red text-white border-hrs-red' : 'border-hrs-border text-hrs-muted hover:border-hrs-red'}`}
        >
          NO
        </button>
        {state.cover === 'yes' && cat.sasria && (
          <button
            type="button"
            onClick={toggleSasria}
            className={`px-2 py-1 rounded text-[0.65rem] font-bold border transition-all ${state.sasria ? 'bg-hrs-blue text-white border-hrs-blue' : 'border-hrs-border text-hrs-muted hover:border-hrs-blue'}`}
          >
            SASRIA
          </button>
        )}
      </div>
    </div>
  );
}

export default function StepRiskCategories({ data, onChange, onNext, onPrev }) {
  const set = (key) => (val) => onChange({ ...data, [key]: val });

  const updateRisk = (i, val) => {
    const updated = [...data.riskState];
    updated[i] = val;
    onChange({ ...data, riskState: updated });
  };

  const coveredCount = data.riskState?.filter(r => r.cover === 'yes').length || 0;
  const excludedCount = data.riskState?.filter(r => r.cover === 'no').length || 0;

  return (
    <div>
      <FormCard>
        <div className="flex items-center justify-between mb-4">
          <SectionTitle>Insured Risks & Risks Excluded from Policy</SectionTitle>
          <div className="flex gap-2 text-[0.72rem]">
            <span className="bg-hrs-green/10 text-hrs-green border border-hrs-green/30 px-2 py-0.5 rounded font-semibold">{coveredCount} Covered</span>
            <span className="bg-hrs-red/10 text-hrs-red border border-hrs-red/30 px-2 py-0.5 rounded font-semibold">{excludedCount} Excluded</span>
          </div>
        </div>
        <p className="text-hrs-muted text-[0.8rem] mb-4">
          Select YES or NO for each category. Toggle SASRIA for covered risks where applicable.
        </p>

        <div className="rounded-lg border border-hrs-border overflow-hidden">
          <div className="bg-hrs-blue px-3 py-2 flex justify-between">
            <span className="text-white text-[0.72rem] font-bold uppercase tracking-wider">Risk Category</span>
            <span className="text-white text-[0.72rem] font-bold uppercase tracking-wider">Cover / SASRIA</span>
          </div>
          {RISK_CATEGORIES.map((cat, i) => (
            <RiskRow
              key={cat.name}
              cat={cat}
              state={data.riskState?.[i] || { cover: null, sasria: false }}
              onChange={(val) => updateRisk(i, val)}
              shade={i % 2 === 1}
            />
          ))}
        </div>

        <div className="h-px bg-hrs-border my-6" />
        <FormField label="Additional Comments" required={false}>
          <TextInput type="textarea" value={data.additionalComments} onChange={set("additionalComments")} placeholder="Any additional notes..." rows={3} />
        </FormField>
      </FormCard>

      <NavBar onPrev={onPrev} onNext={onNext} nextLabel="Next: Principles & Disclosures" />
    </div>
  );
}
