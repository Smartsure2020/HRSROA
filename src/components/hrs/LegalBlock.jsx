export default function LegalBlock({ title, children, className = "" }) {
  return (
    <div className={`bg-muted border border-hrs-border rounded-lg p-4 sm:p-5 text-[0.82rem] text-hrs-blue2 leading-relaxed ${className}`}>
      {title && (
        <h4 className="font-heading text-[1rem] text-hrs-blue mb-2">{title}</h4>
      )}
      {children}
    </div>
  );
}