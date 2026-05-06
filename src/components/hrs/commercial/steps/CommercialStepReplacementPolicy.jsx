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

export default function CommercialStepReplacementPolicy({ data, onChange, onNext, onPrev }) {
  const setE = (key) => (e) => onChange({ ...data, [key]: e.target.value });

  return (
    <div>
      <FormCard>
        <SectionTitle>Replacement of an Existing Policy</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-5">
          Complete this section only if applicable. If not replacing an existing policy, you may skip to the next step.
        </p>

        <FormField label="Was the client advised to replace an existing policy?">
          <YesNo value={data.replacingExisting} onChange={v => onChange({ ...data, replacingExisting: v })} />
        </FormField>

        {data.replacingExisting === 'yes' && (
          <>
            <FormField label="Conversion of policy purely on a 'Like for Like' basis? (i.e. only differs in premium and / or excesses)">
              <YesNo value={data.likeForLike} onChange={v => onChange({ ...data, likeForLike: v })} />
            </FormField>

            {data.likeForLike === 'no' && (
              <>
                <FormField label="Main difference between products (full comparison to be provided to the client)">
                  <textarea
                    value={data.mainDifferences}
                    onChange={setE('mainDifferences')}
                    rows={3}
                    className="w-full rounded-lg border border-hrs-border bg-secondary px-3 py-2.5 text-[0.88rem] text-hrs-blue outline-none focus:border-hrs-orange transition-colors resize-none"
                    placeholder="Describe the main differences..."
                  />
                </FormField>
                <FormField label="Any exclusions and / or uninsured risks applicable to new insurance">
                  <textarea
                    value={data.exclusions}
                    onChange={setE('exclusions')}
                    rows={3}
                    className="w-full rounded-lg border border-hrs-border bg-secondary px-3 py-2.5 text-[0.88rem] text-hrs-blue outline-none focus:border-hrs-orange transition-colors resize-none"
                    placeholder="List any exclusions..."
                  />
                </FormField>
              </>
            )}

            <FormField label="Main reason for replacement">
              <textarea
                value={data.replacementReason}
                onChange={setE('replacementReason')}
                rows={3}
                className="w-full rounded-lg border border-hrs-border bg-secondary px-3 py-2.5 text-[0.88rem] text-hrs-blue outline-none focus:border-hrs-orange transition-colors resize-none"
                placeholder="Explain the main reason for replacing the policy..."
              />
            </FormField>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5">
              <FormField label="Current Insurer">
                <TextInput value={data.currentInsurer} onChange={setE('currentInsurer')} placeholder="Current insurer name" />
              </FormField>
              <FormField label="New Insurer">
                <TextInput value={data.newInsurer} onChange={setE('newInsurer')} placeholder="New insurer name" />
              </FormField>
            </div>
          </>
        )}

        {data.replacingExisting !== 'yes' && (
          <div className="bg-hrs-blue/5 border border-hrs-border rounded-lg p-4 text-[0.82rem] text-hrs-muted italic">
            No existing policy being replaced — this section is not applicable.
          </div>
        )}
      </FormCard>
      <NavBar onPrev={onPrev} onNext={onNext} />
    </div>
  );
}