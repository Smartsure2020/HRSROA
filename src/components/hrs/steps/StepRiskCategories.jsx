import FormCard from "../FormCard";
import SectionTitle from "../SectionTitle";
import FormField from "../FormField";
import TextInput from "../TextInput";
import NavBar from "../NavBar";
import { RISK_CATEGORIES } from "../../../lib/hrsConstants";

function RiskToggle({ value, onSelect }) {
  return (
    <div className="flex gap-1.5">
      <button
        type="button"
        onClick={() => onSelect("yes")}
        className={`px-3 py-1 rounded-md border-[1.5px] text-[0.78rem] font-semibold transition-all ${
          value === "yes"
            ? "bg-emerald-50 border-hrs-green text-hrs-green"
            : "border-hrs-border bg-secondary text-hrs-muted hover:border-hrs-orange-light hover:text-hrs-blue"
        }`}
      >
        YES
      </button>
      <button
        type="button"
        onClick={() => onSelect("no")}
        className={`px-3 py-1 rounded-md border-[1.5px] text-[0.78rem] font-semibold transition-all ${
          value === "no"
            ? "bg-red-50 border-hrs-red text-hrs-red"
            : "border-hrs-border bg-secondary text-hrs-muted hover:border-hrs-orange-light hover:text-hrs-blue"
        }`}
      >
        NO
      </button>
    </div>
  );
}

export default function StepRiskCategories({ data, onChange, onNext, onPrev }) {
  const set = (key) => (val) => onChange({ ...data, [key]: val });

  const setRisk = (index, field, val) => {
    const newState = [...data.riskState];
    newState[index] = { ...newState[index], [field]: val };
    onChange({ ...data, riskState: newState });
  };

  return (
    <div>
      <FormCard>
        <SectionTitle>Insured Risks & Risks Excluded from Policy</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-7">For each category, select YES (cover taken) or NO (excluded). Tick SASRIA where applicable.</p>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[0.85rem]">
            <thead>
              <tr className="bg-hrs-blue text-white">
                <th className="py-2.5 px-3 text-left font-semibold text-[0.78rem] tracking-[0.05em] w-[32%]">Category of Risk</th>
                <th className="py-2.5 px-3 text-left font-semibold text-[0.78rem] tracking-[0.05em] w-[18%]">Cover Taken</th>
                <th className="py-2.5 px-3 text-center font-semibold text-[0.78rem] tracking-[0.05em] w-[12%]">SASRIA</th>
                <th className="py-2.5 px-3 text-left font-semibold text-[0.78rem] tracking-[0.05em]">Notes</th>
              </tr>
            </thead>
            <tbody>
              {RISK_CATEGORIES.map((cat, i) => (
                <tr key={i} className="border-b border-hrs-border hover:bg-secondary/60 transition-colors">
                  <td className="py-2.5 px-3 font-medium text-hrs-blue2">{cat.name}</td>
                  <td className="py-2.5 px-3">
                    <RiskToggle value={data.riskState[i].cover} onSelect={(val) => setRisk(i, "cover", val)} />
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {cat.sasria ? (
                      <input
                        type="checkbox"
                        checked={data.riskState[i].sasria}
                        onChange={(e) => setRisk(i, "sasria", e.target.checked)}
                        className="w-[18px] h-[18px] accent-hrs-blue2 cursor-pointer"
                      />
                    ) : (
                      <span className="text-hrs-muted">–</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-[0.75rem] text-hrs-muted italic">{cat.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="h-px bg-hrs-border my-6" />
        <FormField label="Additional Comments">
          <TextInput type="textarea" value={data.additionalComments} onChange={set("additionalComments")} placeholder="Any additional notes..." rows={3} />
        </FormField>
      </FormCard>

      <NavBar onPrev={onPrev} onNext={onNext} nextLabel="Next: Principles & Disclosures" />
    </div>
  );
}