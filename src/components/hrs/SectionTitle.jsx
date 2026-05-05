export default function SectionTitle({ children, size = "lg", className = "" }) {
  const sizeClass = size === "lg" ? "text-[1.3rem]" : "text-[1rem]";
  return (
    <h2 className={`font-heading ${sizeClass} text-hrs-blue mb-1 ${className}`}>
      {children}
    </h2>
  );
}