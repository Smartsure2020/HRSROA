import { useRef, useState } from "react";
import FormCard from "../../FormCard";
import SectionTitle from "../../SectionTitle";
import FormField from "../../FormField";
import TextInput from "../../TextInput";
import LegalBlock from "../../LegalBlock";
import AckRow from "../../AckRow";
import SignatureCanvas from "../../SignatureCanvas";
import NavBar from "../../NavBar";
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
    if (drawRef.current)
      drawRef.current.getContext("2d").clearRect(0, 0, drawRef.current.width, drawRef.current.height);
  };

  return (
    <div className="mb-7">
      <label className="text-[0.8rem] font-semibold text-hrs-blue2 tracking-[0.03em] uppercase mb-2.5 block">
        {label}
      </label>
      <div className="flex gap-2 mb-3">
        <button type="button" onClick={() => setMode("draw")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border-[1.5px] text-[0.78rem] font-semibold transition-all ${mode === "draw" ? "bg-hrs-blue text-white border-hrs-blue" : "border-hrs-border text-hrs-blue2 hover:border-hrs-orange-light"}`}>
          <PenLine className="w-3.5 h-3.5" /> Draw
        </button>
        <button type="button" onClick={() => setMode("upload")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border-[1.5px] text-[0.78rem] font-semibold transition-all ${mode === "upload" ? "bg-hrs-blue text-white border-hrs-blue" : "border-hrs-border text-hrs-blue2 hover:border-hrs-orange-light"}`}>
          <Upload className="w-3.5 h-3.5" /> Upload Image
        </button>
      </div>

      {mode === "draw" && <SignatureCanvas canvasRef={drawRef} label="" onSave={handleDraw} />}
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
              <button type="button" onClick={clear}
                className="px-3 py-1.5 border-[1.5px] border-hrs-border rounded-md text-[0.8rem] text-hrs-red hover:border-hrs-red transition-colors">
                Remove
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CommercialStepSignatures({ data, onChange, onNext, onPrev, isSubmitting, nextLabel }) {
  const set = (key) => (val) => onChange({ ...data, [key]: val });
  const electedAlternative = data.electionDiffers || data.electionNotFollow || data.electionLimitedInfo;

  return (
    <div>
      <FormCard>
        <SectionTitle>Client Declaration</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-5">Election to conclude a transaction that differs from the recommendation</p>

        <AckRow checked={data.electionDiffers} onChange={set("electionDiffers")}>
          We elect to conclude a transaction that differs from the advisor's recommendation.
        </AckRow>
        <AckRow checked={data.electionNotFollow} onChange={set("electionNotFollow")}>
          We elect not to follow the advice furnished by the advisor.
        </AckRow>
        <AckRow checked={data.electionLimitedInfo} onChange={set("electionLimitedInfo")}>
          We elect to receive more limited information or advice than the advisor is able to provide.
        </AckRow>

        {electedAlternative && (
          <>
            <LegalBlock className="mt-4">
              <p>Where an analysis is to be performed in any of the circumstances referred to above, the client has been advised accordingly that:</p>
              <p className="mt-2">1. There may be limitations on the appropriateness of the advice provided in light of such circumstances.</p>
              <p className="mt-2">2. The client should take particular care to consider on its own whether the advice is appropriate considering the business's objectives, financial situation and particular needs, particularly any aspects of such objective, situation or needs that were not considered in light of the aforementioned circumstances.</p>
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
          title="We hereby accept the advice and recommendations provided as set out above."
        >
          We are aware that the advice and recommendations provided are limited to the business's short-term insurance
          (commercial lines) portfolio only, and that a comprehensive analysis of the business's financial needs was not
          undertaken. Due to the fact that a comprehensive analysis was not undertaken, there may be limitations concerning
          the appropriateness of the advice, and we must therefore carefully consider whether the product selected is
          appropriate considering the business's circumstances and needs. Where any election above was made, we confirm
          that the advisor has alerted us to the clear existence of any risk as a result of such election. We understand the
          dangers of being underinsured and that excesses under specific policies may be aggregated in certain
          circumstances — should our circumstances change in any way that may require a review of our existing cover, we
          will inform the advisor. We have read the policy documents and the attached policy schedule, and note in
          particular the special conditions and applicable excesses. The advisor explained the material terms and
          conditions of the policy, including any excess payment terms, conditions and exclusions, or circumstances where
          claims will not be paid. We did not sign the application form while any part of it was incomplete, and take full
          responsibility for all information provided, whether provided by us or on our behalf. The advisor provided quotes
          from the insurer which were discussed and attached to this document. We understand that for a new placement, the
          product selected constitutes a new placement of short-term insurance cover; for a renewal, it constitutes a
          renewal of our existing cover; and for a replacement, it constitutes a replacement of our existing short-term
          insurance cover.
        </DeclarationOption>

        <DeclarationOption
          active={data.declarationChoice === "decline"}
          onClick={() => set("declarationChoice")("decline")}
          title="We elect NOT to follow the advice and recommendations set out above."
        >
          We confirm that the advisor has alerted us to the risks of proceeding against the advice and recommendations
          given, and that we have chosen to proceed on this basis of our own accord.
        </DeclarationOption>
      </FormCard>

      <FormCard>
        <SectionTitle>Signatures</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-7">
          Signatures are optional. Client may sign by drawing or uploading; broker may draw or upload a saved signature.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6">
          <FormField label="Signature Date">
            <TextInput type="date" value={data.sigDate} onChange={set("sigDate")} />
          </FormField>
        </div>

        <SigSection label="Client / Authorised Representative Signature" sigKey="clientSig" data={data} onChange={onChange} />
        <SigSection label="Advisor / Broker Signature" sigKey="advisorSig" data={data} onChange={onChange} />

        <LegalBlock className="mt-6">
          <p className="text-[0.8rem]">
            <strong>Declaration by the Adviser:</strong> I declare that the advice record is an accurate and complete record of the recommendations and advice that I provided the client with, based upon the information provided by the client.
          </p>
          <p className="text-[0.8rem] mt-3">
            <strong>Declaration by the Client:</strong> I acknowledge that as a client, no product provider or FSP may request or induce me to waive any right or benefit conferred on me in terms of the FAIS Act. I confirm having been duly advised and fully understand the course of action I am about to undertake, including the Client Declaration above.{" "}
            <em>Holistic Risk Services (Pty) Ltd – An Authorised FSP No. 28582</em>
          </p>
        </LegalBlock>
      </FormCard>
      <NavBar onPrev={onPrev} onNext={onNext} nextLabel={nextLabel || "Submit & Send"} isSubmitting={isSubmitting} />
    </div>
  );
}