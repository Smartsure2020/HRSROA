// Amend ROA — wizard prefill (Issue #8).
//
// The amendment editor opens the EXISTING Personal / Commercial wizard pre-populated from
// the owner's frozen source snapshot (fetched from the server by the owner only) — never
// from a PDF. The snapshot is merged into today's form defaults, so:
//
//   • fields added to the form since the original was submitted take their current defaults;
//   • deprecated / unknown keys are dropped (and reported, never silently kept);
//   • no signature or local-evidence data can come across (the snapshot never holds any,
//     and `sanitiseDraftFormData` strips it again defensively);
//   • the shared conditional-cleanup invariants are re-applied, so stale child answers
//     cannot resurface.
//
// The prefilled data is an ordinary draft: the broker re-validates every step and a NEW
// canonical PDF is generated on submit. Nothing here touches the original submission.

import { getInitialFormData } from './hrsConstants';
import { getCommercialInitialFormData } from './hrsCommercialConstants';
import { normaliseFormData, sanitiseDraftFormData } from './roaDraftStorage';

const FLOW_FOR_TYPE = Object.freeze({ Personal: 'personal', Commercial: 'commercial' });

export function flowTypeForRoaType(roaType) {
  const flow = FLOW_FOR_TYPE[roaType];
  if (!flow) throw new Error(`Unsupported ROA type ${JSON.stringify(roaType)}`);
  return flow;
}

/**
 * @param {'Personal'|'Commercial'} roaType
 * @param {object} snapshot  the frozen source snapshot (from the owner-only amendment read)
 * @param {{ brokerName?: string }} [options]  authenticated broker's name, used only if the
 *   snapshot carries none
 * @returns {{ formData: object, droppedKeys: string[], warnings: string[] }}
 */
export function prefillFormDataFromSnapshot(roaType, snapshot, { brokerName } = {}) {
  const flowType = flowTypeForRoaType(roaType);
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('A frozen snapshot is required to amend an ROA');
  }

  const initial = flowType === 'commercial' ? getCommercialInitialFormData() : getInitialFormData();
  const source = sanitiseDraftFormData(snapshot);
  const droppedKeys = Object.keys(source).filter((key) => !(key in initial));

  const formData = normaliseFormData(flowType, source);
  if (!formData.brokerName && brokerName) formData.brokerName = brokerName;

  // A structured answer whose shape changed since the original (for example the list of
  // risk categories) cannot be carried over safely; flag it so the broker reviews it.
  const warnings = [];
  for (const key of Object.keys(initial)) {
    const before = source[key];
    if (Array.isArray(initial[key]) && Array.isArray(before) && before.length !== initial[key].length) {
      warnings.push(`${key}_shape_changed`);
    }
  }

  return { formData, droppedKeys, warnings };
}
