import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  config: null as { matches?: unknown; allFrames?: unknown; runAt?: unknown; main?: () => void } | null,
  registryMounts: 0,
  inlineMounts: 0,
}));

vi.mock('wxt/utils/define-content-script', () => ({
  defineContentScript: (config: typeof state.config) => {
    state.config = config;
    return config;
  },
}));
vi.mock('@/lib/credentials/generation-targets', () => ({
  mountGenerationTargetRegistry: () => { state.registryMounts += 1; },
}));
vi.mock('@/lib/credentials/inline-suggestions', () => ({
  mountInlineCredentialSuggestions: () => { state.inlineMounts += 1; },
}));

const topDescriptor = Object.getOwnPropertyDescriptor(window, 'top');
const setTop = (value: Window) => Object.defineProperty(window, 'top', { configurable: true, value });

afterEach(() => {
  state.config = null;
  state.registryMounts = 0;
  state.inlineMounts = 0;
  if (topDescriptor) Object.defineProperty(window, 'top', topDescriptor);
  vi.resetModules();
});

describe('credential child-frame entrypoint', () => {
  it('registers only the small credential content script for every http(s) frame', async () => {
    await import('@/entrypoints/credential-frame.content');
    expect(state.config).toMatchObject({
      matches: ['http://*/*', 'https://*/*'],
      allFrames: true,
      runAt: 'document_idle',
    });
  });

  it('does nothing in the top frame and mounts only registry plus inline assistance in a child', async () => {
    await import('@/entrypoints/credential-frame.content');
    expect(state.config?.main).toBeTypeOf('function');
    setTop(window);
    state.config?.main?.();
    await Promise.resolve();
    expect(state.registryMounts).toBe(0);
    expect(state.inlineMounts).toBe(0);

    setTop({} as Window);
    state.config?.main?.();
    expect(state.registryMounts).toBe(1);
    await vi.waitFor(() => expect(state.inlineMounts).toBe(1));
  });
});
