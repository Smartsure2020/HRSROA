import FormCard from "../FormCard";
import SectionTitle from "../SectionTitle";
import FormField from "../FormField";
import TextInput from "../TextInput";
import SelectInput from "../SelectInput";
import YesNoToggle from "../YesNoToggle";
import NavBar from "../NavBar";
import InfoBanner from "../InfoBanner";
import { ADVISORS, POLICY_TYPES } from "../../../lib/hrsConstants";

const PROVINCES = [
  "Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal",
  "Limpopo", "Mpumalanga", "North West", "Northern Cape", "Western Cape",
];

export default function StepClientDetails({ data, onChange, onNext, nextLabel }) {
  const set = (key) => (val) => onChange({ ...data, [key]: val });

  return (
    <div>
      <InfoBanner />
      <FormCard>
        <SectionTitle>Client Details</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-7">Personal information of the insured party</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <FormField label="Title" required>
            <SelectInput value={data.title} onChange={set("title")} options={["Mr", "Mrs", "Miss", "Ms", "Dr", "Prof"]} placeholder="-- Select Title --" />
          </FormField>
          <FormField label="Initial(s)" required>
            <TextInput value={data.initials} onChange={set("initials")} placeholder="e.g. J" />
          </FormField>
          <FormField label="First Name" required>
            <TextInput value={data.firstName} onChange={set("firstName")} placeholder="e.g. John" />
          </FormField>
          <FormField label="Surname" required>
            <TextInput value={data.surname} onChange={set("surname")} placeholder="e.g. Smith" />
          </FormField>
          <FormField label="ID / Passport Number" required>
            <TextInput value={data.idNumber} onChange={set("idNumber")} placeholder="13-digit SA ID or passport" />
          </FormField>
          <FormField label="Email Address" required>
            <TextInput type="email" value={data.email} onChange={set("email")} placeholder="name@email.com" />
          </FormField>
          <FormField label="Cell Number" required>
            <TextInput type="tel" value={data.cell} onChange={set("cell")} placeholder="e.g. 0821234567" />
          </FormField>
          <FormField label="Work / Home Number">
            <TextInput type="tel" value={data.workNumber} onChange={set("workNumber")} placeholder="e.g. 0112345678" />
          </FormField>
          <FormField label="Occupation">
            <TextInput value={data.occupation} onChange={set("occupation")} placeholder="e.g. Accountant" />
          </FormField>
          <FormField label="Marital Status">
            <SelectInput value={data.maritalStatus} onChange={set("maritalStatus")} options={["Single", "Married", "Divorced", "Widowed", "Life Partner"]} />
          </FormField>
        </div>

        <div className="h-px bg-hrs-border my-6" />
        <SectionTitle size="sm">Policy Type</SectionTitle>
        <p className="text-hrs-muted text-[0.78rem] mb-4 mt-1">Nature of this Record of Advice</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <FormField label="Policy Type" required>
            <SelectInput value={data.policyType} onChange={set("policyType")} options={POLICY_TYPES} placeholder="-- Select Policy Type --" />
          </FormField>
          {(data.policyType === "Renewal" || data.policyType === "Replacement") && (
            <FormField label="Existing Insurer / Product / Policy Number">
              <TextInput value={data.existingPolicyRef} onChange={set("existingPolicyRef")} placeholder="e.g. Santam / Home Owners / P123456" />
            </FormField>
          )}
        </div>

        <div className="h-px bg-hrs-border my-6" />
        <SectionTitle size="sm">Risk Address</SectionTitle>
        <p className="text-hrs-muted text-[0.78rem] mb-4 mt-1">Address of the property / risk to be insured</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <FormField label="Street Number" required>
            <TextInput value={data.streetNumber} onChange={set("streetNumber")} placeholder="e.g. 16" />
          </FormField>
          <FormField label="Street Name" required>
            <TextInput value={data.streetName} onChange={set("streetName")} placeholder="e.g. Monte Carlo Crescent" />
          </FormField>
          <FormField label="Complex / Building Name">
            <TextInput value={data.complexName} onChange={set("complexName")} placeholder="e.g. Kyalami Business Park (optional)" />
          </FormField>
          <FormField label="Suburb" required>
            <TextInput value={data.suburb} onChange={set("suburb")} placeholder="e.g. Kyalami" />
          </FormField>
          <FormField label="City" required>
            <TextInput value={data.city} onChange={set("city")} placeholder="e.g. Midrand" />
          </FormField>
          <FormField label="Province" required>
            <SelectInput value={data.province} onChange={set("province")} options={PROVINCES} placeholder="-- Select Province --" />
          </FormField>
          <FormField label="Postal Code" required>
            <TextInput value={data.postalCode} onChange={set("postalCode")} placeholder="e.g. 1684" />
          </FormField>
        </div>

        <div className="h-px bg-hrs-border my-6" />
        <SectionTitle size="sm">Advisor Details</SectionTitle>
        <div className="mt-3">
          <FormField label="Broker / Advisor Name" required>
            <SelectInput value={data.brokerName} onChange={set("brokerName")} options={ADVISORS} placeholder="-- Select Advisor --" />
          </FormField>
        </div>
        <div className="mt-4">
          <p className="text-[0.8rem] font-semibold text-hrs-blue2 tracking-[0.03em] uppercase mb-2">
            Was the client provided with the advisor's FAIS Disclosure & Letter of Authority (Sec 13 Certificate)?
          </p>
          <YesNoToggle value={data.faisProvided} onChange={set("faisProvided")} />
        </div>
      </FormCard>

      <NavBar showPrev={false} onNext={onNext} nextLabel={nextLabel} />
    </div>
  );
}
