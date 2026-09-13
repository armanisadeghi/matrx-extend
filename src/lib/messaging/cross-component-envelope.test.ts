import { describe, expect, it } from 'vitest';
import { CrossComponentEnvelopeSchema } from './cross-component-envelope';

/**
 * Pins the wire shape the aidream publisher actually sends. Found 2026-09-12
 * in the web client: `.optional()` on toInstance rejected every server
 * broadcast as not_an_envelope because Python serialises an explicit null.
 * The extension carried the same class; this test keeps it closed.
 */
describe('CrossComponentEnvelopeSchema — the real server broadcast', () => {
  const realDirective = {
    v: 2,
    kind: 'directive',
    direction: 'server->client',
    action: 'settings_changed',
    requestId: 'req-1',
    payload: { feature: 'meet', key: 'guest_join_enabled', scope_kind: 'organization' },
    timestamp: 1_757_700_000_000,
    fromInstance: { component: 'aidream', instanceId: 'aidream-f825458b' },
    toInstance: null,
  };

  it('accepts a directive with an explicit null toInstance', () => {
    const parsed = CrossComponentEnvelopeSchema.safeParse(realDirective);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.kind).toBe('directive');
      expect(parsed.data.toInstance ?? undefined).toBeUndefined();
    }
  });

  it('still rejects an envelope with no action', () => {
    const { action: _drop, ...broken } = realDirective;
    expect(CrossComponentEnvelopeSchema.safeParse(broken).success).toBe(false);
  });
});
