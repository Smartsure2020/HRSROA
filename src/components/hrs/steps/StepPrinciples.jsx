import FormCard from "../FormCard";
import SectionTitle from "../SectionTitle";
import AckRow from "../AckRow";
import LegalBlock from "../LegalBlock";
import NavBar from "../NavBar";
import TextInput from "../TextInput";
import YesNoToggle from "../YesNoToggle";
import StatutoryDisclosureModal from "../StatutoryDisclosureModal";
import { PRINCIPLES } from "../../../lib/hrsConstants";
import { getBrokerFeeSummary } from "../../../lib/brokerFee";
import { HRS_COMPLIANCE_CONTENT } from "../../../lib/hrsComplianceContent";

const APPOINTMENT = HRS_COMPLIANCE_CONTENT.brokerAppointment.personal;
const FEE = HRS_COMPLIANCE_CONTENT.brokerFeeConsent;
const INVESTIGATION = HRS_COMPLIANCE_CONTENT.letterOfInvestigation.personal;

function PrincipleItem({ number, text }) {
  // Bold words between ** markers or known uppercase terms
  const parts = text.split(/(\b[A-Z][A-Z ]{3,}\b)/g);
  return (
    <div className="flex gap-3.5 items-start p-3.5 sm:p-4 bg-secondary rounded-lg border-l-[3px] border-hrs-orange">
      <span className="font-heading text-[1.1rem] text-hrs-orange min-w-[24px] leading-tight">{number}</span>
      <p className="text-[0.85rem] text-hrs-blue2 leading-relaxed">
        {parts.map((part, i) =>
          /^[A-Z][A-Z ]{3,}$/.test(part) ? <strong key={i} className="text-hrs-blue">{part}</strong> : part
        )}
      </p>
    </div>
  );
}

export default function StepPrinciples({ data, onChange, onNext, onPrev, nextLabel }) {
  const set = (key) => (val) => onChange({ ...data, [key]: val });
  const feeSummary = getBrokerFeeSummary(data);

  return (
    <div>
      <FormCard>
        <SectionTitle>Short-Term Insurance Principles</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-7">As understood by you. You may request further explanation for any term below.</p>

        <div className="grid gap-3">
          {PRINCIPLES.map((text, i) => (
            <PrincipleItem key={i} number={i + 1} text={text} />
          ))}
        </div>

        <AckRow checked={data.ackPrinciples} onChange={set("ackPrinciples")}>
          I confirm that I understand the above short-term insurance principles.
        </AckRow>
      </FormCard>

      <FormCard>
        <SectionTitle>Legal Disclosures & Acknowledgements</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-7">Please read each section carefully and tick to acknowledge</p>

        <LegalBlock title="Advice & Intermediary Services Agreement – Advisor's Obligations">
          <p>Holistic Risk Services (Pty) Ltd & the Adviser undertake to:</p>
          <ul className="list-disc ml-5 mt-2 space-y-1.5">
            <li>Provide all statutory disclosure information and advice records</li>
            <li>Determine the Short-term Insurance goals and objectives of the Client</li>
            <li>Explain product features, restrictions, exclusions, terms and conditions</li>
            <li>Render ongoing intermediary service, including assistance with claims</li>
            <li>Treat the Client's information with the utmost confidentiality</li>
            <li>Notify the client in writing should they wish to terminate this agreement</li>
          </ul>
        </LegalBlock>
        <AckRow checked={data.ackAdvisor} onChange={set("ackAdvisor")}>
          I acknowledge the advisor's obligations as set out above.
        </AckRow>

        <LegalBlock title="Client Obligations" className="mt-4">
          <p>The Client agrees to cooperate fully, disclose all material information, instruct the Intermediary in writing for any changes, honour premium payment obligations, and notify Holistic Risk Services of any change of contact or banking details in writing.</p>
        </LegalBlock>
        <AckRow checked={data.ackClient} onChange={set("ackClient")}>
          I confirm and accept my obligations as the client.
        </AckRow>

        <LegalBlock title="POPIA Requirements" className="mt-4">
          <p>In order to provide you with insurance, we have to process your personal information. We will share your personal information with other insurers, industry bodies, credit agencies and service providers for insurance services, fraud prevention, claims assessment and surveys. We will treat your personal information with caution and have put reasonable security measures in place to protect it.</p>
        </LegalBlock>
        <AckRow checked={data.ackPopia} onChange={set("ackPopia")}>
          I consent to the processing and sharing of my personal information as described above.
        </AckRow>

        <LegalBlock title="Termination of Agreement" className="mt-4">
          <p>Any party may terminate this agreement with 30 days' written notice. Holistic Risk Services (Pty) Ltd and the Adviser are from such date no longer responsible to provide the Client with any services or annual reports/statements.</p>
        </LegalBlock>
        <AckRow checked={data.ackTermination} onChange={set("ackTermination")}>
          I understand the termination terms of this agreement.
        </AckRow>

        <LegalBlock title="Broker (Intermediary) Fee Consent" className="mt-4">
          <p className="text-[0.8rem] font-semibold mb-2">{FEE.important}</p>
          <p className="mt-2 font-semibold">1. General</p>
          <p className="mt-1">{FEE.general}</p>
          <p className="mt-2 font-semibold">1.1 Broker fees</p>
          <p className="mt-1">{FEE.feesIntro}</p>
          <ul className="list-disc ml-5 mt-1.5 space-y-1">
            {FEE.additionalServices.map((s) => <li key={s}>{s}</li>)}
          </ul>
          <p className="mt-2 font-semibold">1.2 Broker fee amount</p>
          <p className="mt-1">{FEE.amount}</p>
          <p className="mt-2 font-semibold">2. Consent</p>
          <p className="mt-1">{FEE.consentIntro}</p>
        </LegalBlock>
        {feeSummary.consentRequired ? (
          <AckRow checked={data.ackBrokerFee} onChange={set("ackBrokerFee")}>
            {FEE.ackLabel} Fee applicable: <strong>{feeSummary.displayValue}</strong>.
          </AckRow>
        ) : (
          <div className="mt-4 p-3.5 rounded-lg border-[1.5px] border-hrs-border bg-secondary text-[0.82rem] text-hrs-muted italic">
            {FEE.noFeeApplicableLabel} No consent is required.
          </div>
        )}

        <div className="mt-4">
          <StatutoryDisclosureModal checked={data.ackStatutoryDisclosure} onAcknowledge={set("ackStatutoryDisclosure")} />
        </div>
      </FormCard>

      <FormCard>
        <SectionTitle>Broker Appointment</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-5">Appointment of Holistic Risk Services (Pty) Ltd as your short-term insurance broker</p>
        <LegalBlock>
          <p>{APPOINTMENT.intro}</p>
          {APPOINTMENT.sections.map((s) => (
            <div key={s.heading}>
              <p className="mt-3 font-semibold">{s.heading}</p>
              <p className="mt-1">{s.text}</p>
            </div>
          ))}
          {APPOINTMENT.closing && <p className="mt-3">{APPOINTMENT.closing}</p>}
        </LegalBlock>
        <div className="mt-5">
          <p className="text-[0.8rem] font-semibold text-hrs-blue2 uppercase tracking-[0.06em] mb-3">Policy Portfolio Details</p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[0.85rem]">
              <thead>
                <tr className="bg-hrs-blue text-white">
                  <th className="py-2.5 px-3 text-left text-[0.78rem] font-semibold">Policy Holder Name</th>
                  <th className="py-2.5 px-3 text-left text-[0.78rem] font-semibold">Insurance Company</th>
                  <th className="py-2.5 px-3 text-left text-[0.78rem] font-semibold">Policy Number</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-hrs-border">
                  <td className="py-2 px-3"><TextInput value={data.apptHolder} onChange={set("apptHolder")} placeholder="Policy holder name" /></td>
                  <td className="py-2 px-3"><TextInput value={data.apptInsurer} onChange={set("apptInsurer")} placeholder="e.g. Santam" /></td>
                  <td className="py-2 px-3"><TextInput value={data.apptPolicyNo} onChange={set("apptPolicyNo")} placeholder="Policy #" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <AckRow checked={data.ackBrokerAppointment} onChange={set("ackBrokerAppointment")} className="mt-4">
          {APPOINTMENT.ackLabel}
        </AckRow>
      </FormCard>

      <FormCard>
        <SectionTitle>Broker Authorisation</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-5">Authorisation for Holistic Risk Services to act on your behalf</p>
        <LegalBlock>
          <p>To Whom it May Concern,</p>
          <p className="mt-2">You are hereby authorised to provide the bearer of this note (or copy thereof) with any information that may be requested in connection with any of the policy contracts, which constitute my insurance portfolio with your Company.</p>
          <p className="mt-2">I/We hereby authorise <strong>Holistic Risk Services (Pty) Ltd</strong> to act as my/our intermediary and to render financial services on my/our behalf, including but not limited to: obtaining quotations, submitting applications, managing claims, and liaising with insurers on my/our behalf.</p>
          <p className="mt-2">This authorisation is given freely and voluntarily and shall remain in force until revoked in writing.</p>
        </LegalBlock>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-secondary rounded-lg p-3 border border-hrs-border">
            <span className="text-[0.75rem] text-hrs-muted block mb-0.5">Names &amp; Surname</span>
            <span className="text-[0.85rem] font-medium text-hrs-blue">{[data.title, data.initials, data.firstName, data.surname].filter(Boolean).join(' ') || '—'}</span>
          </div>
          <div className="bg-secondary rounded-lg p-3 border border-hrs-border">
            <span className="text-[0.75rem] text-hrs-muted block mb-0.5">ID / Passport Number</span>
            <span className="text-[0.85rem] font-medium text-hrs-blue">{data.idNumber || '—'}</span>
          </div>
          <div className="bg-secondary rounded-lg p-3 border border-hrs-border">
            <span className="text-[0.75rem] text-hrs-muted block mb-0.5">Cell Number</span>
            <span className="text-[0.85rem] font-medium text-hrs-blue">{data.cell || '—'}</span>
          </div>
          <div className="bg-secondary rounded-lg p-3 border border-hrs-border">
            <span className="text-[0.75rem] text-hrs-muted block mb-0.5">Email Address</span>
            <span className="text-[0.85rem] font-medium text-hrs-blue">{data.email || '—'}</span>
          </div>
        </div>
        <AckRow checked={data.ackBrokerAuth} onChange={set("ackBrokerAuth")} className="mt-4">
          I authorise Holistic Risk Services (Pty) Ltd to act as my intermediary and to access my insurance portfolio information as described above.
        </AckRow>
      </FormCard>

      <FormCard>
        <SectionTitle>Letter of Investigation</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-5">Only applicable if HRS is taking over as broker of record from another provider</p>
        <p className="text-[0.8rem] font-semibold text-hrs-blue2 tracking-[0.03em] uppercase mb-2">
          {INVESTIGATION.questionLabel}
        </p>
        <YesNoToggle value={data.changingBroker} onChange={set("changingBroker")} />

        {data.changingBroker === "yes" && (
          <>
            <LegalBlock className="mt-4">
              {INVESTIGATION.paragraphs.map((p, i) => <p key={i} className={i > 0 ? "mt-2" : ""}>{p}</p>)}
            </LegalBlock>
            <AckRow checked={data.ackLetterOfInvestigation} onChange={set("ackLetterOfInvestigation")} className="mt-4">
              {INVESTIGATION.ackLabel}
            </AckRow>
          </>
        )}
        {data.changingBroker !== "yes" && (
          <p className="text-[0.78rem] text-hrs-muted italic mt-2">Not applicable — only required where HRS is taking over as broker of record.</p>
        )}
      </FormCard>

      <NavBar onPrev={onPrev} onNext={onNext} nextLabel={nextLabel} />
    </div>
  );
}
