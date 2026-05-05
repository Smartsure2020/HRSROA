import { ChevronLeft, ChevronRight } from "lucide-react";

export default function NavBar({ onPrev, onNext, nextLabel, showPrev = true, showNext = true }) {
  return (
    <div className="flex justify-between items-center mt-8">
      {showPrev ? (
        <button
          onClick={onPrev}
          className="flex items-center gap-1.5 px-6 py-3 rounded-lg font-body font-semibold text-[0.9rem] border-[1.5px] border-hrs-border text-hrs-blue2 bg-transparent transition-all hover:border-hrs-blue2 hover:bg-muted"
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
      ) : <div />}
      {showNext ? (
        <button
          onClick={onNext}
          className="flex items-center gap-1.5 px-6 py-3 rounded-lg font-body font-semibold text-[0.9rem] bg-hrs-blue text-white border-none transition-all hover:bg-hrs-blue2 hover:shadow-[0_4px_16px_rgba(55,83,164,0.25)]"
        >
          {nextLabel || "Next"} <ChevronRight className="w-4 h-4" />
        </button>
      ) : <div />}
    </div>
  );
}