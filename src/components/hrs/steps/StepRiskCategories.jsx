import FormCard from "../FormCard";
import SectionTitle from "../SectionTitle";
import FormField from "../FormField";
import TextInput from "../TextInput";
import SelectInput from "../SelectInput";
import YesNoToggle from "../YesNoToggle";
import NavBar from "../NavBar";
import { RISK_CATEGORIES, PERILS, VALUE_TYPES } from "../../../lib/hrsConstants";
import { Flag } from "lucide-react";

function TogglePill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-[0.75rem] font-semibold border-[1.5px] transition-all ${
        active ? "bg-hrs-blue text-white border-hrs-blue" : "border-hrs-border text-hrs-muted hover:border-hrs-orange-light"
      }`}
    >
      {children}
    </button>
  );
}

function RiskRow({ cat, state, onChange, shade }) {
  const setCover = (val) => onChange({ ...state, cover: state.cover === val ? null : val });
  const toggleSasria = () => onChange({ ...state, sasria: !state.sasria });
  const toggleFlag = () => onChange({ ...state, flagged: !state.flagged });

  return (
    <div className={`flex items-center gap-2 py-2 px-2 border-b border-hrs-border transition-colors ${
      state.flagged ? 'bg-amber-50 border-l-4 border-l-amber-400' : shade ? 'bg-hrs-blue/5' : ''
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className={`text-[0.78rem] font-semibold truncate ${state.flagged ? 'text-amber-700' : 'text-hrs-blue'}`}>
            {cat.name}
          </p>
          {state.flagged && (
            <span className="text-[0.6rem] font-bold bg-amber-400 text-amber-900 px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0">
              Important
            </span>
          )}
        </div>
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
        <button
          type="button"
          onClick={toggleFlag}
          title="Flag as important for client"
          className={`p-1 rounded border transition-all ${state.flagged ? 'bg-amber-400 border-amber-400 text-amber-900' : 'border-hrs-border text-hrs-muted hover:border-amber-400 hover:text-amber-500'}`}
        >
          <Flag className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

export default function StepRiskCategories({ data, onChange, onNext, onPrev, nextLabel }) {
  const set = (key) => (val) => onChange({ ...data, [key]: val });

  const updateRisk = (i, val) => {
    const updated = [...data.riskState];
    updated[i] = val;
    onChange({ ...data, riskState: updated });
  };

  const coveredCount = data.riskState?.filter(r => r.cover === 'yes').length || 0;
  const excludedCount = data.riskState?.filter(r => r.cover === 'no').length || 0;
  const flaggedCount = data.riskState?.filter(r => r.flagged).length || 0;

  const togglePeril = (peril) => {
    const current = data.perilsSelected || [];
    const next = current.includes(peril) ? current.filter((p) => p !== peril) : [...current, peril];
    set("perilsSelected")(next);
  };

  return (
    <div>
      <FormCard>
        <SectionTitle>Needs Analysis</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-5">Cover, perils and value basis on which this advice is based</p>

        <FormField label="Perils to be Insured">
          <div className="flex flex-wrap gap-2 mt-1">
            {PERILS.map((peril) => (
              <TogglePill key={peril} active={data.perilsSelected?.includes(peril)} onClick={() => togglePeril(peril)}>
                {peril}
              </TogglePill>
            ))}
          </div>
          {data.perilsSelected?.includes("Other") && (
            <div className="mt-3">
              <TextInput value={data.perilsOther} onChange={set("perilsOther")} placeholder="Specify other peril(s)" />
            </div>
          )}
        </FormField>

        <div className="h-px bg-hrs-border my-5" />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <FormField label="Value to be Insured" required>
            <SelectInput value={data.valueToBeInsured} onChange={set("valueToBeInsured")} options={VALUE_TYPES} placeholder="-- Select --" />
          </FormField>
          <FormField label="Voluntary Excess">
            <SelectInput value={data.voluntaryExcess} onChange={set("voluntaryExcess")} options={["High", "Low", "n/a"]} placeholder="-- Select --" />
          </FormField>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-5">
          <div>
            <p className="text-[0.8rem] font-semibold text-hrs-blue2 tracking-[0.03em] uppercase mb-2">Compulsory Excess</p>
            <YesNoToggle value={data.compulsoryExcess} onChange={set("compulsoryExcess")} />
          </div>
          <div>
            <p className="text-[0.8rem] font-semibold text-hrs-blue2 tracking-[0.03em] uppercase mb-2">No Claims Bonus</p>
            <YesNoToggle value={data.noClaimsBonus} onChange={set("noClaimsBonus")} />
          </div>
        </div>

        <div className="h-px bg-hrs-border my-5" />

        <FormField label="Risks / Items to be Included or Excluded (Risk Profile)">
          <TextInput type="textarea" value={data.riskProfileNotes} onChange={set("riskProfileNotes")} placeholder="Any specific risks or items to include or exclude..." rows={3} />
        </FormField>
      </FormCard>

      <FormCard>
        <div className="flex items-center justify-between mb-4">
          <SectionTitle>Insured Risks & Risks Excluded from Policy</SectionTitle>
          <div className="flex gap-2 text-[0.72rem]">
            <span className="bg-hrs-green/10 text-hrs-green border border-hrs-green/30 px-2 py-0.5 rounded font-semibold">{coveredCount} Covered</span>
            <span className="bg-hrs-red/10 text-hrs-red border border-hrs-red/30 px-2 py-0.5 rounded font-semibold">{excludedCount} Excluded</span>
            {flaggedCount > 0 && (
              <span className="bg-amber-100 text-amber-700 border border-amber-300 px-2 py-0.5 rounded font-semibold">{flaggedCount} Flagged</span>
            )}
          </div>
        </div>
        <p className="text-hrs-muted text-[0.8rem] mb-4">
          Select YES or NO for each category. Toggle SASRIA where applicable. Use the{' '}
          <Flag className="w-3 h-3 inline text-amber-500" /> flag to highlight important items for the client in the PDF.
        </p>

        <div className="rounded-lg border border-hrs-border overflow-hidden">
          <div className="bg-hrs-blue px-3 py-2 flex justify-between">
            <span className="text-white text-[0.72rem] font-bold uppercase tracking-wider">Risk Category</span>
            <span className="text-white text-[0.72rem] font-bold uppercase tracking-wider">Cover / SASRIA / Flag</span>
          </div>
          {RISK_CATEGORIES.map((cat, i) => (
            <RiskRow
              key={cat.name}
              cat={cat}
              state={data.riskState?.[i] || { cover: null, sasria: false, flagged: false }}
              onChange={(val) => updateRisk(i, val)}
              shade={i % 2 === 1}
            />
          ))}
        </div>

        {flaggedCount > 0 && (
          <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-[0.75rem] font-semibold text-amber-700 mb-1">
              Flagged as Important ({flaggedCount}):
            </p>
            <p className="text-[0.72rem] text-amber-600">
              {data.riskState
                ?.map((s, i) => s.flagged ? RISK_CATEGORIES[i]?.name : null)
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p className="text-[0.7rem] text-amber-500 mt-1">These will be highlighted in yellow on the PDF for the client's attention.</p>
          </div>
        )}

        <div className="h-px bg-hrs-border my-6" />
        <FormField label="Additional Comments" required={false}>
          <TextInput type="textarea" value={data.additionalComments} onChange={set("additionalComments")} placeholder="Any additional notes..." rows={3} />
        </FormField>
      </FormCard>

      <NavBar onPrev={onPrev} onNext={onNext} nextLabel={nextLabel} />
    </div>
  );
}
