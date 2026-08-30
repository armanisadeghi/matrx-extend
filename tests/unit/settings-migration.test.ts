import { DEFAULT_CHAT_MANDATE_REF } from '@/lib/mandates';
import {
  LEGACY_DEFAULT_CHAT_MANDATE_REF,
  migrateDefaultBrowserAgent,
} from '@/lib/settings/migrate';
import { describe, expect, it } from 'vitest';

describe('default browser agent settings migration', () => {
  it.each([null, undefined, LEGACY_DEFAULT_CHAT_MANDATE_REF])(
    'moves an untouched v3 default (%s) to the browser Mandate and System scope',
    (defaultAgentId) => {
      expect(migrateDefaultBrowserAgent({ defaultAgentId, agentScopes: ['mine'] }, 3)).toEqual({
        defaultAgentId: DEFAULT_CHAT_MANDATE_REF,
        agentScopes: ['system'],
      });
    },
  );

  it('preserves an explicit user-selected agent and scope filters', () => {
    const saved = { defaultAgentId: 'user-agent-id', agentScopes: ['mine', 'shared'] };
    expect(migrateDefaultBrowserAgent(saved, 3)).toBe(saved);
  });

  it('does not rewrite already-migrated settings', () => {
    const saved = { defaultAgentId: DEFAULT_CHAT_MANDATE_REF, agentScopes: ['system'] };
    expect(migrateDefaultBrowserAgent(saved, 4)).toBe(saved);
  });
});
