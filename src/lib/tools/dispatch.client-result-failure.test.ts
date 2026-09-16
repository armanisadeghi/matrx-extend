import { describe, expect, it } from 'vitest';

import { clientResultFailureMessage } from './dispatch';

describe('clientResultFailureMessage', () => {
  it('routes an explicit client failure through the error channel', () => {
    expect(clientResultFailureMessage({ ok: false, error: 'capture_failed' })).toBe(
      'Tool reported failure: capture_failed.',
    );
  });

  it('does not misclassify a successful payload which happens to name an error', () => {
    expect(clientResultFailureMessage({ ok: true, error: 'historical_value' })).toBeNull();
    expect(clientResultFailureMessage({ error: 'not-an-envelope' })).toBeNull();
  });

  it('does not surface arbitrary failure detail into the tool-result channel', () => {
    expect(
      clientResultFailureMessage({
        ok: false,
        error: 'CAPTURE FAILED: sensitive detail',
        message: { sensitive: 'do not project this' },
      }),
    ).toBe('Tool reported a failure.');
  });
});
