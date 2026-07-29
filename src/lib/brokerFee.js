// Shared broker-fee helper (Phase 3, section 7).
//
// Approved business rule: Broker Fee Consent is not required where the broker fee is zero.
// This is the single place that decides whether a fee is "applicable" and what it costs,
// so validation, the Principles/Broker-Fee step, Review, both PDFs and the CRM mapping all
// agree with each other.
//
// formData fields consumed (unchanged from the existing schema — not renamed):
//   - brokerFeeType:   'percent' | 'fixed'
//   - brokerFeePercent: the entered numeric value (a percentage OR a fixed rand amount,
//                        depending on brokerFeeType — this is the existing field name)
//   - prem2:           recommended premium, used as the base for percentage calculations

function toNumberOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {object} formData
 * @returns {{
 *   type: 'percent'|'fixed'|'none',
 *   enteredValue: number,
 *   calculatedAmount: number,
 *   consentRequired: boolean,
 *   isInvalid: boolean,
 *   displayValue: string,
 * }}
 */
export function getBrokerFeeSummary(formData) {
  const type = formData?.brokerFeeType === 'fixed' ? 'fixed' : 'percent';
  const rawEntered = formData?.brokerFeePercent;
  const netPremium = toNumberOrNull(formData?.prem2) || 0;

  const isBlank = rawEntered === '' || rawEntered === null || rawEntered === undefined;
  const parsed = toNumberOrNull(rawEntered);
  // Non-numeric input or a negative value is invalid; a blank field simply means no fee.
  const isInvalid = !isBlank && (parsed === null || parsed < 0);

  let calculatedAmount = 0;
  if (!isBlank && !isInvalid) {
    calculatedAmount = type === 'fixed' ? parsed : (netPremium * parsed) / 100;
  }
  // Round to cents so floating-point noise never leaves a near-zero fee looking "positive".
  calculatedAmount = Math.round((calculatedAmount + Number.EPSILON) * 100) / 100;
  if (calculatedAmount < 0) calculatedAmount = 0;

  const consentRequired = !isInvalid && calculatedAmount > 0;
  const effectiveType = isInvalid || calculatedAmount <= 0 ? 'none' : type;

  let displayValue;
  if (isInvalid) {
    displayValue = 'Invalid fee value';
  } else if (calculatedAmount <= 0) {
    displayValue = 'No broker fee applicable';
  } else if (type === 'fixed') {
    displayValue = `R ${calculatedAmount.toFixed(2)}`;
  } else {
    displayValue = `${parsed}% (R ${calculatedAmount.toFixed(2)})`;
  }

  return {
    type: effectiveType,
    enteredValue: isBlank || isInvalid ? 0 : parsed,
    calculatedAmount,
    consentRequired,
    isInvalid,
    displayValue,
  };
}

/** "No broker fee applicable." shown consistently in Review, PDF and the fee-consent step. */
export const NO_BROKER_FEE_LABEL = 'No broker fee applicable.';
