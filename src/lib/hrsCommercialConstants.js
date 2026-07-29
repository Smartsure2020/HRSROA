import { POLICY_TYPES, PERILS, VALUE_TYPES } from './hrsConstants';

export { POLICY_TYPES, PERILS, VALUE_TYPES };

export const COMMERCIAL_STEPS = [
  { label: "Client Details" },
  { label: "Insurance History" },
  { label: "Products & Advice" },
  { label: "Replacement Policy" },
  { label: "Risk Categories" },
  { label: "Principles & Disclosures" },
  { label: "Signatures" },
  { label: "Review" },
];

export const COMMERCIAL_RISK_CATEGORIES = [
  { name: "Fire", note: "", sasria: true },
  { name: "Buildings Combined", note: "", sasria: true },
  { name: "Office Contents", note: "", sasria: true },
  { name: "Business Interruption", note: "", sasria: true },
  { name: "Accidental Damage", note: "", sasria: false },
  { name: "Theft", note: "Forcible entry and/or exit applicable", sasria: false },
  { name: "Money", note: "", sasria: false },
  { name: "Glass", note: "", sasria: false },
  { name: "Business All Risks", note: "", sasria: false },
  { name: "Electronic Equipment", note: "Make, model and serial numbers required", sasria: false },
  { name: "Goods in Transit", note: "", sasria: false },
  { name: "Marine", note: "", sasria: false },
  { name: "Fidelity Guarantee", note: "", sasria: false },
  { name: "Public Liability", note: "", sasria: false },
  { name: "Products Liability", note: "", sasria: false },
  { name: "Employers Liability", note: "", sasria: false },
  { name: "Other Specific Liability", note: "", sasria: false },
  { name: "Motor", note: "Comprehensive / TPF&T / Third Party Only", sasria: true },
  { name: "Motor Traders", note: "", sasria: false },
  { name: "Homeowners", note: "", sasria: true },
  { name: "Household Contents", note: "", sasria: true },
  { name: "Personal Liability", note: "", sasria: false },
  { name: "D&O Liability", note: "Directors & Officers", sasria: false },
  { name: "Professional Indemnity", note: "", sasria: false },
  { name: "GPA and / or Stated Benefits", note: "", sasria: false },
  { name: "Any Other Specific", note: "", sasria: false },
  { name: "Value Added Products", note: "Roadside Assistance", sasria: false },
];

export const COMMERCIAL_PRINCIPLES = [
  'A short-term insurance policy is based on GOOD FAITH between all parties involved.',
  'A short-term insurance policy is issued as a POLICY OF INDEMNITY.',
  "SUBROGATION CLAUSE is the insurer's rights over the insured property upon paying a claim of loss under your policy.",
  'AVERAGE CLAUSE requires YOU to bear a proportion of any loss if your assets were under-insured.',
  'CONTRIBUTION CLAUSE implies that the claim settlement will be apportioned if there is more than one policy on the same risk.',
  'All items to be insured at REPLACEMENT VALUE unless specifically otherwise agreed to in writing and noted as such on the policy.',
  'SPECIFY all high-risk items separately, especially those which are portable (including electronic devices).',
  'VALUATION CERTIFICATES and / or PROOF OF OWNERSHIP are to be made available if and when required at claim stage.',
  'It is important that all details about any NON-STANDARD risks are disclosed by You.',
  'Upon submitting a VALID CLAIM, YOU need to ensure that you follow the required steps and submit all documentation as may be required.',
  'The methods of CLAIM SETTLEMENT is at the discretion of the insurer to repair or replace the item/s or pay cash in lieu.',
  'SPECIFIC REQUIREMENTS may be required by the insurer to install any alarm, security or other tracking devices.',
  'You need to be familiar with the definitions between PRIVATE vs BUSINESS use of vehicles.',
];

export function getCommercialStepErrors(step, formData) {
  switch (step) {
    case 0: {
      const fields = [
        ['companyName', 'Company Name'],
        ['registrationNo', 'Registration Number'],
        ['natureOfBusiness', 'Nature of Business'],
        ['streetNumber', 'Street Number'],
        ['streetName', 'Street Name'],
        ['suburb', 'Suburb'],
        ['city', 'City'],
        ['province', 'Province'],
        ['postalCode', 'Postal Code'],
        ['contactFirstName', 'Contact First Name'],
        ['contactSurname', 'Contact Surname'],
        ['email', 'Email'],
        ['contactNo', 'Contact Number'],
        ['brokerName', 'Advisor Name'],
        ['policyType', 'Policy Type'],
      ];
      return fields.filter(([k]) => !String(formData[k] ?? '').trim()).map(([, label]) => label);
    }
    case 1: {
      const errors = [];
      if (formData.uninterruptedInsurance === null || formData.uninterruptedInsurance === undefined)
        errors.push('Uninterrupted Insurance (Yes / No)');
      if (formData.clientDeclinedInfo === null || formData.clientDeclinedInfo === undefined)
        errors.push('Client Declined to Provide Information (Yes / No)');
      if (!String(formData.clientNeeds ?? '').trim())
        errors.push('Business Needs and Objectives');
      return errors;
    }
    case 2: {
      const fields = [
        ['ins2', 'Recommended Option – Insurer'],
        ['prem2', 'Recommended Option – Premium'],
        ['recInsurer', 'Recommended Insurer'],
        ['recReasons', 'Reasons for Recommendation'],
      ];
      return fields.filter(([k]) => !String(formData[k] ?? '').trim()).map(([, label]) => label);
    }
    case 3:
      return [];
    case 4: {
      // Principles & Disclosures (runtime step 4)
      const acks = [
        ['ackPrinciples', 'Short-Term Insurance Principles'],
        ['ackAdvisor', "Advisor's Obligations"],
        ['ackClient', 'Client Obligations'],
        ['ackPopia', 'POPIA Consent'],
        ['ackTermination', 'Termination Terms'],
        ['ackBrokerFee', 'Broker Fee Consent'],
        ['ackBrokerAppointment', 'Broker Appointment'],
        ['ackBrokerAuth', 'Broker Authorisation'],
        ['ackIntermediaryAgreement', 'Advice & Intermediary Services Agreement'],
        ['ackStatutoryDisclosure', 'Statutory Disclosure (Section 13)'],
      ];
      if (formData.changingBroker === 'yes') acks.push(['ackLetterOfInvestigation', 'Letter of Investigation']);
      return acks.filter(([k]) => !formData[k]).map(([, label]) => label);
    }
    case 5: {
      // Risk Categories (runtime step 5)
      const errors = [];
      const assessed = formData.riskState?.some(r => r.cover === 'yes' || r.cover === 'no');
      if (!assessed) errors.push('At least one risk category must be assessed (Yes or No)');
      if (!formData.valueToBeInsured) errors.push('Value to be Insured');
      return errors;
    }
    case 6: {
      const errors = [];
      const electedAlternative = formData.electionDiffers || formData.electionNotFollow || formData.electionLimitedInfo;
      if (electedAlternative && !String(formData.electionInitials ?? '').trim())
        errors.push('Client Initials (required for the election made above)');
      return errors;
    }
    default:
      return [];
  }
}

export function getCommercialInitialFormData() {
  const today = new Date().toISOString().split("T")[0];
  return {
    brokerFeeType: 'percent',

    // Client (commercial)
    companyName: '',
    registrationNo: '',
    vatNo: '',
    natureOfBusiness: '',
    // Risk address (individual fields; riskAddress assembled by CommercialStepClientDetails)
    riskAddress: '',
    streetNumber: '',
    streetName: '',
    complexName: '',
    suburb: '',
    city: '',
    province: '',
    postalCode: '',
    // Contact person (individual fields; contactPerson assembled by CommercialStepClientDetails)
    contactTitle: '',
    contactInitials: '',
    contactFirstName: '',
    contactSurname: '',
    contactPerson: '',
    idNo: '',
    email: '',
    contactNo: '',
    workNumber: '',
    brokerName: '',
    faisProvided: null,
    policyType: '',
    existingPolicyRef: '',

    // Insurance history
    uninterruptedInsurance: null,
    yearsInsured: '',
    specialTerms: null,
    cancelReasonText: '',
    clientDeclinedInfo: null,
    clientNeeds: 'To obtain adequate commercial short-term insurance cover meeting all the business requirements, protecting assets and managing risk exposure.',

    // Products
    ins0: '', prem0: '',
    ins1: '', prem1: '',
    ins2: '', prem2: '',
    recInsurer: '',
    brokerFeePercent: '',
    recReasons: '',
    basisInfo: 'Nature of business, the value of assets, existing SASRIA Cover, the risk address, security precautions, claims history, current premium and excess structures (if currently insured).',
    basisRec: 'To take out a new or extend the current short-term insurance policy as attached and acknowledged. With confirmation of any risk categories to be excluded (i.e. to remain uninsured).',
    basisDecision: 'To take out the proposed and quoted insurance with HRS – HOLISTIC RISK SERVICES (Pty) Ltd.',

    // Replacement policy
    replacingExisting: null,
    likeForLike: null,
    mainDifferences: '',
    exclusions: '',
    replacementReason: '',
    currentInsurer: '',
    newInsurer: '',

    // Commission
    agreedFees: '',

    // Risk categories
    riskState: COMMERCIAL_RISK_CATEGORIES.map(() => ({ cover: null, sasria: false })),
    additionalComments: '',

    // Needs analysis
    perilsSelected: [],
    perilsOther: '',
    valueToBeInsured: '',
    compulsoryExcess: null,
    voluntaryExcess: '',
    noClaimsBonus: null,
    riskProfileNotes: '',

    // Acknowledgements
    ackPrinciples: false,
    ackAdvisor: false,
    ackClient: false,
    ackPopia: false,
    ackTermination: false,
    ackBrokerFee: false,
    ackBrokerAppointment: false,
    ackBrokerAuth: false,
    ackIntermediaryAgreement: false,
    changingBroker: null,
    ackLetterOfInvestigation: false,
    ackStatutoryDisclosure: false,

    // Election / declaration
    electionDiffers: false,
    electionNotFollow: false,
    electionLimitedInfo: false,
    electionInitials: '',
    declarationChoice: 'accept',

    // Broker appointment table
    apptHolder: '',
    apptInsurer: '',
    apptPolicyNo: '',

    // Signatures
    inceptionDate: today,
    sigDate: today,
    clientSig: null,
    advisorSig: null,
  };
}