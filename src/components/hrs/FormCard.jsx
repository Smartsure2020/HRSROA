export default function FormCard({ children, className = "" }) {
  return (
    <div className={`bg-card rounded-lg shadow-[0_4px_24px_rgba(55,83,164,0.10)] p-6 sm:p-9 mb-6 ${className}`}>
      {children}
    </div>
  );
}