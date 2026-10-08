/**
 * The side panel's navigation port for `@ai-matrx/chat`: an in-memory address
 * (a side panel is one extension page — a history push would make a reload
 * load a path that does not exist). The last address survives a panel reopen
 * through `chrome.storage.session`.
 */

import type {
  ChatLinkProps,
  ChatNavigationPort,
  ChatRouter,
  ChatSearchParams,
} from '@ai-matrx/chat/host';
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'matrx-extend:chat-address';
let address = '/chat';
const listeners = new Set<() => void>();

function set(next: string): void {
  if (next === address) return;
  address = next;
  for (const l of listeners) l();
  void chrome.storage?.session?.set({ [STORAGE_KEY]: next }).catch(() => undefined);
}

/** Restore the last address before the chat mounts. */
export async function restoreChatAddress(): Promise<void> {
  try {
    const stored = await chrome.storage.session.get(STORAGE_KEY);
    const value = stored[STORAGE_KEY];
    if (typeof value === 'string' && value.startsWith('/')) address = value;
  } catch {
    /* no session storage — start fresh */
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function toAddress(href: string): string | null {
  try {
    const url = new URL(href, 'https://panel.local');
    return url.origin === 'https://panel.local' ? url.pathname + url.search : null;
  } catch {
    return null;
  }
}

function go(href: string): void {
  const next = toAddress(href);
  // Another origin (an aimatrx.com page) opens in a browser tab, never inside the panel.
  if (next === null) {
    void chrome.tabs.create({ url: href });
    return;
  }
  set(next);
}

const history: string[] = [];
const router: ChatRouter = {
  push: (href: string) => {
    history.push(address);
    go(href);
  },
  replace: (href: string) => go(href),
  back: () => set(history.pop() ?? '/chat'),
  forward: () => undefined,
  refresh: () => undefined,
  prefetch: () => undefined,
};

let cachedQuery: { address: string; params: ChatSearchParams } | null = null;
/** One params object per address, so effects keyed on it do not re-run every render. */
function searchParamsFor(current: string): ChatSearchParams {
  if (cachedQuery?.address !== current) {
    cachedQuery = { address: current, params: new URLSearchParams(current.split('?')[1] ?? '') };
  }
  return cachedQuery.params;
}

function useAddress(): string {
  return useSyncExternalStore(subscribe, () => address);
}

function Link({ href, children, onClick, prefetch: _p, replace, scroll: _s, ...rest }: ChatLinkProps) {
  const target = href;
  return (
    <a
      {...rest}
      href={target}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.metaKey || event.ctrlKey) return;
        event.preventDefault();
        if (replace) router.replace(target);
        else router.push(target);
      }}
    >
      {children}
    </a>
  );
}

export const memoryNavigation: ChatNavigationPort = {
  push: router.push,
  replace: router.replace,
  back: router.back,
  useRouter: () => router,
  usePathname: () => useAddress().split('?')[0] ?? '/chat',
  useSearchParams: () => searchParamsFor(useAddress()),
  Link,
};
