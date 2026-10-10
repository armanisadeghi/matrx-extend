import { buildBrowserDomState } from '@/lib/chat/build-browser-dom-state';
import { useChatStore } from '@/state/chat';
import { usePilotChatStore } from '@/state/pilot-chat';
import { useSettingsStore } from '@/state/settings';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/flow', () => ({ getAccessToken: async () => null }));
vi.mock('@/lib/permissions/optional', () => ({
  ALL_OPTIONAL: [],
  hasOptionalPermissions: async () => false,
}));

// A property manager can keep Assistant in Ask while Pilot acts on maintenance
// requests. The backend discovery payload must honor each surface's own chip.
describe('browser DOM permission mode by surface', () => {
  beforeEach(() => {
    Object.assign(chrome, {
      tabs: { query: async () => [] },
      permissions: { getAll: async () => ({ permissions: ['debugger', 'storage'] }) },
      runtime: { id: 'maintenance-extension', getManifest: () => ({ version: '0.2.1' }) },
    });
  });
  afterEach(() => {
    useChatStore.setState({ selectedAgentId: null, permissionMode: {} });
    usePilotChatStore.setState({ selectedAgentId: null, permissionMode: {} });
    useSettingsStore.setState({ defaultPermissionMode: 'ask' });
  });

  it.each(['ask', 'act'] as const)(
    'Pilot advertises its %s mode when Assistant disagrees',
    async (mode) => {
      useChatStore.setState({
        selectedAgentId: 'maintenance-agent',
        permissionMode: { 'maintenance-agent': mode === 'ask' ? 'act' : 'ask' },
      });
      usePilotChatStore.setState({
        selectedAgentId: 'maintenance-agent',
        permissionMode: { 'maintenance-agent': mode },
      });
      for (const agentId of ['maintenance-agent', undefined]) {
        const state = await buildBrowserDomState({
          surface: 'pilot',
          activeTab: null,
          pageLang: null,
          ...(agentId !== undefined && { agentId }),
        });
        expect(state.permission_mode).toBe(mode);
      }
    },
  );

  it('Assistant advertises its default while Pilot keeps its independent default', async () => {
    useSettingsStore.setState({ defaultPermissionMode: 'ask' });
    const assistant = await buildBrowserDomState({
      surface: 'assistant',
      activeTab: null,
      pageLang: null,
    });
    const pilot = await buildBrowserDomState({ surface: 'pilot', activeTab: null, pageLang: null });
    expect(assistant.permission_mode).toBe('ask');
    expect(pilot.permission_mode).toBe('act');
  });
});

it('advertises held required and optional permissions without inventing absent grants', async () => {
  Object.assign(chrome, {
    permissions: { getAll: async () => ({ permissions: ['debugger', 'tabs', 'cookies'] }) },
  });
  const state = await buildBrowserDomState({
    surface: 'assistant',
    activeTab: null,
    pageLang: null,
  });
  expect(state.optional_permissions_granted).toEqual(['debugger', 'tabs', 'cookies']);
  expect(state.optional_permissions_granted).not.toContain('clipboardRead');
});
