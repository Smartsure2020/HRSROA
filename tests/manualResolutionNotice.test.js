// The alert a broker sees against a request that automation could not cancel safely.
// Rendered for real (react-dom/server) so the wording and the "show nothing otherwise"
// behaviour are verified, not just compiled.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ManualResolutionNotice from '../src/components/hrs/ManualResolutionNotice.jsx';

const render = (reason) => renderToStaticMarkup(createElement(ManualResolutionNotice, { reason }));

describe('ManualResolutionNotice', () => {
  it('renders nothing when no manual resolution is pending', () => {
    for (const reason of [null, undefined, '']) expect(render(reason)).toBe('');
  });

  it.each([
    ['audit_backup_unavailable', /audit trail could not be preserved/],
    ['envelope_missing_unexplained', /no longer has it and the system did not cancel it/],
    ['delete_not_dispatched', /had not yet asked for it to be cancelled/],
    ['delete_unacknowledged', /never confirmed that it was cancelled/],
  ])('%s: an alert that says what happened and that the replacement has not been sent', (reason, wording) => {
    const html = render(reason);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Manual resolution required.');
    expect(html).toMatch(wording);
    expect(html).toContain('has not been sent');
    expect(html).toContain('Contact HRS compliance');
    expect(html).not.toContain(reason); // never shows the raw code
  });

  it('still shows a safe message for a reason this build does not know', () => {
    const html = render('something_new');
    expect(html).toContain('cannot be cancelled safely by the system');
    expect(html).not.toContain('something_new');
  });
});
