import FormCard from "../FormCard";
import SectionTitle from "../SectionTitle";
import FormField from "../FormField";
import TextInput from "../TextInput";
import SelectInput from "../SelectInput";
import NavBar from "../NavBar";
import { BANKS, DEDUCTION_DATES, INSURERS } from "../../../lib/hrsConstants";

export default function StepBanking({ data, onChange, onNext, onPrev, nextLabel }) {
  const set = (key) => (val) => onChange({ ...data, [key]: val });

  return (
    <div>
      <FormCard>
        <SectionTitle>Banking & Debit Order</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-7">Banking details for premium collection (required for policy inception)</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <FormField label="Policy Holder Name (as on bank account)">
            <TextInput value={data.bankHolder} onChange={set("bankHolder")} placeholder="Full name on account" />
          </FormField>
          <FormField label="Bank Name">
            <SelectInput value={data.bankName} onChange={set("bankName")} options={BANKS} placeholder="-- Select Bank --" />
          </FormField>
          <FormField label="Branch Name">
            <TextInput value={data.branchName} onChange={set("branchName")} placeholder="e.g. Sandton" />
          </FormField>
          <FormField label="Branch Code">
            <TextInput value={data.branchCode} onChange={set("branchCode")} placeholder="e.g. 250655" />
          </FormField>
          <FormField label="Account Number">
            <TextInput value={data.accountNumber} onChange={set("accountNumber")} placeholder="e.g. 1234567890" />
          </FormField>
          <FormField label="Account Type">
            <SelectInput value={data.accountType} onChange={set("accountType")} options={["Cheque / Current Account", "Savings Account", "Transmission Account"]} />
          </FormField>
          <FormField label="Deduction Date">
            <SelectInput value={data.deductionDate} onChange={set("deductionDate")} options={DEDUCTION_DATES} placeholder="-- Select Day --" />
          </FormField>
          <FormField label="Deduction Amount (R)">
            <TextInput type="number" value={data.deductionAmount} onChange={set("deductionAmount")} placeholder="e.g. 2150" />
          </FormField>
          <FormField label="Policy Inception Date">
            <TextInput type="date" value={data.inceptionDate} onChange={set("inceptionDate")} />
          </FormField>
          <FormField label="Insurer (for debit order)">
            <SelectInput value={data.doInsurer} onChange={set("doInsurer")} options={INSURERS} />
          </FormField>
        </div>
      </FormCard>

      <FormCard>
        <SectionTitle>Broker Appointment</SectionTitle>
        <p className="text-hrs-muted text-[0.82rem] mb-7">Policy portfolio details for Holistic Risk Services broker appointment</p>

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
                <td className="py-2 px-3">
                  <TextInput value={data.apptHolder} onChange={set("apptHolder")} placeholder="Policy holder" />
                </td>
                <td className="py-2 px-3">
                  <TextInput value={data.apptInsurer} onChange={set("apptInsurer")} placeholder="e.g. Santam" />
                </td>
                <td className="py-2 px-3">
                  <TextInput value={data.apptPolicyNo} onChange={set("apptPolicyNo")} placeholder="Policy #" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </FormCard>

      <NavBar onPrev={onPrev} onNext={onNext} nextLabel={nextLabel} />
    </div>
  );
}
