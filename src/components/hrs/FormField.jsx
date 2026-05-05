export default function FormField({ label, required, children, className = "" }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label className="text-[0.8rem] font-semibold text-hrs-blue2 tracking-[0.03em] uppercase">
          {label}
          {required && <span className="text-hrs-orange ml-0.5">*</span>}
        </label>
      )}
      {children}
    </div>
  );
}