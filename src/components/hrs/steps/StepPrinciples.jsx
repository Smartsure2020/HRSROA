import FormCard from "../FormCard";
import SectionTitle from "../SectionTitle";
import AckRow from "../AckRow";
import LegalBlock from "../LegalBlock";
import NavBar from "../NavBar";
import TextInput from "../TextInput";
import YesNoToggle from "../YesNoToggle";
import StatutoryDisclosureModal from "../StatutoryDisclosureModal";
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
          <p className="text-[0.8rem] font-semibold mb-2">IMPORTANT: This document only sets out your consent for the payment of broker fees for additional services performed by Holistic Risk Services (Pty) Ltd and does not replace any other disclosures you are entitled to receive in terms of applicable legislation.</p>
          <p className="mt-2 font-semibold">1. General</p>
          <p className="mt-1">Holistic Risk Services (Pty) Ltd, with FSP number 28582, provides various services in relation to your short-term policy for, or on behalf of yourself, or on behalf of an insurer, or for acting as an intermediary. For these services Holistic Risk Services (Pty) Ltd is remunerated by way of commission and fees which are either paid by the insurer or yourself. Any commission and fees received are paid in terms of applicable legislation and are disclosed to you.</p>
          <p className="mt-2 font-semibold">1.1 Broker fees</p>
          <p className="mt-1">Broker fees are charged to you for providing additional services for your benefit. Broker fees, like all other fees and commission, will be fully disclosed to you. You may also withdraw consent from us to charge the fee if you do not want to make use of these various services provided. The following are the additional services that we perform in terms of our value proposition to you:</p>
          <ul className="list-disc ml-5 mt-1.5 space-y-1">
            <li>Assistance with rejected claims, including the preparation and submission of applications for goodwill payments</li>
            <li>Facilitation of non-insurance value-added products and services</li>
            <li>Onsite attendance with assessors as required or deemed necessary</li>
            <li>Advice and guidance outside the ambit of regulated financial products</li>
            <li>Onsite visits upon client request and at the time of policy renewal</li>
          </ul>
          <p className="mt-2 font-semibold">1.2 Broker fee amount</p>
          <p className="mt-1">For the additional services set out above, Holistic Risk Services (Pty) Ltd charges the fee disclosed to you under Products &amp; Advice in this record (as a percentage of gross premium or a flat rand amount, inclusive of VAT). The broker fee will be charged monthly for as long as the policy is active.</p>
          <p className="mt-2 font-semibold">2. Consent</p>
          <p className="mt-1">By ticking the box below, I consent to paying the broker fee for the additional services set out above.</p>
        </LegalBlock>
        <AckRow checked={data.ackBrokerFee} onChange={set("ackBrokerFee")}>
          I have read and understood the Broker Fee Consent above, and I consent to the payment of the broker (intermediary) fee for the additional services described.
        </AckRow>

        <div className="mt-4">
          <StatutoryDisclosureModal checked={data.ackStatutoryDisclosure} onAcknowledge={set("ackStatutoryDisclosure")} />
        </div>
      </FormCard>

      <FormCard>
        <SectionTitle>Broker Appointment</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-5">Appointment of Holistic Risk Services (Pty) Ltd as your short-term insurance broker</p>
        <LegalBlock>
          <p>The client hereby appoints <strong>Holistic Risk Services (Pty) Ltd</strong>, represented by the advisor named in this record, as his, her or its broker (agent), and confirms that such appointment remains in force until cancelled by the client or the provider in writing.</p>
          <p className="mt-3 font-semibold">Financial Services</p>
          <p className="mt-1">The client hereby confirms that Holistic Risk Services (Pty) Ltd is authorised to render financial services on his, her or its behalf. Such authorisation includes any instruction to facilitate the buying, selling, termination or replacement of any existing financial product, and the managing, administering, maintaining or servicing of a financial product, and the submittal or processing of any claims associated with a financial product. Product suppliers are requested to kindly give effect to any instructions communicated by Holistic Risk Services (Pty) Ltd.</p>
          <p className="mt-3 font-semibold">Client Information</p>
          <p className="mt-1">Holistic Risk Services (Pty) Ltd acknowledges that in the course of rendering financial services, it shall come into possession of information of a confidential nature, and shall not, during or after this appointment, use or disclose any client information except to the extent required by law or permitted by the client in writing. This appointment authorises Holistic Risk Services (Pty) Ltd to obtain any information from a third party in order to determine the client's financial situation, financial product experience and financial objectives, including any information relating to a policy purchased by the client. Product suppliers are requested to kindly furnish Holistic Risk Services (Pty) Ltd with all requested client information.</p>
          <p className="mt-3 font-semibold">Commission</p>
          <p className="mt-1">The client agrees to transfer any new commission which may become due during the appointment period to Holistic Risk Services (Pty) Ltd. Product suppliers are requested to kindly transfer any insurance and investment portfolios to Holistic Risk Services (Pty) Ltd's broker code.</p>
          <p className="mt-3">This appointment shall remain in force until cancelled in writing by either party with 30 days' notice.</p>
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

      <FormCard>
        <SectionTitle>Letter of Investigation</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-5">Only applicable if HRS is taking over as broker of record from another provider</p>
        <p className="text-[0.8rem] font-semibold text-hrs-blue2 tracking-[0.03em] uppercase mb-2">
          Is HRS taking over as your broker of record from another provider?
        </p>
        <YesNoToggle value={data.changingBroker} onChange={set("changingBroker")} />

        {data.changingBroker === "yes" && (
          <>
            <LegalBlock className="mt-4">
              <p>I/We hereby grant Holistic Risk Services (Pty) Ltd full authority to obtain and verify any information regarding my/our short-term insurance policies.</p>
              <p className="mt-2">This authority extends to the investigation of: risk details and underwriting information relevant to my/our insurance; personal information necessary for the proper administration of my/our insurance; and claims history, premium records, and any other information material to the insurance relationship.</p>
              <p className="mt-2">I/We acknowledge and agree that any changes in respect of risk, underwriting or personal information relevant to the insurance must be disclosed to Holistic Risk Services (Pty) Ltd as soon as possible, and that in the event of any misrepresentation by the client regarding claims, insurance history, premium prejudice, or personal information, Holistic Risk Services (Pty) Ltd shall not be held liable for any damage resulting from such breach of duty.</p>
              <p className="mt-2">This serves as formal confirmation of the client's consent for Holistic Risk Services (Pty) Ltd to conduct the necessary investigation and obtain all relevant information from insurers, underwriters or any other parties involved in the administration of the client's short-term insurance.</p>
            </LegalBlock>
            <AckRow checked={data.ackLetterOfInvestigation} onChange={set("ackLetterOfInvestigation")} className="mt-4">
              I grant Holistic Risk Services (Pty) Ltd authority to investigate and obtain the information described above from my previous insurer(s)/broker.
            </AckRow>
          </>
        )}
      </FormCard>

      <NavBar onPrev={onPrev} onNext={onNext} nextLabel="Next: Signatures" />
    </div>
  );
}