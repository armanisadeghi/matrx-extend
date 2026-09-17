import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const badgeWrites: Array<{ tabId: number; text: string }> = [];
const titleWrites: Array<{ tabId: number; title: string }> = [];
const tabs = [{ id: 7 }, { id: 8 }];
let badgeGate: Promise<void> | null = null;
let tabsGate: Promise<void> | null = null;
let listener:
  | ((
      message: unknown,
      sender: chrome.runtime.MessageSender,
      reply: (value: unknown) => void,
    ) => boolean)
  | null = null;

beforeEach(() => {
  badgeWrites.length = 0;
  titleWrites.length = 0;
  badgeGate = null;
  tabsGate = null;
  listener = null;
  Object.assign(chrome, {
    runtime: {
      id: 'test-extension',
      onMessage: { addListener: (fn: typeof listener) => (listener = fn) },
      sendMessage: () => Promise.resolve(),
    },
    action: {
      setBadgeText: async (value: { tabId: number; text: string }) => {
        badgeWrites.push(value);
        await badgeGate;
      },
      setTitle: async (value: { tabId: number; title: string }) => titleWrites.push(value),
    },
    tabs: {
      query: async () => {
        await tabsGate;
        return tabs;
      },
      onRemoved: { addListener: () => undefined },
      onUpdated: { addListener: () => undefined },
    },
  });
});
afterEach(() => vi.resetModules());

describe('credential assistance status', () => {
  it('uses capture precedence, clears both projections, and refuses content-tab snapshots', async () => {
    const status = await import('@/lib/credentials/assistance-status');
    status.registerCredentialAssistanceStatus();
    status.setSavedLoginAssistance(7, true);
    status.setCaptureAssistance(7, 'save_pending');
    let reply: unknown;
    listener?.(
      { __matrx: true, kind: 'credential-assistance:status', payload: { tabId: 7 } },
      {
        id: 'test-extension',
        url: 'chrome-extension://test-extension/sidepanel.html',
      } as chrome.runtime.MessageSender,
      (value) => (reply = value),
    );
    expect(reply).toEqual({ state: 'save_pending' });
    status.clearCredentialAssistance(7);
    listener?.(
      { __matrx: true, kind: 'credential-assistance:status', payload: { tabId: 7 } },
      {
        id: 'test-extension',
        url: 'chrome-extension://test-extension/sidepanel.html',
      } as chrome.runtime.MessageSender,
      (value) => (reply = value),
    );
    expect(reply).toEqual({ state: 'none' });
    reply = 'untouched';
    listener?.(
      { __matrx: true, kind: 'credential-assistance:status', payload: { tabId: 7 } },
      { id: 'test-extension', tab: { id: 7 } } as chrome.runtime.MessageSender,
      (value) => (reply = value),
    );
    expect(reply).toBe('untouched');
  });

  it('does not let a boot clear overwrite a newer saved-login projection while Chrome writes are deferred', async () => {
    const status = await import('@/lib/credentials/assistance-status');
    let release!: () => void;
    let releaseTabs!: () => void;
    badgeGate = new Promise((resolve) => {
      release = resolve;
    });
    tabsGate = new Promise((resolve) => {
      releaseTabs = resolve;
    });
    const boot = status.reconcileCredentialAssistanceActionOnBoot();
    status.setSavedLoginAssistance(7, true);
    await vi.waitFor(() => expect(badgeWrites).toContainEqual({ tabId: 7, text: '•' }));
    releaseTabs();
    release();
    await boot;
    await vi.waitFor(() =>
      expect(titleWrites).toContainEqual({ tabId: 7, title: 'Matrx has saved-login assistance' }),
    );
    expect(titleWrites.at(-1)).toEqual({ tabId: 7, title: 'Matrx has saved-login assistance' });
  });

  it('clears stale action state for every existing tab on worker boot', async () => {
    const status = await import('@/lib/credentials/assistance-status');
    await status.reconcileCredentialAssistanceActionOnBoot();
    expect(badgeWrites).toEqual([
      { tabId: 7, text: '' },
      { tabId: 8, text: '' },
    ]);
    expect(titleWrites).toEqual([
      { tabId: 7, title: 'Matrx' },
      { tabId: 8, title: 'Matrx' },
    ]);
  });
});
