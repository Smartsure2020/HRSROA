import FormCard from "../../FormCard";
import SectionTitle from "../../SectionTitle";
import FormField from "../../FormField";
import TextInput from "../../TextInput";
import LegalBlock from "../../LegalBlock";
import AckRow from "../../AckRow";
import NavBar from "../../NavBar";
import { Check } from "lucide-react";
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
        <SectionTitle>E-signature Process</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-5">
          After submission, the authorised representative and adviser will sign the canonical Advice Record through the configured signing provider. No signature is captured in HRS.
        </p>
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
