import { beforeEach, describe, expect, it } from 'vitest';

import {
  hasFirefoxSidebarAction,
  openFirefoxSidebarFromGesture,
  openPanel,
} from '@/lib/panel/adapter';

describe('panel adapter', () => {
  beforeEach(() => {
    globalThis.chrome = {} as typeof chrome;
  });

  it('keeps Chromium window routing intact when sidePanel is available', async () => {
    const calls: unknown[] = [];
    globalThis.chrome = {
      sidePanel: { open: async (request: unknown) => void calls.push(request) },
    } as unknown as typeof chrome;

    await openPanel({ windowId: 17 }).promise;

    expect(calls).toEqual([{ windowId: 17 }]);
    expect(hasFirefoxSidebarAction()).toBe(false);
  });

  it('opens Firefox sidebarAction without inventing tab or window ownership', async () => {
    const calls: unknown[] = [];
    globalThis.chrome = {
      sidebarAction: { open: async (...args: unknown[]) => void calls.push(args) },
    } as unknown as typeof chrome;

    const attempt = openFirefoxSidebarFromGesture();
    await attempt?.promise;

    expect(hasFirefoxSidebarAction()).toBe(true);
    expect(calls).toEqual([[]]);
  });

  it('returns an actionable refusal where neither native panel surface exists', () => {
    expect(openPanel({ windowId: 17 })).toEqual({
      promise: null,
      reason: 'panel-unavailable: Open Matrx from the browser toolbar.',
    });
  });
});
