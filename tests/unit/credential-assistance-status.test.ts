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

const EXTENSION_ROOTS = [
  { name: 'Chrome extension origin', root: 'chrome-extension://test-extension/' },
  {
    name: 'Firefox extension UUID origin',
    root: 'moz-extension://a2f6b807-9e91-4c73-8d30-5cf4fae9158d/',
  },
] as const;

beforeEach(() => {
  badgeWrites.length = 0;
  titleWrites.length = 0;
  badgeGate = null;
  tabsGate = null;
  listener = null;
  Object.assign(chrome, {
    runtime: {
      id: 'test-extension',
      getURL: (path: string) => `moz-extension://a2f6b807-9e91-4c73-8d30-5cf4fae9158d/${path}`,
      onMessage: {
        addListener: (fn: typeof listener) => {
          listener = fn;
        },
      },
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
  it.each(EXTENSION_ROOTS)(
    'uses capture precedence for $name and rejects forged senders',
    async ({ root }) => {
      Object.assign(chrome.runtime, { getURL: (path: string) => `${root}${path}` });
      const status = await import('@/lib/credentials/assistance-status');
      status.registerCredentialAssistanceStatus();
      status.setSavedLoginAssistance(7, true);
      status.setCaptureAssistance(7, 'save_pending');
      const message = {
        __matrx: true,
        kind: 'credential-assistance:status',
        payload: { tabId: 7 },
      };
      const request = (sender: chrome.runtime.MessageSender) => {
        let reply: unknown = 'untouched';
        const handled = listener?.(message, sender, (value) => {
          reply = value;
        });
        return { handled, reply };
      };
      const trusted = request({
        id: 'test-extension',
        url: `${root}sidepanel.html`,
      } as chrome.runtime.MessageSender);
      expect(trusted).toEqual({ handled: false, reply: { state: 'save_pending' } });
      status.clearCredentialAssistance(7);
      expect(
        request({
          id: 'test-extension',
          url: `${root}sidepanel.html`,
        } as chrome.runtime.MessageSender),
      ).toEqual({ handled: false, reply: { state: 'none' } });
      for (const sender of [
        { id: 'test-extension', url: `${root.slice(0, -1)}.invalid/sidepanel.html` },
        { id: 'test-extension', url: `${root.slice(0, -1)}-lookalike/sidepanel.html` },
        { id: 'other-extension', url: `${root}sidepanel.html` },
        { id: 'test-extension', tab: { id: 7 }, url: `${root}sidepanel.html` },
      ]) {
        expect(request(sender as chrome.runtime.MessageSender)).toEqual({
          handled: false,
          reply: 'untouched',
        });
      }
    },
  );

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
