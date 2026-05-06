import FormCard from "../../FormCard";
import SectionTitle from "../../SectionTitle";
import FormField from "../../FormField";
import TextInput from "../../TextInput";
import NavBar from "../../NavBar";
import { ADVISORS } from "../../../../lib/hrsConstants";

export default function CommercialStepClientDetails({ data, onChange, onNext }) {
  const set = (key) => (val) => onChange({ ...data, [key]: val });
  const setE = (key) => (e) => onChange({ ...data, [key]: e.target.value });

  return (
    <div>
      <FormCard>
        <SectionTitle>Client Details</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-6">
          Enter the commercial client and company information below.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5">
          <FormField label="Company Name" required>
            <TextInput value={data.companyName} onChange={setE('companyName')} placeholder="Registered company name" />
          </FormField>
          <FormField label="Registration No.">
            <TextInput value={data.registrationNo} onChange={setE('registrationNo')} placeholder="e.g. 2020/123456/07" />
          </FormField>
          <FormField label="VAT No.">
            <TextInput value={data.vatNo} onChange={setE('vatNo')} placeholder="VAT registration number" />
          </FormField>
          <FormField label="Nature of Business" required>
            <TextInput value={data.natureOfBusiness} onChange={setE('natureOfBusiness')} placeholder="e.g. Retail, Construction, IT Services" />
          </FormField>
        </div>

        <FormField label="Risk Address" required>
          <TextInput value={data.riskAddress} onChange={setE('riskAddress')} placeholder="Full physical risk address" />
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5">
          <FormField label="Contact Person" required>
            <TextInput value={data.contactPerson} onChange={setE('contactPerson')} placeholder="Full name of contact" />
          </FormField>
          <FormField label="ID Number">
            <TextInput value={data.idNo} onChange={setE('idNo')} placeholder="ID / Passport number" />
          </FormField>
          <FormField label="Email Address" required>
            <TextInput type="email" value={data.email} onChange={setE('email')} placeholder="contact@company.co.za" />
          </FormField>
          <FormField label="Contact Number" required>
            <TextInput type="tel" value={data.contactNo} onChange={setE('contactNo')} placeholder="e.g. 011 123 4567" />
          </FormField>
          <FormField label="Inception Date">
            <TextInput type="date" value={data.inceptionDate} onChange={setE('inceptionDate')} />
          </FormField>
        </div>

        <FormField label="Advisor / Broker" required>
          <select
            value={data.brokerName}
            onChange={setE('brokerName')}
            className="w-full rounded-lg border border-hrs-border bg-secondary px-3 py-2.5 text-[0.88rem] text-hrs-blue outline-none focus:border-hrs-orange transition-colors"
          >
            <option value="">Select advisor...</option>
            {ADVISORS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </FormField>

        <FormField label="Was the client provided with a copy of the advisor's FAIS Disclosure and Letter of Authority (Section 13 Certificate)?">
          <div className="flex gap-3 mt-1">
            {['yes', 'no'].map(v => (
              <button
                key={v}
                type="button"
                onClick={() => onChange({ ...data, faisProvided: v })}
                className={`px-5 py-2 rounded-lg border text-[0.82rem] font-semibold transition-all ${
                  data.faisProvided === v
                    ? v === 'yes' ? 'bg-hrs-green text-white border-hrs-green' : 'bg-hrs-red text-white border-hrs-red'
                    : 'border-hrs-border text-hrs-muted hover:border-hrs-orange'
                }`}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </FormField>
      </FormCard>
      <NavBar onNext={onNext} hidePrev />
    </div>
  );
}