import { describe, expect, it } from 'vitest';
import { mandateKeyOf } from './agents/use-agent-row';
import {
  DEFAULT_CHAT_MANDATE_KEY,
  DEFAULT_CHAT_MANDATE_REF,
  mandateKeyFromAgentRef,
} from './mandates';

describe('the `mandate:` ref parser', () => {
  it('returns the key inside a ref, typed but never narrowed to this build’s key set', () => {
    expect(mandateKeyFromAgentRef(DEFAULT_CHAT_MANDATE_REF)).toBe(DEFAULT_CHAT_MANDATE_KEY);
    // A key declared after this build shipped is still routed to the mandate door;
    // the server, not this snapshot, decides whether it exists.
    expect(mandateKeyFromAgentRef('mandate:app.some_user_app')).toBe('app.some_user_app');
  });

  it('returns null for anything that is not a non-empty ref', () => {
    expect(mandateKeyFromAgentRef('8f14e45f-ceea-467a-9c7b-4b1f0c2a9d10')).toBeNull();
    expect(mandateKeyFromAgentRef('mandate:')).toBeNull();
    expect(mandateKeyFromAgentRef(null)).toBeNull();
    expect(mandateKeyFromAgentRef(undefined)).toBeNull();
  });

  it('has exactly one implementation: mandateKeyOf agrees on every input', () => {
    for (const input of [
      DEFAULT_CHAT_MANDATE_REF,
      'mandate:app.x',
      'mandate:',
      'agent-id',
      null,
      undefined,
    ]) {
      expect(mandateKeyOf(input)).toBe(mandateKeyFromAgentRef(input));
    }
  });
});
