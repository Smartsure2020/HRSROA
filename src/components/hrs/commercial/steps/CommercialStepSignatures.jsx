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
import { HRS_COMPLIANCE_CONTENT } from "../../../../lib/hrsComplianceContent";
import { HRS_FSP_LINE } from "../../../../lib/hrsOrganisation";

const DECLARATION = HRS_COMPLIANCE_CONTENT.clientDeclaration.commercial;
const ELECTION_WARNING = HRS_COMPLIANCE_CONTENT.electionWarning.commercial;
const ADVISOR_DECLARATION = HRS_COMPLIANCE_CONTENT.advisorDeclaration.commercial;

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
              {ELECTION_WARNING.map((p, i) => <p key={i} className={i > 0 ? "mt-2" : ""}>{p}</p>)}
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
          title={DECLARATION.acceptTitle}
        >
          {DECLARATION.accept}
        </DeclarationOption>

        <DeclarationOption
          active={data.declarationChoice === "decline"}
          onClick={() => set("declarationChoice")("decline")}
          title={DECLARATION.declineTitle}
        >
          {DECLARATION.decline}
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
          <p className="text-[0.8rem]">{ADVISOR_DECLARATION.adviser}</p>
          <p className="text-[0.8rem] mt-3">
            {ADVISOR_DECLARATION.client} This also confirms the Statutory Disclosure acknowledged in the Principles &amp; Disclosures step.{" "}
            <em>{HRS_FSP_LINE}</em>
          </p>
        </LegalBlock>
      </FormCard>
      <NavBar onPrev={onPrev} onNext={onNext} nextLabel={nextLabel} isSubmitting={isSubmitting} />
    </div>
  );
}
