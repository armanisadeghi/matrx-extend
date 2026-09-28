import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  page: {
    id: 11,
    documentId: 'doc-a',
    pageKey: '[11,"doc-a","https://example.com/a"]',
    url: 'https://example.com/a',
    identityStatus: 'ready',
  },
  list: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  mode: vi.fn(),
  create: vi.fn(),
  listeners: new Map<string, (payload: any, sender: any) => any>(),
  updated: null as ((tabId: number, change: { status?: string }) => void) | null,
  removed: null as ((tabId: number) => void) | null,
}));
vi.mock('@/hooks/use-active-tab', () => ({
  getActiveTabIdentitySnapshot: () => m.page,
  isCurrentPageIdentity: (key: string) =>
    m.page.pageKey === key && m.page.identityStatus === 'ready',
}));
vi.mock('@/lib/highlights/control', () => ({
  startHighlighter: m.start,
  stopHighlighter: m.stop,
  setHighlighterMode: m.mode,
}));
vi.mock('@/lib/highlights/queries', () => ({
  listHighlightsForUrl: m.list,
  createHighlight: m.create,
  listMyHighlights: vi.fn().mockResolvedValue([]),
  clearHighlightsForUrl: vi.fn(),
}));
vi.mock('@/lib/messaging/native', () => ({
  on: (kind: string, handler: (payload: any, sender: any) => any) => {
    m.listeners.set(kind, handler);
    return () => {
      m.listeners.delete(kind);
    };
  },
  broadcast: vi.fn(),
}));
vi.mock('@/lib/destructive/confirm', () => ({ confirmDestructive: vi.fn() }));
vi.mock('@/lib/supabase/db-failure', () => ({ isDbFailureError: () => false }));

import { useHighlightBridge } from '@/hooks/use-highlight-bridge';
import { CHANNELS } from '@/lib/messaging/schemas';
import { useHighlightStore } from '@/state/highlights';
import { setHighlightSessionMode, startHighlightSession, stopHighlightSession } from './session';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const sender = (tabId: number, documentId: string, url: string) => ({
  tab: { id: tabId },
  documentId,
  url,
  frameId: 0,
});

beforeEach(() => {
  m.page = {
    id: 11,
    documentId: 'doc-a',
    pageKey: '[11,"doc-a","https://example.com/a"]',
    url: 'https://example.com/a',
    identityStatus: 'ready',
  };
  m.list.mockReset().mockResolvedValue([]);
  m.start.mockReset().mockResolvedValue(true);
  m.stop.mockReset().mockResolvedValue(undefined);
  m.mode.mockReset().mockResolvedValue(undefined);
  m.create.mockReset();
  m.listeners.clear();
  m.updated = null;
  m.removed = null;
  useHighlightStore.getState().setOverlaySession(null);
  useHighlightStore.getState().setMode('text');
  Object.assign(globalThis, {
    chrome: {
      tabs: {
        onUpdated: {
          addListener: (fn: typeof m.updated) => {
            m.updated = fn;
          },
          removeListener: () => {
            m.updated = null;
          },
        },
        onRemoved: {
          addListener: (fn: typeof m.removed) => {
            m.removed = fn;
          },
          removeListener: () => {
            m.removed = null;
          },
        },
      },
    },
  });
});

describe('the represented highlight document', () => {
  it('cannot publish a start after same-URL reload during the saved lookup', async () => {
    const pending = deferred<[]>();
    m.list.mockReturnValueOnce(pending.promise);
    const bridge = renderHook(() => useHighlightBridge());
    const starting = startHighlightSession();
    expect(useHighlightStore.getState().overlaySession?.documentId).toBe('doc-a');
    act(() => {
      m.updated?.(11, { status: 'loading' });
    });
    m.page = { ...m.page, documentId: 'doc-b', pageKey: '[11,"doc-b","https://example.com/a"]' };
    pending.resolve([]);
    expect(await starting).toBe(false);
    expect(m.start).not.toHaveBeenCalled();
    expect(useHighlightStore.getState().overlaySession).toBeNull();
    bridge.unmount();
  });

  it('retires an injected old document when reload wins the pending start', async () => {
    const pending = deferred<boolean>();
    m.start.mockReturnValueOnce(pending.promise);
    const bridge = renderHook(() => useHighlightBridge());
    const starting = startHighlightSession();
    await vi.waitFor(() =>
      expect(m.start).toHaveBeenCalledWith(11, 'doc-a', expect.any(String), []),
    );
    act(() => {
      m.updated?.(11, { status: 'loading' });
    });
    m.page = { ...m.page, documentId: 'doc-b', pageKey: '[11,"doc-b","https://example.com/a"]' };
    pending.resolve(true);
    expect(await starting).toBe(false);
    expect(m.stop).toHaveBeenCalledWith(11, 'doc-a', expect.any(String));
    expect(useHighlightStore.getState().overlaySession).toBeNull();
    bridge.unmount();
  });

  it('retires tab A before representing tab B and targets B for mode and stop', async () => {
    await startHighlightSession();
    m.page = {
      id: 22,
      documentId: 'doc-b',
      pageKey: '[22,"doc-b","https://example.com/b"]',
      url: 'https://example.com/b',
      identityStatus: 'ready',
    };
    await startHighlightSession();
    expect(m.stop).toHaveBeenCalledWith(11, 'doc-a', expect.any(String));
    expect(useHighlightStore.getState().overlaySession).toMatchObject({
      tabId: 22,
      documentId: 'doc-b',
      status: 'active',
    });
    await setHighlightSessionMode('element');
    expect(m.mode).toHaveBeenLastCalledWith(22, 'doc-b', expect.any(String), 'element');
    await stopHighlightSession();
    expect(m.stop).toHaveBeenLastCalledWith(22, 'doc-b', expect.any(String));
    expect(useHighlightStore.getState().overlaySession).toBeNull();
  });

  it('rejects stale and other-tab state, capture, and clear messages', async () => {
    const bridge = renderHook(() => useHighlightBridge());
    await startHighlightSession();
    const oldSessionId = useHighlightStore.getState().overlaySession!.sessionId;
    const oldSender = sender(11, 'doc-a', 'https://example.com/a');
    m.page = {
      id: 22,
      documentId: 'doc-b',
      pageKey: '[22,"doc-b","https://example.com/b"]',
      url: 'https://example.com/b',
      identityStatus: 'ready',
    };
    await startHighlightSession();
    const freshSessionId = useHighlightStore.getState().overlaySession!.sessionId;
    const freshSender = sender(22, 'doc-b', 'https://example.com/b');
    const state = m.listeners.get(CHANNELS.HIGHLIGHT_OVERLAY_STATE)!;
    const captured = m.listeners.get(CHANNELS.HIGHLIGHT_CAPTURED)!;
    const clear = m.listeners.get(CHANNELS.HIGHLIGHT_CLEAR_REQUEST)!;
    act(() => {
      state(
        {
          mounted: false,
          mode: 'text',
          count: 0,
          url: 'https://example.com/a',
          sessionId: oldSessionId,
        },
        oldSender,
      );
    });
    expect(useHighlightStore.getState().overlaySession?.documentId).toBe('doc-b');
    expect(
      await captured({ url: 'https://example.com/a', sessionId: oldSessionId }, oldSender),
    ).toHaveProperty('__error');
    expect(
      await clear({ url: 'https://example.com/a', sessionId: oldSessionId }, oldSender),
    ).toMatchObject({ ok: false });
    expect(m.create).not.toHaveBeenCalled();
    m.create.mockResolvedValueOnce({
      id: 'saved-b',
      url: 'https://example.com/b',
      mode: 'text',
      domain: 'example.com',
      color: 'yellow',
      text: 'B',
      anchor: {},
      created_by: null,
      conversation_id: null,
      page_title: null,
      created_at: '',
      updated_at: '',
    });
    expect(
      await captured({ url: 'https://example.com/b', sessionId: freshSessionId }, freshSender),
    ).toEqual({ id: 'saved-b' });
    expect(m.create).toHaveBeenCalledTimes(1);
    bridge.unmount();
  });

  it('rejects an old session on the same document after stop and restart', async () => {
    const bridge = renderHook(() => useHighlightBridge());
    await startHighlightSession();
    const staleId = useHighlightStore.getState().overlaySession!.sessionId;
    await stopHighlightSession();
    await startHighlightSession();
    const currentId = useHighlightStore.getState().overlaySession!.sessionId;
    expect(currentId).not.toBe(staleId);
    const fromPage = sender(11, 'doc-a', 'https://example.com/a');
    const state = m.listeners.get(CHANNELS.HIGHLIGHT_OVERLAY_STATE)!;
    const captured = m.listeners.get(CHANNELS.HIGHLIGHT_CAPTURED)!;
    act(() => {
      state(
        {
          mounted: false,
          mode: 'text',
          count: 0,
          url: 'https://example.com/a',
          sessionId: staleId,
        },
        fromPage,
      );
    });
    expect(useHighlightStore.getState().overlaySession?.sessionId).toBe(currentId);
    expect(
      await captured({ url: 'https://example.com/a', sessionId: staleId }, fromPage),
    ).toHaveProperty('__error');
    expect(
      await captured(
        { url: 'https://example.com/a', sessionId: currentId },
        sender(11, 'wrong-document', 'https://example.com/a'),
      ),
    ).toHaveProperty('__error');
    expect(m.create).not.toHaveBeenCalled();
    bridge.unmount();
  });
});
