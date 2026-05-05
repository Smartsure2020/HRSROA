export default function AckRow({ checked, onChange, children }) {
  return (
    <label className="flex items-start gap-3 p-3.5 sm:p-4 border-[1.5px] border-hrs-border rounded-lg cursor-pointer transition-all hover:border-hrs-orange-light hover:bg-amber-50/30 mt-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-[18px] h-[18px] mt-0.5 flex-shrink-0 accent-hrs-blue cursor-pointer"
      />
      <span className="text-[0.83rem] text-hrs-blue2 leading-relaxed">{children}</span>
    </label>
  );
}