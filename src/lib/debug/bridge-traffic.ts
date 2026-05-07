/**
 * Optional ring-buffer for inbound bridge traffic that doesn't already flow
 * through `log.ts` in a structured-enough way for the Debug → Bridges panel.
 *
 * Two streams are captured:
 *
 *   1. `frontend-rpc` — every inbound `chrome.runtime.onMessageExternal`
 *      envelope routed through `handleFrontendRpc`. The bootstrap.ts
 *      listener calls `recordBridgeTraffic` IF the buffer is enabled;
 *      otherwise the call is a cheap no-op so production never pays
 *      a serialization cost.
 *
 *   2. `broadcast` — every inbound Supabase Broadcast envelope routed
 *      through `routeBroadcastMessage`. Same enable-gated pattern.
 *
 * Why a separate buffer, not the existing `log` store: the Bridges panel
 * needs the exact envelope (action, requestId, payload, response) for the
 * "live tail" UI. The general log store flattens events to a level + message
 * + opaque detail which is fine for ad-hoc debugging but loses the structure
 * needed to re-render an envelope as a JSON tree on its own.
 *
 * OFF by default. The Debug → Bridges → Channel C panel toggles it via
 * `enableBridgeTrafficBuffer`. Persisted in chrome.storage.local so the
 * setting survives SW restarts.
 */

import { create } from 'zustand';

const ENABLED_STORAGE_KEY = 'matrx.debug.bridgeTraffic.enabled';
const MAX_ENTRIES = 50;

export type BridgeTrafficStream = 'frontend-rpc' | 'broadcast';

export interface BridgeTrafficEntry {
  id: string;
  ts: number;
  stream: BridgeTrafficStream;
  /** "in" = inbound to extension, "out" = extension publishing outbound. */
  direction: 'in' | 'out';
  action: string;
  requestId?: string;
  sender?: string;
  payload?: unknown;
  response?: unknown;
  ok?: boolean;
  error?: string;
}

interface BridgeTrafficState {
  enabled: boolean;
  entries: BridgeTrafficEntry[];
  setEnabled: (enabled: boolean) => void;
  push: (entry: Omit<BridgeTrafficEntry, 'id' | 'ts'>) => void;
  clear: () => void;
}

let nextId = 0;
const newEntryId = (): string => `bt-${Date.now()}-${nextId++}`;

export const useBridgeTrafficStore = create<BridgeTrafficState>((set) => ({
  enabled: false,
  entries: [],
  setEnabled: (enabled) => set({ enabled }),
  push: (entry) =>
    set((s) => {
      if (!s.enabled) return s;
      const full: BridgeTrafficEntry = {
        ...entry,
        id: newEntryId(),
        ts: Date.now(),
      };
      const next = [full, ...s.entries];
      if (next.length > MAX_ENTRIES) next.length = MAX_ENTRIES;
      return { entries: next };
    }),
  clear: () => set({ entries: [] }),
}));

/**
 * The hot-path call site. Cheap when disabled — single store read + early
 * return. When enabled, copies the entry into the ring buffer.
 *
 * Safe to call from SW / offscreen / content / sidepanel; when called
 * outside the sidepanel we additionally relay so the Debug tab sees it.
 */
export function recordBridgeTraffic(entry: Omit<BridgeTrafficEntry, 'id' | 'ts'>): void {
  const { enabled } = useBridgeTrafficStore.getState();
  if (!enabled) return;
  useBridgeTrafficStore.getState().push(entry);
  // Cross-context relay — the SW captures most envelopes, but the sidepanel
  // owns the panel UI. Mirror via chrome.runtime.sendMessage so the
  // sidepanel store gets the entry too.
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    try {
      chrome.runtime
        .sendMessage({
          __matrx: true,
          kind: '__matrx_bridge_traffic__',
          payload: entry,
        })
        .catch(() => undefined);
    } catch {
      /* shutting down — ignore */
    }
  }
}

/**
 * Persist the enabled flag and update the in-memory store. Called from the
 * Bridges panel toggle.
 */
export async function setBridgeTrafficEnabled(enabled: boolean): Promise<void> {
  useBridgeTrafficStore.getState().setEnabled(enabled);
  try {
    await chrome.storage.local.set({ [ENABLED_STORAGE_KEY]: enabled });
  } catch {
    /* ignore */
  }
}

/**
 * Hydrate the enabled flag from chrome.storage.local on context load. Should
 * be called from both SW bootstrap and the sidepanel mount.
 */
export async function hydrateBridgeTrafficEnabled(): Promise<void> {
  try {
    const r = await chrome.storage.local.get([ENABLED_STORAGE_KEY]);
    const v = r[ENABLED_STORAGE_KEY];
    if (typeof v === 'boolean') {
      useBridgeTrafficStore.getState().setEnabled(v);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Sidepanel-side relay: receive `__matrx_bridge_traffic__` envelopes from
 * other contexts (SW especially) and merge them into the local store.
 */
export function startBridgeTrafficRelay(): void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
  chrome.runtime.onMessage.addListener((msg) => {
    if (
      !msg ||
      typeof msg !== 'object' ||
      (msg as Record<string, unknown>).__matrx !== true ||
      (msg as Record<string, unknown>).kind !== '__matrx_bridge_traffic__'
    ) {
      return false;
    }
    const entry = (msg as { payload?: Omit<BridgeTrafficEntry, 'id' | 'ts'> }).payload;
    if (!entry) return false;
    // Merge into the local store WITHOUT going through `push` (which would
    // re-broadcast and loop). We mutate state directly using setState.
    useBridgeTrafficStore.setState((s) => {
      if (!s.enabled) return s;
      const full: BridgeTrafficEntry = {
        ...entry,
        id: newEntryId(),
        ts: Date.now(),
      };
      const next = [full, ...s.entries];
      if (next.length > MAX_ENTRIES) next.length = MAX_ENTRIES;
      return { entries: next };
    });
    return false;
  });
}
