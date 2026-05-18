import { useEffect } from 'react';
import FormCard from "../../FormCard";
import SectionTitle from "../../SectionTitle";
import FormField from "../../FormField";
import TextInput from "../../TextInput";
import SelectInput from "../../SelectInput";
import YesNoToggle from "../../YesNoToggle";
import NavBar from "../../NavBar";
import { ADVISORS } from "../../../../lib/hrsConstants";

const PROVINCES = [
  "Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal",
  "Limpopo", "Mpumalanga", "North West", "Northern Cape", "Western Cape",
];

export default function CommercialStepClientDetails({ data, onChange, onNext }) {
  const set = (key) => (val) => onChange({ ...data, [key]: val });

  useEffect(() => {
    const parts = [
      data.streetNumber, data.streetName, data.complexName,
      data.suburb, data.city, data.province, data.postalCode,
    ].filter(Boolean);
    const assembled = parts.join(', ');
    if (assembled !== data.riskAddress) {
      onChange({ ...data, riskAddress: assembled });
    }
  }, [data.streetNumber, data.streetName, data.complexName, data.suburb, data.city, data.province, data.postalCode]);

  useEffect(() => {
    const name = [data.contactFirstName, data.contactSurname].filter(Boolean).join(' ');
    if (name !== data.contactPerson) {
      onChange({ ...data, contactPerson: name });
    }
  }, [data.contactFirstName, data.contactSurname]);

  return (
    <div>
      <FormCard>
        <SectionTitle>Client Details</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-7">
          Commercial client and company information
        </p>

        {/* Company Details */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <FormField label="Company Name" required>
            <TextInput value={data.companyName} onChange={set('companyName')} placeholder="Registered company name" />
          </FormField>
          <FormField label="Registration No." required>
            <TextInput value={data.registrationNo} onChange={set('registrationNo')} placeholder="e.g. 2020/123456/07" />
          </FormField>
          <FormField label="VAT No.">
            <TextInput value={data.vatNo} onChange={set('vatNo')} placeholder="VAT registration number" />
          </FormField>
          <FormField label="Nature of Business" required>
            <TextInput value={data.natureOfBusiness} onChange={set('natureOfBusiness')} placeholder="e.g. Retail, Construction, IT Services" />
          </FormField>
        </div>

        {/* Risk Address */}
        <div className="h-px bg-hrs-border my-6" />
        <SectionTitle size="sm">Risk Address</SectionTitle>
        <p className="text-hrs-muted text-[0.78rem] mb-4 mt-1">Address of the property / risk to be insured</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <FormField label="Street Number" required>
            <TextInput value={data.streetNumber} onChange={set('streetNumber')} placeholder="e.g. 16" />
          </FormField>
          <FormField label="Street Name" required>
            <TextInput value={data.streetName} onChange={set('streetName')} placeholder="e.g. Monte Carlo Crescent" />
          </FormField>
          <FormField label="Complex / Building Name">
            <TextInput value={data.complexName} onChange={set('complexName')} placeholder="e.g. Kyalami Business Park (optional)" />
          </FormField>
          <FormField label="Suburb" required>
            <TextInput value={data.suburb} onChange={set('suburb')} placeholder="e.g. Kyalami" />
          </FormField>
          <FormField label="City" required>
            <TextInput value={data.city} onChange={set('city')} placeholder="e.g. Midrand" />
          </FormField>
          <FormField label="Province" required>
            <SelectInput value={data.province} onChange={set('province')} options={PROVINCES} placeholder="-- Select Province --" />
          </FormField>
          <FormField label="Postal Code" required>
            <TextInput value={data.postalCode} onChange={set('postalCode')} placeholder="e.g. 1684" />
          </FormField>
        </div>

        {/* Contact Person */}
        <div className="h-px bg-hrs-border my-6" />
        <SectionTitle size="sm">Contact Person</SectionTitle>
        <p className="text-hrs-muted text-[0.78rem] mb-4 mt-1">Primary contact at the business</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <FormField label="Title" required>
            <SelectInput value={data.contactTitle} onChange={set('contactTitle')} options={["Mr", "Mrs", "Miss", "Ms", "Dr", "Prof"]} placeholder="-- Select Title --" />
          </FormField>
          <FormField label="Initial(s)">
            <TextInput value={data.contactInitials} onChange={set('contactInitials')} placeholder="e.g. J" />
          </FormField>
          <FormField label="First Name" required>
            <TextInput value={data.contactFirstName} onChange={set('contactFirstName')} placeholder="e.g. John" />
          </FormField>
          <FormField label="Surname" required>
            <TextInput value={data.contactSurname} onChange={set('contactSurname')} placeholder="e.g. Smith" />
          </FormField>
          <FormField label="ID / Passport Number">
            <TextInput value={data.idNo} onChange={set('idNo')} placeholder="ID / Passport number" />
          </FormField>
          <FormField label="Email Address" required>
            <TextInput type="email" value={data.email} onChange={set('email')} placeholder="contact@company.co.za" />
          </FormField>
          <FormField label="Contact Number" required>
            <TextInput type="tel" value={data.contactNo} onChange={set('contactNo')} placeholder="e.g. 011 123 4567" />
          </FormField>
          <FormField label="Work / Home Number">
            <TextInput type="tel" value={data.workNumber} onChange={set('workNumber')} placeholder="e.g. 0112345678" />
          </FormField>
        </div>

        {/* Advisor Details */}
        <div className="h-px bg-hrs-border my-6" />
        <SectionTitle size="sm">Advisor Details</SectionTitle>
        <div className="mt-3">
          <FormField label="Broker / Advisor Name" required>
            <SelectInput value={data.brokerName} onChange={set('brokerName')} options={ADVISORS} placeholder="-- Select Advisor --" />
          </FormField>
        </div>
        <div className="mt-4">
          <FormField label="Inception Date">
            <TextInput type="date" value={data.inceptionDate} onChange={set('inceptionDate')} />
          </FormField>
        </div>
        <div className="mt-4">
          <p className="text-[0.8rem] font-semibold text-hrs-blue2 tracking-[0.03em] uppercase mb-2">
            Was the client provided with the advisor's FAIS Disclosure & Letter of Authority (Sec 13 Certificate)?
          </p>
          <YesNoToggle value={data.faisProvided} onChange={set('faisProvided')} />
        </div>
      </FormCard>

      <NavBar showPrev={false} onNext={onNext} nextLabel="Next: Insurance History" />
    </div>
  );
}
