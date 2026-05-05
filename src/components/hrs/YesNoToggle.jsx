import { Check, X } from "lucide-react";

export default function YesNoToggle({ value, onChange, className = "" }) {
  return (
    <div className={`flex gap-2.5 ${className}`}>
      <button
        type="button"
        onClick={() => onChange("yes")}
        className={`
          flex-1 border-[1.5px] rounded-[7px] py-2.5 px-2 text-center text-[0.85rem] font-medium transition-all select-none flex items-center justify-center gap-1.5
          ${value === "yes"
            ? "bg-emerald-50 border-hrs-green text-hrs-green font-semibold"
            : "border-hrs-border text-hrs-muted bg-secondary hover:border-hrs-orange-light hover:text-hrs-blue"
          }
        `}
      >
        <Check className="w-3.5 h-3.5" /> Yes
      </button>
      <button
        type="button"
        onClick={() => onChange("no")}
        className={`
          flex-1 border-[1.5px] rounded-[7px] py-2.5 px-2 text-center text-[0.85rem] font-medium transition-all select-none flex items-center justify-center gap-1.5
          ${value === "no"
            ? "bg-red-50 border-hrs-red text-hrs-red font-semibold"
            : "border-hrs-border text-hrs-muted bg-secondary hover:border-hrs-orange-light hover:text-hrs-blue"
          }
        `}
      >
        <X className="w-3.5 h-3.5" /> No
      </button>
    </div>
  );
}