import FormCard from "../FormCard";

export default function StepSuccess({ onRestart }) {
  return (
    <FormCard className="text-center py-14 px-8 sm:px-10">
      <div className="text-6xl mb-4">✅</div>
      <h1 className="font-heading text-[2rem] text-hrs-blue mb-2">Advice Record Submitted</h1>
      <p className="text-hrs-muted text-[0.9rem] max-w-[380px] mx-auto mb-7 leading-relaxed">
        The advice record has been successfully completed. A reference copy should be retained by both client and advisor in terms of FAIS record-keeping requirements.
      </p>

      <div className="bg-emerald-50/60 rounded-lg p-4 sm:p-5 mb-5 text-left">
        <div className="text-[0.75rem] uppercase tracking-[0.1em] text-hrs-muted mb-2">
          Holistic Risk Services Contact Details
        </div>
        <div className="text-[0.82rem] text-hrs-blue2 leading-[1.7]">
          16 Monte Carlo Crescent, Kyalami Business Park, Midrand, 1684<br />
          P O Box 321 Cramerview 2060 · Tel: 010 447-9800<br />
          www.hrsinsurance.co.za<br />
          <strong>Holistic Risk Services (Pty) Ltd · FSP 28582</strong>
        </div>
      </div>

      <button
        onClick={onRestart}
        className="px-7 py-3 rounded-lg font-body font-semibold text-[0.9rem] bg-hrs-blue text-white border-none transition-all hover:bg-hrs-blue2 hover:shadow-[0_4px_16px_rgba(55,83,164,0.25)]"
      >
        Start New Record
      </button>
    </FormCard>
  );
}