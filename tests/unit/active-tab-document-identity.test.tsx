// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useActiveTab } from '@/hooks/use-active-tab';

type Listener = (...args: never[]) => void;
function event() {
  const listeners = new Set<Listener>();
  return {
    addListener: (listener: Listener) => listeners.add(listener),
    removeListener: (listener: Listener) => listeners.delete(listener),
    fire: (...args: never[]) => { for (const listener of listeners) listener(...args); },
  };
}

const activated = event();
const updated = event();
const focused = event();
const beforeNavigate = event();
const committed = event();
const navigationError = event();
let tab = { id: 41, url: 'https://example.org/story', title: 'Story', active: true };
let documentId = 'document-a';
let getFrame = vi.fn(async () => ({ documentId, url: tab.url, errorOccurred: false }));

beforeEach(() => {
  tab = { id: 41, url: 'https://example.org/story', title: 'Story', active: true };
  documentId = 'document-a';
  getFrame = vi.fn(async () => ({ documentId, url: tab.url, errorOccurred: false }));
  vi.stubGlobal('chrome', {
    tabs: { query: vi.fn(async () => [{ ...tab }]), onActivated: activated, onUpdated: updated },
    windows: { onFocusChanged: focused },
    webNavigation: { getFrame: () => getFrame(), onBeforeNavigate: beforeNavigate, onCommitted: committed, onErrorOccurred: navigationError },
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

it('withholds A at navigation start and resolves B on a same-tab same-URL commit', async () => {
  const { result } = renderHook(useActiveTab);
  await settle();
  const keyA = result.current.pageKey;
  expect(result.current.documentId).toBe('document-a');
  act(() => beforeNavigate.fire({ tabId: 41, frameId: 0 } as never));
  expect(result.current.pageKey).toBeNull();
  documentId = 'document-b';
  act(() => committed.fire({ tabId: 41, frameId: 0, documentId: 'document-b' } as never));
  await settle();
  expect(result.current.documentId).toBe('document-b');
  expect(result.current.pageKey).not.toBe(keyA);
});

it('keeps identity through title and subframe churn, and invalidates a SPA URL', async () => {
  const { result } = renderHook(useActiveTab);
  await settle();
  const keyA = result.current.pageKey;
  tab.title = 'Changed title';
  act(() => updated.fire(41 as never, { title: tab.title } as never, { ...tab } as never));
  act(() => committed.fire({ tabId: 41, frameId: 2, documentId: 'subframe' } as never));
  await settle();
  expect(result.current.pageKey).toBe(keyA);
  tab.url = 'https://example.org/another-story';
  act(() => updated.fire(41 as never, { url: tab.url } as never, { ...tab } as never));
  await settle();
  expect(result.current.documentId).toBe('document-a');
  expect(result.current.pageKey).not.toBe(keyA);
});

it('rejects a late frame read after activation and resolves the new active tab', async () => {
  let releaseOld!: (value: { documentId: string; url: string; errorOccurred: boolean }) => void;
  getFrame.mockImplementationOnce(() => new Promise((resolve) => { releaseOld = resolve; }));
  getFrame.mockImplementation(async () => ({ documentId: 'document-b', url: tab.url, errorOccurred: false }));
  const { result } = renderHook(useActiveTab);
  await settle();
  tab = { id: 42, url: 'https://example.org/story', title: 'New tab', active: true };
  act(() => activated.fire({ tabId: 42 } as never));
  await settle();
  expect(result.current.id).toBe(42);
  act(() => releaseOld({ documentId: 'document-a', url: tab.url, errorOccurred: false }));
  await settle();
  expect(result.current.documentId).toBe('document-b');
});

it('never treats an unresolved frame as a trusted page key', async () => {
  getFrame.mockImplementation(async () => ({ documentId: '', url: tab.url, errorOccurred: true }));
  const { result } = renderHook(useActiveTab);
  await settle();
  expect(result.current.identityStatus).toBe('unresolved');
  expect(result.current.pageKey).toBeNull();
  expect(result.current.identityError).toMatch(/reload.*retry/i);
});
