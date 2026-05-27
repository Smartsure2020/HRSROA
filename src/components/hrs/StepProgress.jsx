import { STEPS } from "../../lib/hrsConstants";
import { Check } from "lucide-react";

export default function StepProgress({ currentStep, onGoTo, steps = STEPS }) {
  return (
    <div className="bg-card border-b border-hrs-border overflow-x-auto">
      <div className="flex min-w-[700px] px-4 sm:px-8">
        {steps.map((step, i) => {
          const isActive = i === currentStep;
          const isDone = i < currentStep;
          return (
            <button
              key={i}
              onClick={() => i <= currentStep && onGoTo(i)}
              className={`
                flex-1 flex items-center gap-2 py-3.5 px-2.5 border-b-[3px] transition-colors text-[0.78rem] font-medium whitespace-nowrap select-none
                ${isActive ? "border-hrs-orange text-hrs-blue" : "border-transparent"}
                ${isDone ? "text-hrs-green cursor-pointer" : ""}
                ${!isActive && !isDone ? "text-hrs-muted cursor-default" : ""}
                ${isActive ? "cursor-default" : ""}
                ${isDone ? "hover:text-hrs-blue2" : ""}
              `}
            >
              <span
                className={`
                  w-[22px] h-[22px] rounded-full flex items-center justify-center text-[0.7rem] font-semibold flex-shrink-0 transition-colors
                  ${isActive ? "bg-hrs-orange text-white" : ""}
                  ${isDone ? "bg-hrs-green text-white" : ""}
                  ${!isActive && !isDone ? "bg-muted text-hrs-muted" : ""}
                `}
              >
                {isDone ? <Check className="w-3 h-3" /> : i + 1}
              </span>
              <span className="hidden lg:inline">{step.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}