import { ClipboardList } from "lucide-react";

export default function InfoBanner() {
  return (
    <div className="bg-gradient-to-br from-hrs-blue to-hrs-blue2 rounded-lg p-5 sm:p-6 text-secondary mb-6 flex gap-4 items-start">
      <ClipboardList className="w-8 h-8 text-hrs-orange flex-shrink-0 mt-0.5" />
      <div>
        <h3 className="font-heading text-[1.1rem] text-hrs-orange mb-1">
          Advice Record – New Personal Insurance
        </h3>
        <p className="text-[0.82rem] opacity-85 leading-relaxed text-white/80">
          This record is created in terms of the Financial Advisory and Intermediary Services (FAIS) Act. Please complete all fields accurately. Holistic Risk Services (Pty) Ltd – FSP 28582
        </p>
      </div>
    </div>
  );
}