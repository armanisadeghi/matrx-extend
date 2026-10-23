import { buildBrowserDomState } from '@/lib/chat/build-browser-dom-state';
import { useChatStore } from '@/state/chat';
import { usePilotChatStore } from '@/state/pilot-chat';
import { useSettingsStore } from '@/state/settings';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const knob = vi.hoisted(() => ({ mode: 'ask' as 'ask' | 'act' }));
vi.mock('@/lib/settings/act-without-asking', () => ({
  readActMode: () => knob.mode,
  writeActMode: async () => ({ ok: true }),
}));

vi.mock('@/lib/auth/flow', () => ({ getAccessToken: async () => null }));
vi.mock('@/lib/permissions/optional', () => ({
  ALL_OPTIONAL: [],
  hasOptionalPermissions: async () => false,
}));

// The two surfaces share the person's platform setting; old per-agent values
// must not make the backend advertise a different permission mode.
describe('browser DOM shared permission mode', () => {
  beforeEach(() => {
    Object.assign(chrome, {
      tabs: { query: async () => [] },
      permissions: { getAll: async () => ({ permissions: ['debugger', 'storage'] }) },
      runtime: { id: 'maintenance-extension', getManifest: () => ({ version: '0.2.1' }) },
    });
  });
  afterEach(() => {
    knob.mode = 'ask';
    useChatStore.setState({ selectedAgentId: null, permissionMode: {} });
    usePilotChatStore.setState({ selectedAgentId: null, permissionMode: {} });
    useSettingsStore.setState({ defaultPermissionMode: 'ask' });
  });

  it.each(['ask', 'act'] as const)(
    'both surfaces advertise the shared %s mode despite stale per-agent values',
    async (mode) => {
      knob.mode = mode;
      useChatStore.setState({
        selectedAgentId: 'maintenance-agent',
        permissionMode: { 'maintenance-agent': mode === 'ask' ? 'act' : 'ask' },
      });
      usePilotChatStore.setState({
        selectedAgentId: 'maintenance-agent',
        permissionMode: { 'maintenance-agent': mode },
      });
      const assistant = await buildBrowserDomState({
        surface: 'assistant',
        activeTab: null,
        pageLang: null,
        agentId: 'maintenance-agent',
      });
      const pilot = await buildBrowserDomState({
        surface: 'pilot',
        activeTab: null,
        pageLang: null,
        agentId: 'maintenance-agent',
      });
      expect(assistant.permission_mode).toBe(mode);
      expect(pilot.permission_mode).toBe(mode);
    },
  );

  it('ignores the old Settings default when advertising the platform setting', async () => {
    knob.mode = 'act';
    useSettingsStore.setState({ defaultPermissionMode: 'ask' });
    const assistant = await buildBrowserDomState({
      surface: 'assistant',
      activeTab: null,
      pageLang: null,
    });
    const pilot = await buildBrowserDomState({ surface: 'pilot', activeTab: null, pageLang: null });
    expect(assistant.permission_mode).toBe('act');
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

it.each(['Summarizer', 'Translator', 'LanguageDetector', 'Proofreader', 'Writer', 'Rewriter'])(
  'advertises a dedicated %s global without LanguageModel',
  async (api) => {
    const globals = globalThis as Record<string, unknown>;
    const prior = Object.getOwnPropertyDescriptor(globalThis, api);
    const priorLanguageModel = Object.getOwnPropertyDescriptor(globalThis, 'LanguageModel');
    const priorAi = Object.getOwnPropertyDescriptor(globalThis, 'ai');
    Object.defineProperty(globalThis, 'LanguageModel', { configurable: true, value: undefined });
    Object.defineProperty(globalThis, 'ai', { configurable: true, value: undefined });
    Object.defineProperty(globalThis, api, {
      configurable: true,
      value: { availability: () => 'available' },
    });
    try {
      const state = await buildBrowserDomState({
        surface: 'assistant',
        activeTab: null,
        pageLang: null,
      });
      expect(state.onbox_ai_available).toBe(true);
    } finally {
      if (prior) Object.defineProperty(globalThis, api, prior);
      else delete globals[api];
      if (priorLanguageModel)
        Object.defineProperty(globalThis, 'LanguageModel', priorLanguageModel);
      else delete globals.LanguageModel;
      if (priorAi) Object.defineProperty(globalThis, 'ai', priorAi);
      else delete globals.ai;
    }
  },
);
