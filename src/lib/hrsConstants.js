export const STEPS = [
  { label: "Client Details" },
  { label: "Insurance History" },
  { label: "Products & Advice" },
  { label: "Risk Categories" },
  { label: "Principles & Disclosures" },
  { label: "Signatures" },
  { label: "Review" },
];

export const RISK_CATEGORIES = [
  { name: "Buildings / Houses", note: "Solar systems to be listed", sasria: true },
  { name: "Contents – Fire & Perils", note: "", sasria: true },
  { name: "Contents – Full Theft", note: "Forcible entry and/or exit applicable", sasria: false },
  { name: "Contents – Specified Theft Only", note: "Forcible entry and/or exit applicable", sasria: false },
  { name: "Clothing & Personal Effects", note: "Unused jewellery kept in safe", sasria: false },
  { name: "All Risk – Other Items", note: "Limit to item, set or pair applicable", sasria: false },
  { name: "All Risk – Bicycles", note: "Professional use excluded", sasria: false },
  { name: "All Risk – Electronic Handheld Devices", note: "Make, model, serial & IMEI required. Unattended vehicle restriction.", sasria: false },
  { name: "All Risk – Firearms", note: "Unused firearms kept in safe", sasria: false },
  { name: "All Risk – Jewellery", note: "Valuation certificates required (not older than 2 years)", sasria: false },
  { name: "Vehicles (incl. Bikes, Caravans & Trailers)", note: "Comprehensive / TPF&T / Third Party Only", sasria: true },
  { name: "Vehicles – Drivers under 25", note: "Must list all drivers under 25 who may occasionally drive", sasria: false },
  { name: "Pleasure Craft", note: "", sasria: true },
  { name: "Personal Accident", note: "", sasria: false },
  { name: "Personal Liability", note: "", sasria: false },
  { name: "Value Added Products (VAPs)", note: "Roadside Assistance", sasria: false },
];

export const BROKER_EMAIL_MAP = {
  'Aedan Doubell':        'aedan@hrsinsurance.co.za',
  'Andrew Penney':        'andrew@hrsinsurance.co.za',
  'Charmaine Brogden':    'charmaine@hrsinsurance.co.za',
  'Daniel Pottier':       'daniel@hrsinsurance.co.za',
  'Jaryd Browne':         'jaryd@hrsinsurance.co.za',
  'Juan-Paul vd Merwe':   'juan-paul@hrsinsurance.co.za',
  'Werner Joubert':       'werner@hrsinsurance.co.za',
};

export const DEFAULT_BROKER_EMAIL = 'info@hrsinsurance.co.za';
export const MANAGER_NAME = 'Andrew Penney';

export const ADVISORS = [
  "Aedan Doubell",
  "Andrew Penney",
  "Charmaine Brogden",
  "Daniel Pottier",
  "Jaryd Browne",
  "Juan-Paul vd Merwe",
  "Werner Joubert",
];

export const BANKS = [
  "ABSA Bank",
  "FNB (First National Bank)",
  "Standard Bank",
  "Nedbank",
  "Capitec Bank",
  "Investec",
  "African Bank",
  "Discovery Bank",
  "TymeBank",
  "Other",
];

export const DEDUCTION_DATES = [
  "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th",
  "11th", "12th", "13th", "14th", "15th", "20th", "25th", "Last day of month",
];

export const INSURERS = [
  "Stratsys (Strategic Insurance Systems)",
  "Smartsure Twenty20",
  "Other",
];

export const PRINCIPLES = [
  'A short-term insurance policy is based on GOOD FAITH between all parties involved.',
  'A short-term insurance policy is issued as a POLICY OF INDEMNITY.',
  "SUBROGATION CLAUSE is the insurer's rights over the insured property upon paying a claim of loss under your policy.",
  'AVERAGE CLAUSE requires YOU to bear a proportion of any loss if your assets were under-insured.',
  'CONTRIBUTION CLAUSE implies that the claim settlement will be apportioned if there is more than one policy on the same risk.',
  'All items to be insured at REPLACEMENT VALUE unless specifically otherwise agreed to in writing.',
  'SPECIFY all jewellery, bicycles, laptops, cell phones & handheld electronic devices and all other valuable portable items.',
  'Insure all items including SOLAR SYSTEMS at current replacement value, reviewing values annually.',
];

export function getStepErrors(step, formData) {
  switch (step) {
    case 0: {
      const fields = [
        ['firstName', 'First Name'],
        ['surname', 'Surname'],
        ['idNumber', 'ID / Passport Number'],
        ['email', 'Email'],
        ['cell', 'Cell Number'],
        ['streetNumber', 'Street Number'],
        ['streetName', 'Street Name'],
        ['suburb', 'Suburb'],
        ['city', 'City'],
        ['province', 'Province'],
        ['postalCode', 'Postal Code'],
        ['brokerName', 'Advisor Name'],
      ];
      return fields.filter(([k]) => !String(formData[k] ?? '').trim()).map(([, label]) => label);
    }
    case 1: {
      const errors = [];
      if (formData.uninterruptedInsurance === null || formData.uninterruptedInsurance === undefined)
        errors.push('Uninterrupted Insurance (Yes / No)');
      if (!String(formData.clientNeeds ?? '').trim())
        errors.push('Client Needs');
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
    case 3: {
      const assessed = formData.riskState?.some(r => r.cover === 'yes' || r.cover === 'no');
      return assessed ? [] : ['At least one risk category must be assessed (Yes or No)'];
    }
    case 4: {
      const acks = [
        ['ackPrinciples', 'Short-Term Insurance Principles'],
        ['ackAdvisor', "Advisor's Obligations"],
        ['ackClient', 'Client Obligations'],
        ['ackPopia', 'POPIA Consent'],
        ['ackTermination', 'Termination Terms'],
        ['ackBrokerFee', 'Broker Fee Consent'],
        ['ackBrokerAppointment', 'Broker Appointment'],
        ['ackBrokerAuth', 'Broker Authorisation'],
      ];
      return acks.filter(([k]) => !formData[k]).map(([, label]) => label);
    }
    case 5: {
      const errors = [];
      if (!formData.clientSig) errors.push('Client Signature');
      if (!formData.advisorSig) errors.push('Advisor / Broker Signature');
      return errors;
    }
    default:
      return [];
  }
}

export function getInitialFormData() {
  const today = new Date().toISOString().split("T")[0];
  return {
    // Broker fee type
    brokerFeeType: 'percent',

    // Client
    title: "",
    initials: "",
    firstName: "",
    surname: "",
    idNumber: "",
    email: "",
    cell: "",
    occupation: "",
    workNumber: "",
    maritalStatus: "",
    // Address
    streetNumber: "",
    streetName: "",
    complexName: "",
    suburb: "",
    city: "",
    province: "",
    postalCode: "",
    brokerName: "",
    faisProvided: null,

    // Insurance history
    uninterruptedInsurance: null,
    yearsInsured: "",
    specialTerms: null,
    cancelReasonText: "",
    clientNeeds: "To obtain affordable short-term insurance meeting all the client's requirements and needs.",

    // Products
    ins0: "", prem0: "",
    ins1: "", prem1: "",
    ins2: "", prem2: "",
    recInsurer: "",
    brokerFeePercent: "",
    recReasons: "",
    basisInfo: "Previous sums insured, value of assets, existing SASRIA cover, applicable excesses, claims history, address, security, age and the premium paid.",
    basisRec: "To take out a new or extend the current short-term insurance policy as attached and acknowledged, with confirmation of any risk categories to be excluded.",
    basisDecision: "To take out the proposed and quoted insurance with Holistic Risk Services (Pty) Ltd.",

    // Risk categories
    riskState: RISK_CATEGORIES.map(() => ({ cover: null, sasria: false })),
    additionalComments: "",

    // Acknowledgements
    ackPrinciples: false,
    ackAdvisor: false,
    ackClient: false,
    ackPopia: false,
    ackTermination: false,
    ackBrokerFee: false,
    ackBrokerAppointment: false,
    ackBrokerAuth: false,

    // Banking
    bankHolder: "",
    bankName: "",
    branchName: "",
    branchCode: "",
    accountNumber: "",
    accountType: "",
    deductionDate: "",
    deductionAmount: "",
    inceptionDate: today,
    doInsurer: "",
    apptHolder: "",
    apptInsurer: "",
    apptPolicyNo: "",

    // Signatures
    sigDate: today,
    clientSig: null,
    advisorSig: null,
  };
}