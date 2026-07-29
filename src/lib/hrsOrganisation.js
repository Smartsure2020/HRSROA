// Central, single source of truth for Holistic Risk Services (HRS) organisation details.
//
// Confirmed against the approved source documents during Phase 3 (2026-07-29):
//   - "Broker Appointment (Client Mandate).pdf"
//   - "HRS Broker Fee Consent (2026).pdf"
//   - "Statutory Disclosure HRS.pdf"
// All three agree on Reg No, VAT No, FSP No, physical/postal address and Key Individual.
// The two Broker documents state the switchboard number as 010 447-9800 / 010 447 9800.
// The Statutory Disclosure document states 011 840 6000.
// HRS Compliance has approved a single number for this application: 011 447 9800
// (see Phase 3 instruction, section 1.1). That approved number is used everywhere
// below instead of either source-document number.
//
// Do not hard-code any of these values elsewhere — import HRS_INFO instead so a future
// change only has to happen in this one file.
export const HRS_INFO = {
  legalName: "Holistic Risk Services (Pty) Ltd",
  shortName: "HRS",
  registrationNumber: "2004/026273/07",
  vatNumber: "4810229585",
  fspNumber: "28582",
  phone: "011 447 9800",
  email: "info@hrsinsurance.co.za",
  website: "www.hrsinsurance.co.za",
  physicalAddress: "16 Monte Carlo Crescent, Kyalami Business Park, Midrand, 1684",
  postalAddress: "P O Box 321, Cramerview, 2060",
  keyIndividual: "Andrew Penney",
  directors: "AC Penney, CE Brogden, CS Giles, TL Hodgson",
  complianceOfficer: "Mrs Monique Coetzee",
  compliancePractice: "Moonstone Compliance (Practice No 188)",
  compliancePhone: "071 997 5034",
  compliancePostalAddress: "PO Box 12662, Die Boord, Stellenbosch, 7613",
};

/** "Holistic Risk Services (Pty) Ltd — FSP 28582" — common one-line attribution used in footers/legal text. */
export const HRS_FSP_LINE = `${HRS_INFO.legalName} — FSP ${HRS_INFO.fspNumber}`;

/** Full contact block, used on success/checklist screens. */
export function hrsContactLines() {
  return [
    HRS_INFO.physicalAddress,
    `${HRS_INFO.postalAddress} · Tel: ${HRS_INFO.phone}`,
    HRS_INFO.website,
    `${HRS_INFO.legalName} · FSP ${HRS_INFO.fspNumber}`,
  ];
}
