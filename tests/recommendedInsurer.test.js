import { describe, expect, it } from 'vitest';
import {
  applyOption3Insurer,
  isRecommendedInsurerLinked,
} from '../src/lib/recommendedInsurer.js';
import StepProductsAdvice from '../src/components/hrs/steps/StepProductsAdvice.jsx';
import CommercialStepProductsAdvice from '../src/components/hrs/commercial/steps/CommercialStepProductsAdvice.jsx';

// Finds the Option 3 card's insurer change handler in the rendered element tree
// of each real step component (both are hook-free, so they can be invoked directly).
function findOption3Handler(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findOption3Handler(child);
      if (found) return found;
    }
    return null;
  }
  if (node.props?.number === 3 && typeof node.props.onInsChange === 'function') {
    return node.props.onInsChange;
  }
  return findOption3Handler(node.props?.children);
}

function findRecInsurerInput(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findRecInsurerInput(child);
      if (found) return found;
    }
    return null;
  }
  if (node.props?.placeholder?.startsWith('e.g. Stratsys / Holistic') && node.props.onChange) {
    return node.props.onChange;
  }
  return findRecInsurerInput(node.props?.children);
}

const STEPS = [
  ['Personal', StepProductsAdvice],
  ['Commercial', CommercialStepProductsAdvice],
];

describe('recommended insurer auto-link (pure helper)', () => {
  it('auto-populates a blank recInsurer from ins2', () => {
    const next = applyOption3Insurer({ ins2: '', recInsurer: '' }, 'Santam');
    expect(next).toMatchObject({ ins2: 'Santam', recInsurer: 'Santam' });
  });

  it('keeps following ins2 while still auto-linked', () => {
    let data = applyOption3Insurer({ ins2: '', recInsurer: '' }, 'San');
    data = applyOption3Insurer(data, 'Santam');
    data = applyOption3Insurer(data, 'Santam Commercial');
    expect(data.recInsurer).toBe('Santam Commercial');
  });

  it('never overwrites a deliberate manual override', () => {
    const data = { ins2: 'Santam', recInsurer: 'Stratsys / Smartsure' };
    expect(isRecommendedInsurerLinked(data)).toBe(false);
    const next = applyOption3Insurer(data, 'Outsurance');
    expect(next).toMatchObject({ ins2: 'Outsurance', recInsurer: 'Stratsys / Smartsure' });
  });

  it('treats whitespace-only recInsurer as blank and ignores trailing spaces', () => {
    expect(isRecommendedInsurerLinked({ ins2: 'A', recInsurer: '   ' })).toBe(true);
    expect(isRecommendedInsurerLinked({ ins2: 'A ', recInsurer: 'A' })).toBe(true);
  });

  it('does not touch the single-source recommended premium or any other field', () => {
    const data = { ins2: '', prem2: '1980', recInsurer: '', recReasons: 'x' };
    expect(applyOption3Insurer(data, 'Santam')).toEqual({
      ins2: 'Santam', prem2: '1980', recInsurer: 'Santam', recReasons: 'x',
    });
  });

  it('does not mutate its input', () => {
    const data = Object.freeze({ ins2: '', recInsurer: '' });
    expect(() => applyOption3Insurer(data, 'Santam')).not.toThrow();
  });
});

describe.each(STEPS)('%s Products & Advice wiring', (_name, Step) => {
  function render(data) {
    const calls = [];
    const tree = Step({ data, onChange: (d) => calls.push(d), onNext() {}, onPrev() {} });
    return { tree, calls };
  }

  it('Option 3 insurer entry populates a blank Recommended Insurer', () => {
    const { tree, calls } = render({ ins2: '', recInsurer: '' });
    findOption3Handler(tree)('Santam');
    expect(calls.at(-1)).toMatchObject({ ins2: 'Santam', recInsurer: 'Santam' });
  });

  it('changing Option 3 updates Recommended Insurer while still linked', () => {
    const { tree, calls } = render({ ins2: 'Santam', recInsurer: 'Santam' });
    findOption3Handler(tree)('Outsurance');
    expect(calls.at(-1)).toMatchObject({ ins2: 'Outsurance', recInsurer: 'Outsurance' });
  });

  it('a manual Recommended Insurer override survives later Option 3 edits', () => {
    const { tree, calls } = render({ ins2: 'Santam', recInsurer: 'Stratsys' });
    findOption3Handler(tree)('Outsurance');
    expect(calls.at(-1)).toMatchObject({ ins2: 'Outsurance', recInsurer: 'Stratsys' });
  });

  it('editing Recommended Insurer directly only changes recInsurer', () => {
    const { tree, calls } = render({ ins2: 'Santam', recInsurer: 'Santam' });
    findRecInsurerInput(tree)('Stratsys');
    expect(calls.at(-1)).toMatchObject({ ins2: 'Santam', recInsurer: 'Stratsys' });
  });
});
