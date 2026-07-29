import { useRef, useState } from "react"; // useRef used inside SigSection
import FormCard from "../FormCard";
import SectionTitle from "../SectionTitle";
import FormField from "../FormField";
import TextInput from "../TextInput";
import LegalBlock from "../LegalBlock";
import AckRow from "../AckRow";
import SignatureCanvas from "../SignatureCanvas";
import NavBar from "../NavBar";
import { Upload, PenLine, Check } from "lucide-react";

function DeclarationOption({ active, onClick, title, children }) {
  return (
    <label
      onClick={onClick}
      className={`flex items-start gap-3 p-3.5 sm:p-4 border-[1.5px] rounded-lg cursor-pointer transition-all mb-2.5 ${
        active ? "border-hrs-blue bg-hrs-blue/5" : "border-hrs-border hover:border-hrs-orange-light"
      }`}
    >
      <span className={`mt-0.5 flex-shrink-0 w-[18px] h-[18px] rounded-full border-[1.5px] flex items-center justify-center ${active ? "bg-hrs-blue border-hrs-blue" : "border-hrs-border"}`}>
        {active && <Check className="w-3 h-3 text-white" />}
      </span>
      <span className="text-[0.83rem] text-hrs-blue2 leading-relaxed">
        <strong className="block text-hrs-blue mb-0.5">{title}</strong>
        {children}
      </span>
    </label>
  );
}

function SigSection({ label, sigKey, data, onChange }) {
  const [mode, setMode] = useState("draw");
  const drawRef = useRef(null);

  const handleDraw = (b64) => onChange({ ...data, [sigKey]: b64 || null });

  const handleUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onChange({ ...data, [sigKey]: ev.target.result });
    reader.readAsDataURL(file);
  };

  const clear = () => {
    onChange({ ...data, [sigKey]: null });
    if (drawRef.current) {
      drawRef.current.getContext("2d").clearRect(0, 0, drawRef.current.width, drawRef.current.height);
    }
  };

  return (
    <div className="mb-7">
      <label className="text-[0.8rem] font-semibold text-hrs-blue2 tracking-[0.03em] uppercase mb-2.5 block">
        {label}
      </label>

      <div className="flex gap-2 mb-3">
        <button
          type="button"
          onClick={() => setMode("draw")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border-[1.5px] text-[0.78rem] font-semibold transition-all ${
            mode === "draw"
              ? "bg-hrs-blue text-white border-hrs-blue"
              : "border-hrs-border text-hrs-blue2 hover:border-hrs-orange-light"
          }`}
        >
          <PenLine className="w-3.5 h-3.5" /> Draw
        </button>
        <button
          type="button"
          onClick={() => setMode("upload")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border-[1.5px] text-[0.78rem] font-semibold transition-all ${
            mode === "upload"
              ? "bg-hrs-blue text-white border-hrs-blue"
              : "border-hrs-border text-hrs-blue2 hover:border-hrs-orange-light"
          }`}
        >
          <Upload className="w-3.5 h-3.5" /> Upload Image
        </button>
      </div>

      {mode === "draw" && (
        <SignatureCanvas canvasRef={drawRef} label="" onSave={handleDraw} />
      )}

      {mode === "upload" && (
        <div>
          <label className="flex flex-col items-center justify-center w-full h-[100px] border-2 border-dashed border-hrs-border rounded-lg bg-secondary cursor-pointer hover:border-hrs-orange-light transition-colors">
            <Upload className="w-5 h-5 text-hrs-muted mb-2" />
            <span className="text-[0.8rem] text-hrs-muted">Click to upload signature image (PNG or JPG)</span>
            <input type="file" accept="image/png,image/jpeg" onChange={handleUpload} className="hidden" />
          </label>
          {data[sigKey] && (
            <div className="mt-3 flex items-center gap-4">
              <img src={data[sigKey]} alt="signature" className="h-16 border border-hrs-border rounded bg-white p-1" />
              <button
                type="button"
                onClick={clear}
                className="px-3 py-1.5 border-[1.5px] border-hrs-border rounded-md text-[0.8rem] text-hrs-red hover:border-hrs-red transition-colors"
              >
                Remove
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function StepSignatures({ data, onChange, onNext, onPrev }) {
  const set = (key) => (val) => onChange({ ...data, [key]: val });
  const electedAlternative = data.electionDiffers || data.electionNotFollow || data.electionLimitedInfo;

  return (
    <div>
      <FormCard>
        <SectionTitle>Client Declaration</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-5">Election to conclude a transaction that differs from the recommendation</p>

        <AckRow checked={data.electionDiffers} onChange={set("electionDiffers")}>
          I elect to conclude a transaction that differs from the advisor's recommendation.
        </AckRow>
        <AckRow checked={data.electionNotFollow} onChange={set("electionNotFollow")}>
          I elect not to follow the advice furnished by the advisor.
        </AckRow>
        <AckRow checked={data.electionLimitedInfo} onChange={set("electionLimitedInfo")}>
          I elect to receive more limited information or advice than the advisor is able to provide.
        </AckRow>

        {electedAlternative && (
          <>
            <LegalBlock className="mt-4">
              <p>Where an analysis is to be performed in any of the circumstances referred to above, the client has been advised accordingly that:</p>
              <p className="mt-2">1. There may be limitations on the appropriateness of the advice provided in light of such circumstances.</p>
              <p className="mt-2">2. The client should take particular care to consider on his/her own whether the advice is appropriate considering the client's objectives, financial situation and particular needs, particularly any aspects of such objective, situation or needs that were not considered in light of the aforementioned circumstances.</p>
            </LegalBlock>
            <div className="mt-4 max-w-xs">
              <FormField label="Client Initials" required>
                <TextInput value={data.electionInitials} onChange={set("electionInitials")} placeholder="e.g. J.S." />
              </FormField>
            </div>
          </>
        )}

        <div className="h-px bg-hrs-border my-6" />

        <DeclarationOption
          active={data.declarationChoice === "accept"}
          onClick={() => set("declarationChoice")("accept")}
          title="I hereby accept the advice and recommendations provided to me as set out above."
        >
          I am aware that the advice and recommendations provided in terms of my request and instruction are limited to my
          short-term insurance (personal lines) portfolio only, and that a comprehensive analysis of all my financial needs
          was not undertaken. Due to the fact that a comprehensive analysis was not undertaken, there may be limitations
          concerning the appropriateness of the advice, and I must therefore carefully consider whether the product selected
          is appropriate considering my circumstances and needs. Where I have made any of the elections above, I confirm
          that the advisor has alerted me to the clear existence of any risk as a result of such election, and that I have
          been advised to take particular care to consider whether the products selected (if any) are appropriate to my
          needs, objectives and circumstances. I understand the dangers of being underinsured and that excesses under
          specific policies may be aggregated in certain circumstances — should my circumstances change in any way that
          may require a review of my existing cover, I will inform the advisor. I have read the policy documents and the
          attached policy schedule, and note in particular the special conditions and applicable excesses. The advisor
          explained to me the material terms and conditions of the policy, including any excess payment terms, conditions
          and exclusions, or circumstances where claims will not be paid. I did not sign the application form while any
          part of it was incomplete, and I take full responsibility for all information provided in the application form,
          whether provided by myself or on my behalf. The advisor provided quotes from the insurer which were discussed
          and attached to this document. I understand that for a new placement, the product selected constitutes a new
          placement of short-term insurance cover; for a renewal, it constitutes a renewal of my existing cover; and for a
          replacement, it constitutes a replacement of my existing short-term insurance cover.
        </DeclarationOption>

        <DeclarationOption
          active={data.declarationChoice === "decline"}
          onClick={() => set("declarationChoice")("decline")}
          title="I elect NOT to follow the advice and recommendations set out above."
        >
          I confirm that the advisor has alerted me to the risks of proceeding against the advice and recommendations
          given, and that I have chosen to proceed on this basis of my own accord.
        </DeclarationOption>
      </FormCard>

      <FormCard>
        <SectionTitle>Signatures</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-7">
          Signatures are optional. Client may sign by drawing; broker may draw or upload a saved signature.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6">
          <FormField label="Signature Date">
            <TextInput type="date" value={data.sigDate} onChange={set("sigDate")} />
          </FormField>
        </div>

        <SigSection label="Client Signature" sigKey="clientSig" data={data} onChange={onChange} />
        <SigSection label="Advisor / Broker Signature" sigKey="advisorSig" data={data} onChange={onChange} />

        <LegalBlock className="mt-6">
          <p className="text-[0.8rem]">
            By signing, the client confirms all information is true and accurate, and that they have read and accepted all
            terms and disclosures in this advice record, including the Client Declaration above.{" "}
            <em>Holistic Risk Services (Pty) Ltd – An Authorised FSP No. 28582</em>
          </p>
        </LegalBlock>
      </FormCard>

      <NavBar onPrev={onPrev} onNext={onNext} nextLabel="Review & Submit" />
    </div>
  );
}