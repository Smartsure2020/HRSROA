import FormCard from "../FormCard";
import SectionTitle from "../SectionTitle";
import AckRow from "../AckRow";
import LegalBlock from "../LegalBlock";
import NavBar from "../NavBar";
import TextInput from "../TextInput";
import FormField from "../FormField";
import { PRINCIPLES } from "../../../lib/hrsConstants";

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

export default function StepPrinciples({ data, onChange, onNext, onPrev }) {
  const set = (key) => (val) => onChange({ ...data, [key]: val });

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
          <p className="text-[0.8rem] font-semibold mb-2">IMPORTANT: This document only sets out your consent for the payment of Intermediary fees for additional services performed by Holistic Risk Services (Pty) Ltd and does not replace any other disclosure you are entitled to receive in terms of any applicable legislation.</p>
          <p className="mt-2 font-semibold">1. General</p>
          <p className="mt-1">Holistic Risk Services (Pty) Ltd FSP no. 28582, provides various services in relation to your short-term insurance policy for, or on behalf of yourself, or on behalf of an insurer, or for acting as an intermediary. For these services Holistic Risk Services (Pty) Ltd is remunerated by way of commission and fees which are either paid by the insurer or yourself. Any commission and fees received are paid in terms of applicable legislation as disclosed to you.</p>
          <p className="mt-2 font-semibold">1.1 Broker (Intermediary) Fees</p>
          <p className="mt-1">A broker fee is an amount charged by Holistic Risk Services (Pty) Ltd for additional services rendered to you, which include but are not limited to: risk profiling, claims intervention, onsite visits, assistance with rejected claims, car hire management, accident support, and ongoing portfolio management. The broker fee amount (as a percentage or fixed rand amount) is disclosed to you in Step 3 of this advice record.</p>
          <p className="mt-2 font-semibold">1.2 Your Right to Withdraw Consent</p>
          <p className="mt-1">You have the right to withdraw your consent for the payment of the broker fee at any time by notifying Holistic Risk Services (Pty) Ltd in writing. Should you withdraw consent, Holistic Risk Services (Pty) Ltd reserves the right to review the services provided to you.</p>
          <p className="mt-2 font-semibold">1.3 Payment</p>
          <p className="mt-1">The broker fee, where applicable, will be collected together with your insurance premium via debit order or as otherwise agreed in writing. This fee is separate from any commission earned by Holistic Risk Services (Pty) Ltd from the insurer.</p>
        </LegalBlock>
        <AckRow checked={data.ackBrokerFee} onChange={set("ackBrokerFee")}>
          I have read and understood the Broker Fee Consent above, and I consent to the payment of the broker (intermediary) fee for the additional services described.
        </AckRow>
      </FormCard>

      <FormCard>
        <SectionTitle>Broker Appointment</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-5">Appointment of Holistic Risk Services (Pty) Ltd as your short-term insurance broker</p>
        <LegalBlock>
          <p>To Whom it May Concern,</p>
          <p className="mt-2">I, the undersigned, hereby confirm that I have appointed <strong>Holistic Risk Services (Pty) Ltd – HRS</strong> as my short-term insurance broker with effect from the date signed below.</p>
          <p className="mt-2">You are hereby authorised to provide the bearer of this note (or copy thereof) with any information that may be requested in connection with any of the policy contracts, which constitutes my insurance portfolio with your Company.</p>
          <p className="mt-2">I/We hereby authorise and instruct you to deduct or debit my account held with Holistic Risk Services (Pty) Ltd, with all amounts due and payable as per this appointment, and to pay same to the order of Holistic Risk Services (Pty) Ltd.</p>
          <p className="mt-2">This appointment shall remain in force until cancelled in writing by either party with 30 days' notice.</p>
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
          I confirm my appointment of Holistic Risk Services (Pty) Ltd as my short-term insurance broker as described above.
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

      <NavBar onPrev={onPrev} onNext={onNext} nextLabel="Next: Signatures" />
    </div>
  );
}