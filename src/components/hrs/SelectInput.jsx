export default function SelectInput({ value, onChange, options, placeholder = "-- Select --", className = "" }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`
        border-[1.5px] border-hrs-border rounded-[7px] py-2.5 px-3.5 font-body text-[0.9rem] text-foreground bg-secondary outline-none transition-all w-full cursor-pointer
        appearance-none bg-no-repeat bg-[right_13px_center] pr-9
        focus:border-hrs-orange focus:shadow-[0_0_0_3px_rgba(241,90,40,0.12)] focus:bg-card
        ${className}
      `}
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23a7a9ac' stroke-width='1.8' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  );
}