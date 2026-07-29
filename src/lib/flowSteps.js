/**
 * Authoritative wizard configuration. The page renderers, progress indicators,
 * and navigation labels all derive from these arrays so a conditional flow
 * cannot display a label from a different step order.
 */
export const PERSONAL_STEPS = [
  { id: 'client-details', label: 'Client Details', action: 'next' },
  { id: 'insurance-history', label: 'Insurance History', action: 'next' },
  { id: 'products-advice', label: 'Products & Advice', action: 'next' },
  { id: 'risk-categories', label: 'Risk Categories', action: 'next' },
  { id: 'principles-disclosures', label: 'Principles & Disclosures', action: 'next' },
  { id: 'banking', label: 'Banking & Debit Order', action: 'next' },
  { id: 'signatures', label: 'Signatures', action: 'next' },
  { id: 'review', label: 'Review', action: 'review' },
];

export const COMMERCIAL_STEPS = [
  { id: 'client-details', label: 'Client Details', action: 'next' },
  { id: 'insurance-history', label: 'Insurance History', action: 'next' },
  { id: 'products-advice', label: 'Products & Advice', action: 'next' },
  { id: 'replacement-policy', label: 'Replacement Policy', action: 'next' },
  { id: 'principles-disclosures', label: 'Principles & Disclosures', action: 'next' },
  { id: 'risk-categories', label: 'Risk Categories', action: 'next' },
  { id: 'signatures', label: 'Signatures', action: 'next' },
  { id: 'review', label: 'Review', action: 'submit' },
];

export function getActiveSteps(steps, formData = {}) {
  // Replacement is a documented step even when the answer is "No"; the step
  // communicates that the section was considered and explicitly not applicable.
  return steps.filter(Boolean).map((step) => ({ ...step, shortLabel: step.label }));
}

export function getNextStep(steps, currentStepId, formData = {}) {
  const activeSteps = getActiveSteps(steps, formData);
  const currentIndex = activeSteps.findIndex((step) => step.id === currentStepId);
  return currentIndex >= 0 ? activeSteps[currentIndex + 1] || null : null;
}

export function getNextButtonText(steps, currentStepId, formData = {}) {
  const current = getActiveSteps(steps, formData).find((step) => step.id === currentStepId);
  const nextStep = getNextStep(steps, currentStepId, formData);
  if (!nextStep) {
    if (current?.action === 'submit') return 'Submit Advice Record';
    if (current?.action === 'review') return 'Review Advice Record';
    return 'Finish';
  }
  return `Next: ${nextStep.label}`;
}

export function getStepId(steps, index, formData = {}) {
  return getActiveSteps(steps, formData)[index]?.id || null;
}

export function getStepIndex(steps, stepId, formData = {}) {
  return getActiveSteps(steps, formData).findIndex((step) => step.id === stepId);
}
