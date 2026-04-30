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

export async function probeNative(): Promise<DesktopHealth | null> {
  const result = await rpcNative({ command: 'health' }, 600);
  if (!result.ok) return null;
  const parsed = DesktopHealthSchema.safeParse(result.data);
  return parsed.success ? parsed.data : null;
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
