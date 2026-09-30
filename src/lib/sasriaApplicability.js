export const SASRIA_CLASSES = Object.freeze({
  MATERIAL_DAMAGE: 'material_damage',
  BUSINESS_INTERRUPTION: 'business_interruption',
  MOTOR: 'motor',
  MONEY: 'money',
  GOODS_IN_TRANSIT: 'goods_in_transit',
  CONSTRUCTION: 'construction',
  CONDITIONAL: 'conditional',
});

export const SASRIA_CLASS_LABELS = Object.freeze({
  [SASRIA_CLASSES.MATERIAL_DAMAGE]: 'Material damage',
  [SASRIA_CLASSES.BUSINESS_INTERRUPTION]: 'Business interruption',
  [SASRIA_CLASSES.MOTOR]: 'Motor',
  [SASRIA_CLASSES.MONEY]: 'Money',
  [SASRIA_CLASSES.GOODS_IN_TRANSIT]: 'Goods in transit',
  [SASRIA_CLASSES.CONSTRUCTION]: 'Construction',
  [SASRIA_CLASSES.CONDITIONAL]: 'Conditional / adviser review',
});

export function isSasriaApplicable(category) {
  return Boolean(category?.sasriaClass);
}

export function getCoveredSasriaClasses(categories, riskState = []) {
  const rows = Array.isArray(riskState) ? riskState : [];
  return [...new Set(categories
    .map((category, index) => rows[index]?.cover === 'yes' ? category.sasriaClass : null)
    .filter(Boolean))];
}

export function isSasriaConfirmed(category, riskState, includedClasses = []) {
  return riskState?.cover === 'yes'
    && isSasriaApplicable(category)
    && Array.isArray(includedClasses)
    && includedClasses.includes(category.sasriaClass);
}

/**
 * Normalises legacy row-level `sasria` draft state into class-level selections,
 * removes stale selections, and keeps the two concepts explicit:
 * applicability belongs to the category; confirmation belongs to the advice.
 */
export function normaliseSasriaSelection(formData, categories) {
  if (!formData || !Array.isArray(categories)) return formData;
  const riskState = Array.isArray(formData.riskState) ? formData.riskState : [];
  const coveredClasses = getCoveredSasriaClasses(categories, riskState);
  const selected = new Set(Array.isArray(formData.sasriaIncludedClasses)
    ? formData.sasriaIncludedClasses
    : []);

  riskState.forEach((row, index) => {
    if (row?.sasria === true && row.cover === 'yes' && categories[index]?.sasriaClass) {
      selected.add(categories[index].sasriaClass);
    }
  });

  const nextClasses = [...selected].filter((value) => coveredClasses.includes(value));
  const nextRiskState = riskState.map((row) => {
    if (!row || typeof row !== 'object' || !Object.hasOwn(row, 'sasria')) return row;
    const { sasria: _legacy, ...rest } = row;
    return rest;
  });

  const unchangedClasses = Array.isArray(formData.sasriaIncludedClasses)
    && formData.sasriaIncludedClasses.length === nextClasses.length
    && formData.sasriaIncludedClasses.every((value, index) => value === nextClasses[index]);
  const unchangedRows = nextRiskState.every((row, index) => row === riskState[index]);
  if (unchangedClasses && unchangedRows) return formData;
  return { ...formData, riskState: nextRiskState, sasriaIncludedClasses: nextClasses };
}
