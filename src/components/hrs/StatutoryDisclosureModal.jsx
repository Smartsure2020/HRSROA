import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Check, AlertTriangle, ScrollText, Download } from "lucide-react";
import { HRS_INFO } from "../../lib/hrsOrganisation";
import { HRS_COMPLIANCE_CONTENT } from "../../lib/hrsComplianceContent";

const DISCLOSURE = HRS_COMPLIANCE_CONTENT.statutoryDisclosure;

const PRODUCT_SUPPLIERS = [
  ["ABSA Insurance", "011 846 6523"], ["Alpha", "010 045 3318"],
  ["Arrow Underwriting Managers", "010 601 6100"], ["Auto and General Insurance Company", "011 715 7183"],
  ["Bouwen Underwriting", "010 592 1996"], ["Broker Buddy", "086 177 7013"],
  ["Bryte Insurance Company", "011 088 7150"], ["Budget Insurance Company", "011 715 7183"],
  ["CIA", "086 124 2777"], ["CIB", "011 455 5101"],
  ["Camargue Underwriting Managers", "011 778 9140"], ["Consort Technical Underwriting Managers", "011 658 1156"],
  ["Cross Country Insurance Consultants", "011 215 8800"], ["Discovery Insure", "086 075 1751"],
  ["Echelon", "011 023 2214"], ["Enivrosure Underwriting Managers", "031 205 4918"],
  ["F&I", "011 615 1640"], ["First for Women", "086 113 9339"],
  ["Genlib", "021 531 2922"], ["Guardrisk", "011 669 1000"],
  ["HCV Underwriting Managers", "011 628 3000"], ["Hollard", "086 100 0107"],
  ["iCredit", "086 135 3555"], ["Infiniti", "011 718 1200"],
  ["Kinetic Risk Solutions", "010 595 1387"], ["King Price", "086 050 5050"],
  ["Leppard Underwriting", "011 459 1640"], ["Lombard Insurance Company", "011 551 0600"],
  ["MiWay Insurance", "086 064 6464"], ["Mirabilis Engineering Underwriting Managers", "011 880 8200"],
  ["Momentum Insure", "021 684 5160"], ["Old Mutual Insure", "011 374 9111"],
  ["Oneplan Insurance", "010 001 0141"], ["Paladin Underwriting Managers", "011 523 9550"],
  ["Protocol Risk Managers", "021 554 0910"], ["Quicksure", "011 748 4700"],
  ["SA Underwriters", "011 777 7200"], ["Santam - SHA", "086 044 4444"],
  ["Santam", "086 044 4444"], ["Savannah Marine", "011 831 0720"],
  ["Southern Cross Risk Management", "010 496 7501"], ["Thatch Risk Acceptance (TRA)", "086 110 5799"],
  ["Tranquille Underwriting Managers", "010 592 1996"], ["Tri-Marine Acceptances", "021 701 8203"],
  ["Vantage Insurance", "021 701 7569"],
];

export default function StatutoryDisclosureModal({ checked, onAcknowledge }) {
  const [open, setOpen] = useState(false);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const scrollRef = useRef(null);

  const handleScroll = (e) => {
    const el = e.target;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) setScrolledToEnd(true);
  };

  const handleOpenChange = (next) => {
    setOpen(next);
    if (next) setScrolledToEnd(false);
  };

  const handleAcknowledge = () => {
    onAcknowledge(true);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => handleOpenChange(true)}
        className={`w-full flex items-center justify-between gap-3 p-3.5 sm:p-4 border-[1.5px] rounded-lg transition-all text-left ${
          checked ? "border-hrs-green/40 bg-emerald-50/60" : "border-hrs-border hover:border-hrs-orange-light"
        }`}
      >
        <span className="flex items-center gap-2.5">
          <ScrollText className="w-4 h-4 text-hrs-blue flex-shrink-0" />
          <span className="text-[0.85rem] font-medium text-hrs-blue2">
            Statutory Disclosure (Section 13) — HRS FSP {HRS_INFO.fspNumber}
            <span className="block text-[0.68rem] font-normal text-hrs-muted">Version {DISCLOSURE.version}</span>
          </span>
        </span>
        <span className={`text-[0.78rem] font-semibold flex items-center gap-1 flex-shrink-0 ${checked ? "text-hrs-green" : "text-hrs-red"}`}>
          {checked ? <><Check className="w-3.5 h-3.5" /> Acknowledged</> : <><AlertTriangle className="w-3.5 h-3.5" /> View &amp; sign</>}
        </span>
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] grid-rows-[auto_1fr_auto] p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-5 pb-3 border-b border-hrs-border">
            <DialogTitle className="text-hrs-blue font-heading text-[1.15rem]">
              {DISCLOSURE.title}
              <span className="ml-2 align-middle text-[0.68rem] font-normal text-hrs-muted">Version {DISCLOSURE.version}</span>
            </DialogTitle>
            <p className="text-[0.78rem] text-hrs-muted">
              {HRS_INFO.legalName} — Registration No {HRS_INFO.registrationNumber}. Please scroll through the full disclosure before signing.
            </p>
            <a
              href={DISCLOSURE.downloadUrl}
              download={DISCLOSURE.downloadFilename}
              className="inline-flex items-center gap-1.5 mt-2 text-[0.76rem] font-semibold text-hrs-blue hover:text-hrs-orange transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Download Statutory Disclosure (PDF)
            </a>
          </DialogHeader>

          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="overflow-y-auto p-5 text-[0.8rem] text-hrs-blue2 leading-relaxed space-y-4"
          >
            <section>
              <h4 className="font-semibold text-hrs-blue mb-1">Business Details</h4>
              <p>FSP Licence Number: <strong>{HRS_INFO.fspNumber}</strong><br />
              Address (Postal &amp; Physical): {HRS_INFO.physicalAddress}<br />
              Contact Person: {HRS_INFO.keyIndividual} (Key Individual)<br />
              Telephone Number: {HRS_INFO.phone} · Email: {HRS_INFO.email} · Website: {HRS_INFO.website}</p>
            </section>

            <section>
              <h4 className="font-semibold text-hrs-blue mb-1">Legal and Contractual Status</h4>
              <p>The Financial Service Provider is a private company and is a duly authorised intermediary of the following product suppliers. No conditions or restrictions have been imposed by any of the below product suppliers.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 mt-2 text-[0.74rem]">
                {PRODUCT_SUPPLIERS.map(([name, tel]) => (
                  <div key={name} className="flex justify-between border-b border-hrs-border/60 py-0.5">
                    <span>{name}</span><span className="text-hrs-muted flex-shrink-0 ml-2">{tel}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2">The financial advisor is an authorised representative of Holistic Risk Services and has been appointed in terms of a written agreement. Holistic Risk Services accepts responsibility for its own actions and for the actions of the financial advisor performed within the course and scope of that agreement.</p>
            </section>

            <section>
              <h4 className="font-semibold text-hrs-blue mb-1">Financial Services for which Authorised</h4>
              <p>In terms of the licence issued to Holistic Risk Services by the Authority, the financial advisor is authorised to provide financial services (Advice and Intermediary Services) in respect of: 1.2 Short-term Insurance: Personal Lines; 1.6 Short-term Insurance: Commercial Lines; 1.23 Short-term Insurance: Personal Lines A1. No conditions or restrictions have been imposed by the Authority.</p>
            </section>

            <section>
              <h4 className="font-semibold text-hrs-blue mb-1">Compliance Department</h4>
              <p>The provider has appointed {HRS_INFO.compliancePractice} as its external compliance practice. The Compliance Officer is {HRS_INFO.complianceOfficer}, Tel: {HRS_INFO.compliancePhone}, Postal Address: {HRS_INFO.compliancePostalAddress}.</p>
            </section>

            <section>
              <h4 className="font-semibold text-hrs-blue mb-1">Professional Indemnity</h4>
              <p>The provider holds professional indemnity insurance.</p>
            </section>

            <section>
              <h4 className="font-semibold text-hrs-blue mb-1">Disclosure of Interest and Remuneration</h4>
              <p>The provider has established a Conflict of Interest Management Policy which requires your financial advisor to disclose any actual or potential conflict of interest to you. A copy is available to the client at this office during office hours each day. Neither the provider nor your financial advisor holds directly or indirectly more than 10% of any product supplier's shares or equivalent financial interest. Your financial advisor has not received more than 30% of his/her total remuneration, including commission, from any product supplier during the preceding 12 months.</p>
            </section>

            <section>
              <h4 className="font-semibold text-hrs-blue mb-1">Complaint Resolution System and Procedures</h4>
              <p>Should you be dissatisfied with any aspect of the service performed by the provider or your financial advisor, address your complaint in writing to the Key Individual at the above address. A written internal complaint resolution system with detailed procedures has been established, and access to it is available to clients at this office during office hours each day.</p>
            </section>

            <section>
              <h4 className="font-semibold text-hrs-blue mb-1">Signing of Incomplete Documents</h4>
              <p>You are hereby advised and cautioned that no person acting on behalf of the provider may, in the course of rendering a financial service, request you to sign any written or printed form or document unless all details required to be inserted thereon by you or on your behalf have already been inserted.</p>
            </section>

            <section>
              <h4 className="font-semibold text-hrs-blue mb-1">Responsibility for Correctness and Completeness of Information</h4>
              <p>Please be aware that when completing any documentation or providing any information, all material facts must be accurately and properly disclosed. You are entirely responsible for the accuracy and completeness of all answers, statements or other information provided by you or on your behalf. Any misrepresentation or non-disclosure of a material fact, or the inclusion of incorrect information, could result in the cancellation of the transaction by the product supplier.</p>
            </section>

            <section>
              <h4 className="font-semibold text-hrs-blue mb-1">Waiver of Rights</h4>
              <p>No financial advisor or any other person may ask you or offer any inducement to you to waive any right or benefit conferred on you in terms of any provision of the General Codes of Conduct. A copy of the Code of Conduct is available on request.</p>
            </section>

            <section>
              <h4 className="font-semibold text-hrs-blue mb-1">General</h4>
              <p>The provider may from time to time receive non-cash incentives from product suppliers or indirect consideration from other persons, and will make available specific details should this occur. All information obtained or acquired from you, the client, will remain confidential unless you provide written consent, or unless we are required by law to disclose such information.</p>
            </section>
          </div>

          <div className="p-5 pt-3 border-t border-hrs-border bg-secondary/60">
            {!scrolledToEnd && (
              <p className="text-[0.74rem] text-hrs-muted mb-2.5 text-center">Please scroll to the end of the disclosure to continue.</p>
            )}
            <button
              type="button"
              disabled={!scrolledToEnd}
              onClick={handleAcknowledge}
              className="w-full px-6 py-2.5 rounded-lg font-body font-semibold text-[0.87rem] bg-hrs-orange text-white border-none transition-all hover:bg-hrs-orange-light disabled:opacity-40 disabled:cursor-not-allowed"
            >
              I have read and understood this Statutory Disclosure
            </button>
            <p className="text-[0.7rem] text-hrs-muted text-center mt-2 leading-relaxed">
              {DISCLOSURE.signedUnderGeneralRoaText}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
