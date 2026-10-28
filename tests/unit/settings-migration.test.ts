import { DEFAULT_CHAT_MANDATE_REF } from '@/lib/mandates';
import {
  LEGACY_DEFAULT_CHAT_MANDATE_REF,
  SETTINGS_PERSIST_VERSION,
  migrateDefaultBrowserAgent,
} from '@/lib/settings/migrate';
import { describe, expect, it } from 'vitest';

describe('default browser agent settings migration', () => {
  it.each([null, undefined, LEGACY_DEFAULT_CHAT_MANDATE_REF])(
    'moves an untouched v3 default (%s) to the browser Mandate',
    (defaultAgentId) => {
      expect(migrateDefaultBrowserAgent({ defaultAgentId }, 3)).toEqual({
        defaultAgentId: DEFAULT_CHAT_MANDATE_REF,
      });
    },
  );

  it('preserves an explicit user-selected agent', () => {
    const saved = { defaultAgentId: 'user-agent-id' };
    expect(migrateDefaultBrowserAgent(saved, 3)).toEqual(saved);
  });

  it('does not rewrite settings already at the current version', () => {
    const saved = { defaultAgentId: DEFAULT_CHAT_MANDATE_REF };
    expect(migrateDefaultBrowserAgent(saved, SETTINGS_PERSIST_VERSION)).toBe(saved);
  });
});

describe('v4 → v5: the retired agentScopes key', () => {
  // The Mine/Shared/System scope pills were this repo's own hand-rolled picker.
  // @ai-matrx/agents/catalog owns tabs and filters now, per consumer id, so the
  // persisted key has no reader — and a key with no reader that stays in
  // chrome.storage is dead data the next agent will mistake for state.
  it('deletes agentScopes from an untouched install', () => {
    const migrated = migrateDefaultBrowserAgent({ defaultAgentId: null, agentScopes: ['mine'] }, 3);
    expect('agentScopes' in migrated).toBe(false);
    expect(migrated.defaultAgentId).toBe(DEFAULT_CHAT_MANDATE_REF);
  });

  it('deletes agentScopes without touching an explicit agent choice', () => {
    const migrated = migrateDefaultBrowserAgent(
      { defaultAgentId: 'user-agent-id', agentScopes: ['mine', 'shared'] },
      4,
    );
    expect('agentScopes' in migrated).toBe(false);
    expect(migrated.defaultAgentId).toBe('user-agent-id');
  });
});

it.each([
  {
    state: { defaultAgentId: null, defaultPermissionMode: 'ask' },
    expected: { defaultAgentId: null },
  },
  { state: { defaultPermissionMode: 'act' }, expected: {} },
  {
    state: { defaultAgentId: DEFAULT_CHAT_MANDATE_REF, defaultPermissionMode: 'ask' },
    expected: { defaultAgentId: DEFAULT_CHAT_MANDATE_REF },
  },
  {
    state: { defaultAgentId: 'chosen-agent', defaultPermissionMode: 'act' },
    expected: { defaultAgentId: 'chosen-agent' },
  },
])('v6 retirement preserves the existing agent choice', ({ state, expected }) => {
  expect(migrateDefaultBrowserAgent(state, 6)).toEqual(expected);
});
