/**
 * The package chat's settings register: without it every knob is "not answered" and the composer's
 * quick-start chips stay skeletons. Reads come from the extension's one platform-settings snapshot.
 */
import { describe, expect, it, vi } from 'vitest';

const resolve = vi.fn(async (key: string) =>
  key === 'agents.chat_composer.quick_actions' ? [1] : undefined,
);
vi.mock('@/lib/settings/platform-knobs', () => ({
  peekPlatformKnob: (k: string) => (k === 'agents.chat_composer.quick_actions' ? [1] : undefined),
  platformKnobsVersion: () => 0,
  resolvePlatformKnob: (k: string) => resolve(k),
  subscribePlatformKnobs: () => () => undefined,
  warmPlatformKnobs: async () => undefined,
}));

import { extensionKnobs } from './knobs';

describe('extension knobs port', () => {
  it('answers a knob by its { feature, key } pair and by its dotted form', async () => {
    const ref = { feature: 'agents.chat_composer', key: 'quick_actions' };
    expect(extensionKnobs.peekSession(ref)).toEqual([1]);
    expect(extensionKnobs.peekSession('agents.chat_composer.quick_actions')).toEqual([1]);
    expect(await extensionKnobs.ensure(null, null, ref)).toEqual([1]);
  });

  it('refuses a write honestly instead of pretending it saved', async () => {
    const result = await extensionKnobs.setOverride({
      feature: 'a',
      key: 'b',
      scopeKind: 'user',
      scopeId: 'x',
      organizationId: 'o',
      value: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});
