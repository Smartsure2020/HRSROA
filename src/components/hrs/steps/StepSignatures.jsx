import { useRef, useState } from "react"; // useRef used inside SigSection
import FormCard from "../FormCard";
import SectionTitle from "../SectionTitle";
import FormField from "../FormField";
import TextInput from "../TextInput";
import LegalBlock from "../LegalBlock";
import SignatureCanvas from "../SignatureCanvas";
import NavBar from "../NavBar";
import { Upload, PenLine } from "lucide-react";

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

  return (
    <div>
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
            terms and disclosures in this advice record.{" "}
            <em>Holistic Risk Services (Pty) Ltd – An Authorised FSP No. 28582</em>
          </p>
        </LegalBlock>
      </FormCard>

      <NavBar onPrev={onPrev} onNext={onNext} nextLabel="Review & Submit" />
    </div>
  );
}