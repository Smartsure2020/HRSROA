import { getCoveredSasriaClasses, SASRIA_CLASS_LABELS } from '../../lib/sasriaApplicability';

export default function SasriaSelection({ categories, data, onChange }) {
  const available = getCoveredSasriaClasses(categories, data.riskState);
  const selected = Array.isArray(data.sasriaIncludedClasses) ? data.sasriaIncludedClasses : [];

  if (available.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-hrs-border bg-secondary px-3 py-2.5 text-[0.76rem] text-hrs-muted">
        SASRIA applicability will appear after an applicable risk category is marked as covered.
      </div>
    );
  }

  const toggle = (sasriaClass) => {
    const next = selected.includes(sasriaClass)
      ? selected.filter((value) => value !== sasriaClass)
      : [...selected, sasriaClass];
    onChange({ ...data, sasriaIncludedClasses: next });
  };

  return (
    <div className="mt-4 rounded-lg border border-hrs-border bg-secondary p-3">
      <p className="text-[0.78rem] font-semibold text-hrs-blue2">SASRIA in the recommended quotation / policy</p>
      <p className="text-[0.72rem] text-hrs-muted mt-1 mb-3">
        Applicability does not mean cover was purchased. Select only the classes confirmed as included in the recommendation.
      </p>
      <div className="flex flex-wrap gap-2">
        {available.map((sasriaClass) => (
          <button
            key={sasriaClass}
            type="button"
            onClick={() => toggle(sasriaClass)}
            className={`px-3 py-1.5 rounded-full text-[0.72rem] font-semibold border transition-all ${
              selected.includes(sasriaClass)
                ? 'bg-hrs-blue text-white border-hrs-blue'
                : 'bg-white border-hrs-border text-hrs-muted hover:border-hrs-blue'
            }`}
          >
            {SASRIA_CLASS_LABELS[sasriaClass] || sasriaClass}
          </button>
        ))}
      </div>
    </div>
  );
}
