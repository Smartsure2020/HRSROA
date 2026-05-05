export default function TextInput({ type = "text", value, onChange, placeholder, min, max, rows, className = "" }) {
  const baseClasses = "border-[1.5px] border-hrs-border rounded-[7px] py-2.5 px-3.5 font-body text-[0.9rem] text-foreground bg-secondary outline-none transition-all w-full focus:border-hrs-orange focus:shadow-[0_0_0_3px_rgba(241,90,40,0.12)] focus:bg-card";

  if (type === "textarea") {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows || 3}
        className={`${baseClasses} resize-y min-h-[90px] ${className}`}
      />
    );
  }

  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      min={min}
      max={max}
      className={`${baseClasses} ${className}`}
    />
  );
}