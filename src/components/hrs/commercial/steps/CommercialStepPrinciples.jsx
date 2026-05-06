import FormCard from "../../FormCard";
import SectionTitle from "../../SectionTitle";
import NavBar from "../../NavBar";
import { COMMERCIAL_PRINCIPLES } from "../../../../lib/hrsCommercialConstants";

function AckItem({ number, text, checked, onChange }) {
  return (
    <div
      className="flex items-start gap-3 py-2.5 border-b border-hrs-border cursor-pointer hover:bg-hrs-blue/5 px-2 rounded transition-colors"
      onClick={() => onChange(!checked)}
    >
      <div className={`w-4 h-4 rounded border-[1.5px] flex-shrink-0 flex items-center justify-center mt-0.5 transition-colors ${checked ? "bg-hrs-green border-hrs-green" : "border-hrs-border bg-white"}`}>
        {checked && <span className="text-white text-[0.6rem] font-bold">✓</span>}
      </div>
      <div className="flex gap-2">
        <span className="text-[0.72rem] font-bold text-hrs-orange flex-shrink-0 mt-0.5">{number}.</span>
        <span className="text-[0.78rem] text-hrs-blue leading-relaxed">{text}</span>
      </div>
    </div>
  );
}

const INTERMEDIARY_AGREEMENT_TEXT = `The Adviser undertakes to:
1. Provide the Client with all statutory disclosure information and advice records;
2. Determine the Short-term Insurance goals and objectives of the Client and give effect to them in written recommendations;
3. Explain product features, restrictions, exclusions, terms and conditions to the best of his/her ability;
4. Offer expertise and advice to enable the Client to make informed decisions;
5. Notify the Short-term Insurer of this appointment in order to adjust their records accordingly;
6. Render ongoing intermediary service to the Client in terms of the Clients' Short Term Insurance needs;
7. Assist the Client in order to ensure effective and successful submission and settlement of claims;
8. Provide ongoing advice and assistance, whether by phone, internet, appointment or the distribution of policy renewals;
9. Renegotiate the adequate cover and ensure competitive premiums during renewal stage;
10. Keep accurate records of discussions with the Client;
11. Treat the Client's information with the utmost confidentiality;
12. Ensure that the Client is not induced to waive any right in terms of any law;
13. Notify the client in writing should he/she wish to terminate this agreement.

The Client agrees to:
1. Offer full cooperation and acknowledge ultimate responsibility for informed decisions;
2. Disclose all information that is factually true, accurate and material;
3. Instruct the Intermediary in writing when wishing to effect any changes or additions;
4. Study the policy schedule, wording and accompanying documentation upon receipt;
5. Notify the Intermediary of any change of contact details or banking details in writing;
6. Ensure that premiums and applicable fees are paid timeously;
7. Respond timeously to requests for cooperation when the annual review is due.`;

const POPIA_TEXT = `In order to provide you with insurance, we have to process your personal information. We will share your personal information with other insurers, industry bodies, credit agencies and service providers. This includes information about your insurance, claims and premium payments. We do this to provide insurance services, prevent fraud, assess claims and conduct surveys. We will treat your personal information with caution and have put reasonable security measures in place to protect it. By signing this form, you agree to the processing and sharing of your personal information.`;

export default function CommercialStepPrinciples({ data, onChange, onNext, onPrev }) {
  const allPrinciplesChecked = data.ackPrinciples;

  const toggleAll = () => onChange({ ...data, ackPrinciples: !allPrinciplesChecked });

  return (
    <div>
      <FormCard>
        <SectionTitle>Short-Term Insurance Principles</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-4">
          As understood by the client — tick to confirm understanding of each principle.
        </p>

        {COMMERCIAL_PRINCIPLES.map((text, i) => (
          <AckItem
            key={i}
            number={i + 1}
            text={text}
            checked={allPrinciplesChecked}
            onChange={toggleAll}
          />
        ))}

        <div
          className={`mt-4 flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${allPrinciplesChecked ? 'border-hrs-green bg-hrs-green/10' : 'border-hrs-border hover:border-hrs-orange'}`}
          onClick={toggleAll}
        >
          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${allPrinciplesChecked ? 'bg-hrs-green border-hrs-green' : 'border-hrs-border bg-white'}`}>
            {allPrinciplesChecked && <span className="text-white text-[0.65rem] font-bold">✓</span>}
          </div>
          <span className="text-[0.82rem] font-semibold text-hrs-blue">
            I acknowledge understanding of all Short-Term Insurance Principles above
          </span>
        </div>
      </FormCard>

      <FormCard>
        <SectionTitle>POPIA Requirements</SectionTitle>
        <p className="text-[0.8rem] text-hrs-blue leading-relaxed bg-hrs-blue/5 border border-hrs-border rounded-lg p-4 mb-4">
          {POPIA_TEXT}
        </p>
        <div
          className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${data.ackPopia ? 'border-hrs-green bg-hrs-green/10' : 'border-hrs-border hover:border-hrs-orange'}`}
          onClick={() => onChange({ ...data, ackPopia: !data.ackPopia })}
        >
          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${data.ackPopia ? 'bg-hrs-green border-hrs-green' : 'border-hrs-border bg-white'}`}>
            {data.ackPopia && <span className="text-white text-[0.65rem] font-bold">✓</span>}
          </div>
          <span className="text-[0.82rem] font-semibold text-hrs-blue">
            I consent to the processing and sharing of my personal information as described above
          </span>
        </div>
      </FormCard>

      <FormCard>
        <SectionTitle>Advice & Intermediary Services Agreement</SectionTitle>
        <div className="bg-hrs-blue/5 border border-hrs-border rounded-lg p-4 mb-4 max-h-64 overflow-y-auto">
          <p className="text-[0.76rem] text-hrs-blue leading-relaxed whitespace-pre-line">{INTERMEDIARY_AGREEMENT_TEXT}</p>
        </div>
        <div
          className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${data.ackIntermediaryAgreement ? 'border-hrs-green bg-hrs-green/10' : 'border-hrs-border hover:border-hrs-orange'}`}
          onClick={() => onChange({ ...data, ackIntermediaryAgreement: !data.ackIntermediaryAgreement })}
        >
          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${data.ackIntermediaryAgreement ? 'bg-hrs-green border-hrs-green' : 'border-hrs-border bg-white'}`}>
            {data.ackIntermediaryAgreement && <span className="text-white text-[0.65rem] font-bold">✓</span>}
          </div>
          <span className="text-[0.82rem] font-semibold text-hrs-blue">
            I have read and agree to the Advice & Intermediary Services Agreement
          </span>
        </div>
      </FormCard>

      <NavBar onPrev={onPrev} onNext={onNext} />
    </div>
  );
}