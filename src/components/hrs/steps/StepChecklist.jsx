import { useState, useRef } from "react";
import { CheckCircle, PenLine, Trash2, FileDown, FilePlus, Upload } from "lucide-react";
import FormCard from "../FormCard";
import SignatureCanvas from "../SignatureCanvas";
import { generatePDF, generateCombinedPDF } from "../../../lib/hrsPdfGenerator";
import { MANAGER_NAME } from "../../../lib/hrsConstants";

function InfoRow({ label, value }) {
  return (
    <div className="flex border-b border-hrs-border py-1.5 gap-3">
      <span className="text-[0.75rem] font-semibold text-hrs-blue2 min-w-[140px] flex-shrink-0">{label}</span>
      <span className="text-[0.82rem] text-hrs-blue flex-1">{value || ""}</span>
    </div>
  );
}

function SectionBar({ title, right }) {
  return (
    <div className="flex items-center justify-between bg-hrs-blue text-white px-3 py-1.5 mt-4 mb-0 rounded-t-md">
      <span className="text-[0.72rem] font-bold uppercase tracking-[0.1em]">{title}</span>
      {right && <span className="text-[0.68rem] opacity-80">{right}</span>}
    </div>
  );
}

function YesNoRow({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-hrs-border gap-3">
      <span className="text-[0.78rem] text-hrs-blue flex-1">{label}</span>
      <div className="flex gap-1.5 flex-shrink-0">
        <button type="button" onClick={() => onChange(value === 'yes' ? null : 'yes')}
          className={`px-3 py-0.5 rounded border text-[0.72rem] font-semibold transition-all ${value === 'yes' ? 'bg-hrs-green text-white border-hrs-green' : 'border-hrs-border text-hrs-muted hover:border-hrs-green'}`}>
          Yes
        </button>
        <button type="button" onClick={() => onChange(value === 'no' ? null : 'no')}
          className={`px-3 py-0.5 rounded border text-[0.72rem] font-semibold transition-all ${value === 'no' ? 'bg-hrs-red text-white border-hrs-red' : 'border-hrs-border text-hrs-muted hover:border-hrs-red'}`}>
          No
        </button>
      </div>
    </div>
  );
}

function CheckItem({ label, checked, onChange }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-hrs-border cursor-pointer" onClick={() => onChange(!checked)}>
      <div className={`w-4 h-4 rounded border-[1.5px] flex-shrink-0 flex items-center justify-center transition-colors ${checked ? "bg-hrs-green border-hrs-green" : "border-hrs-border bg-white"}`}>
        {checked && <span className="text-white text-[0.6rem] font-bold">✓</span>}
      </div>
      <span className="text-[0.75rem] text-hrs-blue">{label}</span>
    </div>
  );
}

function SigBox({ label, sigKey, sigs, onChange }) {
  const drawRef = useRef(null);
  const [mode, setMode] = useState("draw");

  const handleDraw = (b64) => onChange({ ...sigs, [sigKey]: b64 || null });
  const handleUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onChange({ ...sigs, [sigKey]: ev.target.result });
    reader.readAsDataURL(file);
  };
  const handleClear = () => {
    onChange({ ...sigs, [sigKey]: null });
    if (drawRef.current)
      drawRef.current.getContext('2d').clearRect(0, 0, drawRef.current.width, drawRef.current.height);
  };

  return (
    <div className="border border-hrs-border rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[0.75rem] font-semibold text-hrs-blue2 uppercase tracking-wider">{label}</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => setMode("draw")}
            className={`flex items-center gap-1 text-[0.72rem] px-2 py-0.5 rounded border transition-colors ${mode === "draw" ? "bg-hrs-blue text-white border-hrs-blue" : "border-hrs-border text-hrs-blue2 hover:border-hrs-orange"}`}>
            <PenLine className="w-3 h-3" /> Draw
          </button>
          <button type="button" onClick={() => setMode("upload")}
            className={`flex items-center gap-1 text-[0.72rem] px-2 py-0.5 rounded border transition-colors ${mode === "upload" ? "bg-hrs-blue text-white border-hrs-blue" : "border-hrs-border text-hrs-blue2 hover:border-hrs-orange"}`}>
            <Upload className="w-3 h-3" /> Upload
          </button>
          {sigs[sigKey] && (
            <button type="button" onClick={handleClear}
              className="text-[0.72rem] text-hrs-red border border-red-200 px-2 py-0.5 rounded hover:bg-red-50 transition-colors">
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      {mode === "draw" && <SignatureCanvas canvasRef={drawRef} label="" onSave={handleDraw} />}
      {mode === "upload" && (
        <div>
          <label className="flex flex-col items-center justify-center w-full h-[80px] border-2 border-dashed border-hrs-border rounded-lg bg-secondary cursor-pointer hover:border-hrs-orange transition-colors">
            <Upload className="w-4 h-4 text-hrs-muted mb-1" />
            <span className="text-[0.72rem] text-hrs-muted">Click to upload (PNG or JPG)</span>
            <input type="file" accept="image/png,image/jpeg" onChange={handleUpload} className="hidden" />
          </label>
          {sigs[sigKey] && (
            <img src={sigs[sigKey]} alt={label} className="mt-2 h-14 border border-hrs-border rounded bg-white p-1 w-full object-contain" />
          )}
        </div>
      )}
      {!sigs[sigKey] && mode === "draw" && <div className="h-10 border-b border-dotted border-hrs-border" />}
    </div>
  );
}

const COMPLIANCE_DOCS = [
  "PROPOSAL", "BROKER APPOINTMENT", "DEBIT ORDER AUTHORITY",
  "ROA | RECORD OF ADVICE", "CURRENT POLICY SCHEDULE",
  "PROOF OF PREVIOUS INSURANCE", "SEC 13 CERTIFICATE AND DISCLOSURE",
  "CLIENT CONSENT TO CHARGE BROKER FEE",
];

const ADDITIONAL_DOCS = [
  "CELLPHONES | MAKE | MODEL | IMEI NO'S", "ELECTRONICS | MAKE | MODEL | SERIAL NO'S",
  "VEHICLE REGISTRATION CERTIFICATES", "VEHICLE REGISTRATION - ENGINE AND VIN NO'S",
  "PROOF OF TRACKING DEVICE INSTALLATIONS", "PROOF OF PURCHASES ON HIGH VALUE ITEMS",
  "VALUATION CERTIFICATES ON HIGH VALUE JEWELLERY",
];

const COMMISSION_ROWS = ["Brokerage (HRS)", "Broker", "Referror", "Other"];

export default function StepChecklist({ data, onRestart }) {
  const fullName = [data.title, data.firstName, data.surname].filter(Boolean).join(' ') || '-';
  const address = [data.streetNumber, data.streetName, data.complexName, data.suburb, data.city, data.province, data.postalCode].filter(Boolean).join(', ') || '-';

  const [smartsure, setSmartsure] = useState(null);
  const [directInsurer, setDirectInsurer] = useState(null);
  const [complianceDocs, setComplianceDocs] = useState({});
  const [additionalDocs, setAdditionalDocs] = useState({});
  const [comments, setComments] = useState('');
  const [trackDates, setTrackDates] = useState({ docs: '', submitted: '', email: '' });
  const [sigs, setSigs] = useState({ broker: null, manager: null });
  const [businessType, setBusinessType] = useState('Personal');
  const [acctExec, setAcctExec] = useState(data.brokerName || MANAGER_NAME);
  const [downloading, setDownloading] = useState(null);
  const [combinedDownloaded, setCombinedDownloaded] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);

  // Editable commission fields
  const [commissions, setCommissions] = useState({
    "Brokerage (HRS)": "",
    "Broker": "",
    "Referror": "",
    "Other": "",
  });

  const netPrem = parseFloat(data.prem2) || 0;
  const feeVal = parseFloat(data.brokerFeePercent) || 0;
  const feeAmount = data.brokerFeeType === 'fixed' ? feeVal : (netPrem * feeVal / 100);
  const totalPrem = netPrem + feeAmount;
  const feeDisplayStr = data.brokerFeePercent
    ? (data.brokerFeeType === 'fixed' ? `R ${feeVal.toFixed(2)}` : `R ${feeAmount.toFixed(2)} (${feeVal}%)`)
    : '';

  const getChecklistState = () => ({
    smartsure, directInsurer, complianceDocs, additionalDocs,
    comments, trackDates, businessType, acctExec, commissions,
  });

  const handleDownloadROA = async () => {
    setDownloading('roa');
    await generatePDF(data);
    setDownloading(null);
  };

  const handleDownloadCombined = async () => {
    setDownloading('combined');
    await generateCombinedPDF(data, getChecklistState());
    setDownloading(null);
    setCombinedDownloaded(true);
  };

  const handleRestartClick = () => {
    if (!combinedDownloaded) {
      setConfirmRestart(true);
    } else {
      onRestart();
    }
  };

  return (
    <div>
      <div className="bg-gradient-to-br from-hrs-blue to-hrs-blue2 text-white rounded-xl p-5 mb-6 flex items-start gap-4">
        <CheckCircle className="w-9 h-9 text-hrs-orange flex-shrink-0 mt-0.5" />
        <div>
          <h2 className="font-heading text-[1.2rem] text-hrs-orange mb-1">Advice Record Submitted</h2>
          <p className="text-[0.82rem] opacity-80 leading-relaxed">
            Record for <strong>{fullName}</strong> submitted. Download the PDF below and submit it according to your firm's process.
          </p>
        </div>
      </div>

      <FormCard>
        <div className="flex items-center justify-between mb-4 pb-3 border-b-2 border-hrs-orange">
          <img src="/assets/hrs-logo.png" alt="HRS" className="h-10" />
          <div className="text-right">
            <h2 className="font-heading text-[1.1rem] text-hrs-blue">HRS - NEW BUSINESS CHECKLIST</h2>
            <p className="text-[0.7rem] text-hrs-muted uppercase tracking-widest">FSP No. 28582</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          <InfoRow label="Insured" value={fullName} />
          <InfoRow label="Co Reg No" value="" />
          <InfoRow label="ID Number" value={data.idNumber} />
          <InfoRow label="Vat No" value="" />
          <InfoRow label="Contact Person" value={fullName} />
          <div />
          <div className="sm:col-span-2"><InfoRow label="Risk Address" value={address} /></div>
          <InfoRow label="Email Address" value={data.email} />
          <div />
          <InfoRow label="Phone (Work)" value={data.workNumber} />
          <InfoRow label="Phone (Cell)" value={data.cell} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 mt-2">
          <InfoRow label="Insurer" value={data.recInsurer} />
          <InfoRow label="Inception Date" value={data.inceptionDate} />
          <div className="flex border-b border-hrs-border py-1.5 gap-3 items-center">
            <span className="text-[0.75rem] font-semibold text-hrs-blue2 min-w-[140px] flex-shrink-0">Business Type</span>
            <select value={businessType} onChange={(e) => setBusinessType(e.target.value)}
              className="text-[0.82rem] text-hrs-blue bg-secondary border border-hrs-border rounded px-2 py-0.5 outline-none focus:border-hrs-orange">
              <option value="Personal">Personal</option>
              <option value="Business">Business</option>
            </select>
          </div>
          <div className="flex border-b border-hrs-border py-1.5 gap-3 items-center">
            <span className="text-[0.75rem] font-semibold text-hrs-blue2 min-w-[140px] flex-shrink-0">Accounts Executive</span>
            <input type="text" value={acctExec} onChange={(e) => setAcctExec(e.target.value)}
              className="text-[0.82rem] text-hrs-blue bg-secondary border border-hrs-border rounded px-2 py-0.5 outline-none focus:border-hrs-orange flex-1" />
          </div>
        </div>

        <div className="mt-2 border border-hrs-border rounded-b-md p-2 border-t-0">
          <YesNoRow label="Smartsure Facility" value={smartsure} onChange={setSmartsure} />
          <YesNoRow label="Direct Insurer" value={directInsurer} onChange={setDirectInsurer} />
        </div>

        {/* Premium Summary + Commission — editable */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 mt-2">
          <div>
            <SectionBar title="Premium Summary" />
            <div className="border border-hrs-border border-t-0 p-2 space-y-0.5">
              {[
                { label: "NET Premium", value: netPrem ? `R ${netPrem.toFixed(2)}` : "" },
                { label: "SASRIA", value: "" },
                { label: "VAPS", value: "" },
                { label: "HRS Fee", value: feeDisplayStr },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between py-1 border-b border-hrs-border">
                  <span className="text-[0.75rem] text-hrs-muted">{label}</span>
                  <span className="text-[0.78rem] font-medium text-hrs-blue">{value}</span>
                </div>
              ))}
              <div className="flex justify-between py-1.5 bg-hrs-blue/10 px-2 rounded mt-1">
                <span className="text-[0.78rem] font-bold text-hrs-blue">Total Premium</span>
                <span className="text-[0.82rem] font-bold text-hrs-orange">{totalPrem ? `R ${totalPrem.toFixed(2)}` : ""}</span>
              </div>
            </div>
          </div>
          <div>
            <SectionBar title="HRS - Commission Allocation" />
            <div className="border border-hrs-border border-t-0 p-2 space-y-0.5">
              {COMMISSION_ROWS.map((label) => (
                <div key={label} className="flex items-center justify-between py-1 border-b border-hrs-border">
                  <span className="text-[0.75rem] text-hrs-muted">{label}</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={commissions[label]}
                      onChange={(e) => setCommissions(prev => ({ ...prev, [label]: e.target.value }))}
                      className="text-[0.72rem] w-12 text-right border-b border-hrs-border bg-transparent outline-none focus:border-hrs-orange text-hrs-blue"
                      placeholder="0"
                    />
                    <span className="text-[0.72rem] text-hrs-muted">%</span>
                  </div>
                </div>
              ))}
              <div className="flex justify-between py-1.5 bg-hrs-blue/10 px-2 rounded mt-1">
                <span className="text-[0.78rem] font-bold text-hrs-blue">Monthly</span>
                <span className="text-[0.78rem] font-bold text-hrs-blue">{totalPrem ? `R ${totalPrem.toFixed(2)}` : ""}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Compliance Docs + Additional Confirmation */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 mt-2">
          <div>
            <SectionBar title="Compliance Documentation" />
            <div className="border border-hrs-border border-t-0 p-2">
              <p className="text-[0.68rem] text-hrs-muted mb-2 italic">Completed, Signed, Submitted and Available</p>
              {COMPLIANCE_DOCS.map((item) => (
                <CheckItem key={item} label={item} checked={!!complianceDocs[item]}
                  onChange={(v) => setComplianceDocs(prev => ({ ...prev, [item]: v }))} />
              ))}
            </div>
          </div>
          <div>
            <SectionBar title="Additional Confirmation" />
            <div className="border border-hrs-border border-t-0 p-2">
              <p className="text-[0.68rem] text-hrs-muted mb-2 italic">Verification of Specific Details</p>
              {ADDITIONAL_DOCS.map((item) => (
                <CheckItem key={item} label={item} checked={!!additionalDocs[item]}
                  onChange={(v) => setAdditionalDocs(prev => ({ ...prev, [item]: v }))} />
              ))}
            </div>
          </div>
        </div>

        <SectionBar title="Comments" />
        <div className="border border-hrs-border border-t-0 p-3">
          <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3}
            placeholder="Add comments here..."
            className="w-full text-[0.82rem] text-hrs-blue bg-transparent border-none outline-none resize-none placeholder:text-hrs-muted" />
        </div>

        <SectionBar title="Tracking and Admin" right="Dates" />
        <div className="border border-hrs-border border-t-0 p-2">
          {[
            { label: "Full documentation handed in to upload", key: "docs" },
            { label: "Documentation submitted to insurer / UMA", key: "submitted" },
            { label: "Email to commissions@hrsinsurance.co.za", key: "email" },
          ].map(({ label, key }) => (
            <div key={key} className="flex items-center gap-3 py-1.5 border-b border-hrs-border">
              <span className="text-[0.78rem] text-hrs-blue flex-1">{label}</span>
              <input type="date" value={trackDates[key] || ''}
                onChange={(e) => setTrackDates(prev => ({ ...prev, [key]: e.target.value }))}
                className="text-[0.75rem] text-hrs-blue border border-hrs-border rounded px-2 py-0.5 bg-secondary outline-none focus:border-hrs-orange" />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5 pt-4 border-t-2 border-hrs-border">
          <SigBox label="HRS Broker" sigKey="broker" sigs={sigs} onChange={setSigs} />
          <SigBox label="Manager" sigKey="manager" sigs={sigs} onChange={setSigs} />
        </div>
        <div className="grid grid-cols-2 gap-4 mt-2 text-[0.73rem]">
          <div className="text-center text-hrs-blue font-medium">{data.brokerName || ""}</div>
          <div className="text-center text-hrs-blue font-medium">{MANAGER_NAME}</div>
        </div>
      </FormCard>

      <FormCard className="bg-gradient-to-br from-hrs-blue to-hrs-blue2 text-white">
        <div className="font-heading text-[1.05rem] text-hrs-orange mb-3">Download Documents</div>
        <div className="flex gap-3 flex-wrap mb-3">
          <button onClick={handleDownloadROA} disabled={!!downloading}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-lg font-body font-semibold text-[0.88rem] bg-hrs-orange text-white border-none transition-all hover:bg-hrs-orange-light disabled:opacity-60">
            <FileDown className="w-4 h-4" />
            {downloading === 'roa' ? 'Generating...' : 'Download ROA PDF'}
          </button>
          <button onClick={handleDownloadCombined} disabled={!!downloading}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-lg font-body font-semibold text-[0.88rem] bg-transparent text-white border-[1.5px] border-white/50 transition-all hover:border-white disabled:opacity-60">
            <FilePlus className="w-4 h-4" />
            {downloading === 'combined' ? 'Generating...' : 'Download ROA + Checklist'}
          </button>
        </div>
        {confirmRestart ? (
          <div className="rounded-lg border border-hrs-orange/60 bg-white/10 px-4 py-3 text-[0.82rem]">
            <p className="text-white font-semibold mb-2">Have you downloaded the ROA + Checklist PDF?</p>
            <p className="text-white/70 mb-3 text-[0.78rem]">The checklist data will be lost once you start a new record.</p>
            <div className="flex gap-3">
              <button onClick={onRestart}
                className="flex-1 px-4 py-2 rounded-lg font-body font-semibold text-[0.82rem] bg-hrs-orange text-white transition-all hover:bg-hrs-orange-light">
                Yes, start new record
              </button>
              <button onClick={() => setConfirmRestart(false)}
                className="flex-1 px-4 py-2 rounded-lg font-body font-semibold text-[0.82rem] bg-transparent text-white border border-white/40 transition-all hover:border-white">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-3">
            <button onClick={handleRestartClick}
              className="flex-1 px-5 py-2.5 rounded-lg font-body font-semibold text-[0.85rem] bg-transparent text-white/70 border-[1px] border-white/20 transition-all hover:border-white/40 hover:text-white">
              + New Advice Record
            </button>
          </div>
        )}
      </FormCard>
    </div>
  );
}