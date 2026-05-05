export default function AppHeader() {
  return (
    <header className="bg-card border-b-[3px] border-hrs-orange px-4 sm:px-8 py-3 flex items-center justify-between sticky top-0 z-50 shadow-[0_2px_16px_rgba(55,83,164,0.12)]">
      <div className="flex items-center gap-3">
        <img
          src="https://hrsinsurance.co.za/wp-content/uploads/2020/07/cropped-HRS_Logo-1-118x52.png"
          alt="Holistic Risk Services"
          className="h-11 w-auto block"
        />
        <span className="text-hrs-muted text-[0.72rem] tracking-[0.12em] uppercase hidden sm:block">
          FSP 28582
        </span>
      </div>
      <span className="text-hrs-blue text-[0.8rem] tracking-[0.08em] uppercase opacity-70 hidden sm:block">
        Advice Record – New Personal Insurance
      </span>
    </header>
  );
}