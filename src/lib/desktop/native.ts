/**
 * Native messaging transport for the matrx-local desktop bridge.
 *
 * Connects via chrome.runtime.connectNative('com.matrx.local'). Requires the
 * matrx-local installer to drop a host manifest at the OS-specific location.
 * If the host isn't installed, connectNative throws / disconnects immediately —
 * we treat any disconnect within 100 ms as "not available."
 */

import { ENV } from '@/config/env';
import {
  type DesktopHealth,
  DesktopHealthSchema,
  type DesktopRpcRequest,
  type DesktopRpcResponse,
} from '@/lib/desktop/types';

interface PendingRpc {
  resolve: (r: DesktopRpcResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

let port: chrome.runtime.Port | null = null;
const pending = new Map<string, PendingRpc>();
let nextId = 1;

function ensurePort(): chrome.runtime.Port | null {
  if (port) return port;
  try {
    port = chrome.runtime.connectNative(ENV.DESKTOP_NATIVE_HOST);
  } catch (err) {
    console.warn('[matrx-extend] native host connect failed', (err as Error).message);
    return null;
  }
  port.onMessage.addListener((msg) => {
    const id = (msg as { id?: string }).id;
    if (!id) return;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    p.resolve((msg as { response: DesktopRpcResponse }).response);
  });
  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message ?? 'native host disconnected';
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: err });
    }
    pending.clear();
    port = null;
  });
  return port;
}

/**
 * Wait after the Nth consecutive miss before probing again; last is the
 * ceiling. Same ladder, same reason as the HTTP port sweep in discovery.ts:
 * the 30s desktop alarm calls this forever, and most machines never install
 * the native host — matrx-local's own dev machines included. Retrying a
 * connectNative to a host that is not registered, twice a minute, for the
 * life of the browser, is noise, not resilience.
 */
const PROBE_BACKOFF_MS = [30_000, 60_000, 300_000, 900_000] as const;
let consecutiveMisses = 0;
let nextProbeAllowedAt = 0;

/** Clear the probe rate limit. Explicit human actions only. */
export function resetNativeProbeBackoff(): void {
  consecutiveMisses = 0;
  nextProbeAllowedAt = 0;
}

export async function probeNative(): Promise<DesktopHealth | null> {
  if (Date.now() < nextProbeAllowedAt) return null;
  const result = await rpcNative({ command: 'health' }, 600);
  const parsed = result.ok ? DesktopHealthSchema.safeParse(result.data) : null;
  if (!parsed?.success) {
    const idx = Math.min(consecutiveMisses, PROBE_BACKOFF_MS.length - 1);
    consecutiveMisses += 1;
    nextProbeAllowedAt =
      Date.now() + (PROBE_BACKOFF_MS[idx] ?? PROBE_BACKOFF_MS[PROBE_BACKOFF_MS.length - 1] ?? 900_000);
    return null;
  }
  resetNativeProbeBackoff();
  return parsed.data;
}

export function rpcNative(req: DesktopRpcRequest, timeoutMs = 30_000): Promise<DesktopRpcResponse> {
  return new Promise((resolve) => {
    const p = ensurePort();
    if (!p) {
      resolve({ ok: false, error: 'native host unavailable' });
      return;
    }
    const id = `rpc-${nextId++}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: 'native host timeout' });
    }, timeoutMs);
    pending.set(id, { resolve, timer });
    try {
      p.postMessage({ id, request: req });
    } catch (err) {
      clearTimeout(timer);
      pending.delete(id);
      resolve({ ok: false, error: (err as Error).message });
    }
  });
}
