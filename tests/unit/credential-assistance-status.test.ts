import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const badgeWrites: Array<{ tabId: number; text: string }> = [];
const titleWrites: Array<{ tabId: number; title: string }> = [];
let listener: ((message: unknown, sender: chrome.runtime.MessageSender, reply: (value: unknown) => void) => boolean) | null = null;

beforeEach(() => {
  badgeWrites.length = 0;
  titleWrites.length = 0;
  listener = null;
  Object.assign(chrome, {
    runtime: { id: 'test-extension', onMessage: { addListener: (fn: typeof listener) => (listener = fn) }, sendMessage: () => Promise.resolve() },
    action: { setBadgeText: async (value: { tabId: number; text: string }) => badgeWrites.push(value), setTitle: async (value: { tabId: number; title: string }) => titleWrites.push(value) },
    tabs: { onRemoved: { addListener: () => undefined }, onUpdated: { addListener: () => undefined } },
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
    listener?.({ __matrx: true, kind: 'credential-assistance:status', payload: { tabId: 7 } }, { id: 'test-extension', url: 'chrome-extension://test-extension/sidepanel.html' } as chrome.runtime.MessageSender, (value) => (reply = value));
    expect(reply).toEqual({ state: 'save_pending' });
    status.clearCredentialAssistance(7);
    listener?.({ __matrx: true, kind: 'credential-assistance:status', payload: { tabId: 7 } }, { id: 'test-extension', url: 'chrome-extension://test-extension/sidepanel.html' } as chrome.runtime.MessageSender, (value) => (reply = value));
    expect(reply).toEqual({ state: 'none' });
    reply = 'untouched';
    listener?.({ __matrx: true, kind: 'credential-assistance:status', payload: { tabId: 7 } }, { id: 'test-extension', tab: { id: 7 } } as chrome.runtime.MessageSender, (value) => (reply = value));
    expect(reply).toBe('untouched');
  });
});
