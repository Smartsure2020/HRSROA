// Central, single source of truth for controlled legal / compliance wording.
//
// Scope (Phase 3, section 4): Broker Appointment, Broker Fee Consent,
// Letter of Investigation, Statutory Disclosure metadata, Client Declaration text,
// Election warning text, Advisor declaration text.
//
// Personal and Commercial wording differs only in pronoun ("I/my" vs "we/our" style) —
// both variants are preserved verbatim from the previously-approved on-screen/PDF text.
// The only substantive wording change made in this file vs. the prior implementation is
// the removal of the "30 days' notice" cancellation clause from Broker Appointment,
// per the approved Phase 3 business decision: the appointment remains in force until
// cancelled by the client or the provider in writing (no fixed notice period).
//
// Do not paraphrase or shorten this wording when reusing it — import and render as-is.

import { HRS_INFO } from './hrsOrganisation';

export const HRS_COMPLIANCE_CONTENT = {
  brokerAppointment: {
    version: "HRS-BROKER-APPT-2026-01",
    personal: {
      intro:
        "The client hereby appoints Holistic Risk Services (Pty) Ltd, represented by the advisor named in this record, as his, her or its broker (agent), and confirms that such appointment remains in force until cancelled by the client or the provider in writing.",
      sections: [
        {
          heading: "Financial Services",
          text:
            "The client hereby confirms that Holistic Risk Services (Pty) Ltd is authorised to render financial services on his, her or its behalf. Such authorisation includes any instruction to facilitate the buying, selling, termination or replacement of any existing financial product, and the managing, administering, maintaining or servicing of a financial product, and the submittal or processing of any claims associated with a financial product. Product suppliers are requested to kindly give effect to any instructions communicated by Holistic Risk Services (Pty) Ltd.",
        },
        {
          heading: "Client Information",
          text:
            "Holistic Risk Services (Pty) Ltd acknowledges that in the course of rendering financial services, it shall come into possession of information of a confidential nature, and shall not, during or after this appointment, use or disclose any client information except to the extent required by law or permitted by the client in writing. This appointment authorises Holistic Risk Services (Pty) Ltd to obtain any information from a third party in order to determine the client's financial situation, financial product experience and financial objectives, including any information relating to a policy purchased by the client. Product suppliers are requested to kindly furnish Holistic Risk Services (Pty) Ltd with all requested client information.",
        },
        {
          heading: "Commission",
          text:
            "The client agrees to transfer any new commission which may become due during the appointment period to Holistic Risk Services (Pty) Ltd. Product suppliers are requested to kindly transfer any insurance and investment portfolios to Holistic Risk Services (Pty) Ltd's broker code.",
        },
      ],
      // Approved Phase 3 decision: no fixed cancellation notice period — remains in force
      // until cancelled by the client or the provider in writing (already stated in `intro`).
      closing: "",
      ackLabel:
        "I confirm my appointment of Holistic Risk Services (Pty) Ltd as my short-term insurance broker as described above.",
    },
    commercial: {
      intro:
        "The client hereby appoints Holistic Risk Services (Pty) Ltd, represented by the advisor named in this record, as its broker (agent), and confirms that such appointment remains in force until cancelled by the client or the provider in writing.",
      sections: [
        {
          heading: "Financial Services",
          text:
            "The client hereby confirms that Holistic Risk Services (Pty) Ltd is authorised to render financial services on its behalf. Such authorisation includes any instruction to facilitate the buying, selling, termination or replacement of any existing financial product, and the managing, administering, maintaining or servicing of a financial product, and the submittal or processing of any claims associated with a financial product. Product suppliers are requested to kindly give effect to any instructions communicated by Holistic Risk Services (Pty) Ltd.",
        },
        {
          heading: "Client Information",
          text:
            "Holistic Risk Services (Pty) Ltd acknowledges that in the course of rendering financial services, it shall come into possession of information of a confidential nature, and shall not, during or after this appointment, use or disclose any client information except to the extent required by law or permitted by the client in writing. This appointment authorises Holistic Risk Services (Pty) Ltd to obtain any information from a third party in order to determine the client's financial situation, financial product experience and financial objectives, including any information relating to a policy purchased by the client. Product suppliers are requested to kindly furnish Holistic Risk Services (Pty) Ltd with all requested client information.",
        },
        {
          heading: "Commission",
          text:
            "The client agrees to transfer any new commission which may become due during the appointment period to Holistic Risk Services (Pty) Ltd. Product suppliers are requested to kindly transfer any insurance and investment portfolios to Holistic Risk Services (Pty) Ltd's broker code.",
        },
      ],
      closing: "",
      ackLabel:
        "I confirm my appointment of Holistic Risk Services (Pty) Ltd as my short-term insurance broker as described above.",
    },
  },

  brokerFeeConsent: {
    version: "HRS-BROKER-FEE-2026-01",
    important:
      "IMPORTANT: This document only sets out your consent for the payment of broker fees for additional services performed by Holistic Risk Services (Pty) Ltd and does not replace any other disclosures you are entitled to receive in terms of applicable legislation.",
    general:
      `Holistic Risk Services (Pty) Ltd, with FSP number ${HRS_INFO.fspNumber}, provides various services in relation to your short-term policy for, or on behalf of yourself, or on behalf of an insurer, or for acting as an intermediary. For these services Holistic Risk Services (Pty) Ltd is remunerated by way of commission and fees which are either paid by the insurer or yourself. Any commission and fees received are paid in terms of applicable legislation and are disclosed to you.`,
    feesIntro:
      "Broker fees are charged to you for providing additional services for your benefit. Broker fees, like all other fees and commission, will be fully disclosed to you. You may also withdraw consent from us to charge the fee if you do not want to make use of these various services provided. The following are the additional services that we perform in terms of our value proposition to you:",
    additionalServices: [
      "Assistance with rejected claims, including the preparation and submission of applications for goodwill payments",
      "Facilitation of non-insurance value-added products and services",
      "Onsite attendance with assessors as required or deemed necessary",
      "Advice and guidance outside the ambit of regulated financial products",
      "Onsite visits upon client request and at the time of policy renewal",
    ],
    amount:
      "For the additional services set out above, Holistic Risk Services (Pty) Ltd charges the fee disclosed to you under Products & Advice in this record (as a percentage of gross premium or a flat rand amount, inclusive of VAT). The broker fee will be charged monthly for as long as the policy is active.",
    consentIntro: "By ticking the box below, I consent to paying the broker fee for the additional services set out above.",
    ackLabel:
      "I have read and understood the Broker Fee Consent above, and I consent to the payment of the broker (intermediary) fee for the additional services described.",
    // Approved Phase 3 decision: no consent is required, and no consent text is shown as
    // accepted, where the effective broker fee is zero — see src/lib/brokerFee.js.
    noFeeApplicableLabel: "No broker fee applicable.",
  },

  letterOfInvestigation: {
    version: "HRS-LETTER-INVESTIGATION-2026-01",
    // Applies only when changingBroker === 'yes' — see src/lib/brokerFee.js-style
    // conditional-cleanup logic wired into each Principles step.
    personal: {
      paragraphs: [
        "I/We hereby grant Holistic Risk Services (Pty) Ltd full authority to obtain and verify any information regarding my/our short-term insurance policies.",
        "This authority extends to the investigation of: risk details and underwriting information relevant to my/our insurance; personal information necessary for the proper administration of my/our insurance; and claims history, premium records, and any other information material to the insurance relationship.",
        "I/We acknowledge and agree that any changes in respect of risk, underwriting or personal information relevant to the insurance must be disclosed to Holistic Risk Services (Pty) Ltd as soon as possible, and that in the event of any misrepresentation by the client regarding claims, insurance history, premium prejudice, or personal information, Holistic Risk Services (Pty) Ltd shall not be held liable for any damage resulting from such breach of duty.",
        "This serves as formal confirmation of the client's consent for Holistic Risk Services (Pty) Ltd to conduct the necessary investigation and obtain all relevant information from insurers, underwriters or any other parties involved in the administration of the client's short-term insurance.",
      ],
      ackLabel:
        "I grant Holistic Risk Services (Pty) Ltd authority to investigate and obtain the information described above from my previous insurer(s)/broker.",
      questionLabel: "Is HRS taking over as your broker of record from another provider?",
    },
    commercial: {
      paragraphs: [
        "We hereby grant Holistic Risk Services (Pty) Ltd full authority to obtain and verify any information regarding the business's short-term insurance policies.",
        "This authority extends to the investigation of: risk details and underwriting information relevant to the insurance; personal information necessary for the proper administration of the insurance; and claims history, premium records, and any other information material to the insurance relationship.",
        "We acknowledge and agree that any changes in respect of risk, underwriting or personal information relevant to the insurance must be disclosed to Holistic Risk Services (Pty) Ltd as soon as possible, and that in the event of any misrepresentation regarding claims, insurance history, premium prejudice, or information, Holistic Risk Services (Pty) Ltd shall not be held liable for any damage resulting from such breach of duty.",
        "This serves as formal confirmation of the client's consent for Holistic Risk Services (Pty) Ltd to conduct the necessary investigation and obtain all relevant information from insurers, underwriters or any other parties involved in the administration of the business's short-term insurance.",
      ],
      ackLabel:
        "We grant Holistic Risk Services (Pty) Ltd authority to investigate and obtain the information described above from the previous insurer(s)/broker.",
      questionLabel: "Is HRS taking over as the business's broker of record from another provider?",
    },
  },

  // Statutory Disclosure evidence model (Phase 3, section 3 / 8): the general ROA client
  // signature also signs and confirms the Statutory Disclosure. The complete disclosure
  // text is shown in the modal below and made available as a separate download, but is not
  // repeated in full inside the generated ROA PDF — only this concise evidence block is.
  statutoryDisclosure: {
    version: "HRS-STAT-DISC-2026-01",
    title: "Statutory Disclosure",
    // No formal "effective date" is printed inside the approved source document itself
    // (only file metadata, which is not a legal effective date). Per the Phase 3
    // instruction, we therefore label this as the digital-document version date rather
    // than inventing a legal effective date. Update this value (and the version above)
    // only when HRS Compliance issues a new approved Statutory Disclosure.
    digitalVersionDate: "2026-07-29",
    sourceDocumentName: "Statutory Disclosure HRS.pdf",
    sourcePageCount: 3,
    downloadFilename: "HRS-Statutory-Disclosure-HRS-STAT-DISC-2026-01.pdf",
    downloadUrl: "/documents/HRS-Statutory-Disclosure-HRS-STAT-DISC-2026-01.pdf",
    acknowledgementText:
      "I confirm that I have opened, read and understood the complete Statutory Disclosure (Section 13) referred to above.",
    signedUnderGeneralRoaText:
      "This acknowledgement does not require a separate signature. It forms part of, and is confirmed by, the general Record of Advice client signature and declaration in this document.",
    pdfEvidenceIntro:
      "The client reviewed and acknowledged the complete Statutory Disclosure (Section 13) referred to below, available in full as a separate controlled document. This acknowledgement forms part of, and is confirmed by, the general signed Record of Advice declaration and signature — no separate signature is required for the Statutory Disclosure.",
  },

  // Election warning shown when a client elects an alternative course of action
  // (differs from recommendation / not to follow advice / more limited information).
  electionWarning: {
    personal: [
      "Where an analysis is to be performed in any of the circumstances referred to above, the client has been advised accordingly that:",
      "1. There may be limitations on the appropriateness of the advice provided in light of such circumstances.",
      "2. The client should take particular care to consider on his/her own whether the advice is appropriate considering the client's objectives, financial situation and particular needs, particularly any aspects of such objective, situation or needs that were not considered in light of the aforementioned circumstances.",
    ],
    commercial: [
      "Where an analysis is to be performed in any of the circumstances referred to above, the client has been advised accordingly that:",
      "1. There may be limitations on the appropriateness of the advice provided in light of such circumstances.",
      "2. The client should take particular care to consider on its own whether the advice is appropriate considering the business's objectives, financial situation and particular needs, particularly any aspects of such objective, situation or needs that were not considered in light of the aforementioned circumstances.",
    ],
  },

  // Client (and, for Commercial, Advisor) declaration text shown at the Signatures step
  // and reproduced in the generated PDF's Client Declaration section.
  clientDeclaration: {
    personal: {
      acceptTitle: "I hereby accept the advice and recommendations provided to me as set out above.",
      accept:
        "I am aware that the advice and recommendations provided in terms of my request and instruction are limited to my short-term insurance (personal lines) portfolio only, and that a comprehensive analysis of all my financial needs was not undertaken. Due to the fact that a comprehensive analysis was not undertaken, there may be limitations concerning the appropriateness of the advice, and I must therefore carefully consider whether the product selected is appropriate considering my circumstances and needs. Where I have made any of the elections above, I confirm that the advisor has alerted me to the clear existence of any risk as a result of such election, and that I have been advised to take particular care to consider whether the products selected (if any) are appropriate to my needs, objectives and circumstances. I understand the dangers of being underinsured and that excesses under specific policies may be aggregated in certain circumstances — should my circumstances change in any way that may require a review of my existing cover, I will inform the advisor. I have read the policy documents and the attached policy schedule, and note in particular the special conditions and applicable excesses. The advisor explained to me the material terms and conditions of the policy, including any excess payment terms, conditions and exclusions, or circumstances where claims will not be paid. I did not sign the application form while any part of it was incomplete, and I take full responsibility for all information provided in the application form, whether provided by myself or on my behalf. The advisor provided quotes from the insurer which were discussed and attached to this document. I understand that for a new placement, the product selected constitutes a new placement of short-term insurance cover; for a renewal, it constitutes a renewal of my existing cover; and for a replacement, it constitutes a replacement of my existing short-term insurance cover.",
      declineTitle: "I elect NOT to follow the advice and recommendations set out above.",
      decline:
        "I confirm that the advisor has alerted me to the risks of proceeding against the advice and recommendations given, and that I have chosen to proceed on this basis of my own accord.",
      pdfAcceptEvidence: "Client accepts the advice and recommendations set out above.",
      pdfDeclineEvidence: "Client elects NOT to follow the advice and recommendations set out above.",
    },
    commercial: {
      acceptTitle: "We hereby accept the advice and recommendations provided as set out above.",
      accept:
        "We are aware that the advice and recommendations provided are limited to the business's short-term insurance (commercial lines) portfolio only, and that a comprehensive analysis of the business's financial needs was not undertaken. Due to the fact that a comprehensive analysis was not undertaken, there may be limitations concerning the appropriateness of the advice, and we must therefore carefully consider whether the product selected is appropriate considering the business's circumstances and needs. Where any election above was made, we confirm that the advisor has alerted us to the clear existence of any risk as a result of such election. We understand the dangers of being underinsured and that excesses under specific policies may be aggregated in certain circumstances — should our circumstances change in any way that may require a review of our existing cover, we will inform the advisor. We have read the policy documents and the attached policy schedule, and note in particular the special conditions and applicable excesses. The advisor explained the material terms and conditions of the policy, including any excess payment terms, conditions and exclusions, or circumstances where claims will not be paid. We did not sign the application form while any part of it was incomplete, and take full responsibility for all information provided, whether provided by us or on our behalf. The advisor provided quotes from the insurer which were discussed and attached to this document. We understand that for a new placement, the product selected constitutes a new placement of short-term insurance cover; for a renewal, it constitutes a renewal of our existing cover; and for a replacement, it constitutes a replacement of our existing short-term insurance cover.",
      declineTitle: "We elect NOT to follow the advice and recommendations set out above.",
      decline:
        "We confirm that the advisor has alerted us to the risks of proceeding against the advice and recommendations given, and that we have chosen to proceed on this basis of our own accord.",
      pdfAcceptEvidence: "Client accepts the advice and recommendations set out above.",
      pdfDeclineEvidence: "Client elects NOT to follow the advice and recommendations set out above.",
    },
  },

  // Advisor declaration — Commercial only (Personal signatures carry the equivalent
  // statement inline in the signing legal block; unchanged in this phase).
  advisorDeclaration: {
    commercial: {
      adviser:
        "Declaration by the Adviser: I declare that the advice record is an accurate and complete record of the recommendations and advice that I provided the client with, based upon the information provided by the client.",
      client:
        "Declaration by the Client: I acknowledge that as a client, no product provider or FSP may request or induce me to waive any right or benefit conferred on me in terms of the FAIS Act. I confirm having been duly advised and fully understand the course of action I am about to undertake, including the Client Declaration above.",
    },
  },
};

/**
 * Derives the Statutory Disclosure evidence status for Review / PDF display.
 * Deliberately three-state rather than a plain boolean — an unsigned-but-acknowledged
 * record should say "Pending signature", not falsely claim "Yes" or alarm with "No".
 *
 * @param {object} formData
 * @returns {{ version: string, acknowledged: boolean, signatureStatus: 'yes'|'no'|'pending', evidenceLine: string }}
 */
export function getStatutoryDisclosureEvidence(formData) {
  const acknowledged = !!formData?.ackStatutoryDisclosure;
  const hasSignature = !!formData?.clientSig;
  /** @type {'yes'|'no'|'pending'} */
  let signatureStatus = 'no';
  if (acknowledged) signatureStatus = hasSignature ? 'yes' : 'pending';

  let evidenceLine;
  if (!acknowledged) {
    evidenceLine = 'Not yet reviewed and acknowledged by the client.';
  } else if (hasSignature) {
    evidenceLine = 'Reviewed and acknowledged by the client; confirmed under the general signed ROA declaration.';
  } else {
    evidenceLine = 'Reviewed and acknowledged by the client; awaiting the general ROA client signature to confirm.';
  }

  return {
    version: HRS_COMPLIANCE_CONTENT.statutoryDisclosure.version,
    acknowledged,
    signatureStatus,
    evidenceLine,
  };
}

export default HRS_COMPLIANCE_CONTENT;
