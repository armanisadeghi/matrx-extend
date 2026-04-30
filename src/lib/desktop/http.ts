/**
 * Localhost HTTP transport for the matrx-local desktop bridge.
 *
 * 127.0.0.1 is exempt from Private Network Access prompts in current Chrome,
 * so this works without CORS preflight juggling. Bearer token via a one-time
 * pairing flow (Settings → Pair desktop), persisted in chrome.storage.local.
 */

import { ENV, STORAGE_KEYS } from '@/config/env';
import {
  type DesktopHealth,
  DesktopHealthSchema,
  type DesktopRpcRequest,
  type DesktopRpcResponse,
} from '@/lib/desktop/types';

const HEALTH_TIMEOUT_MS = 500;
const RPC_TIMEOUT_MS = 30_000;

async function getPairToken(): Promise<string | null> {
  const r = await chrome.storage.local.get([STORAGE_KEYS.DESKTOP_PAIR_TOKEN]);
  const v = r[STORAGE_KEYS.DESKTOP_PAIR_TOKEN];
  return typeof v === 'string' ? v : null;
}

export async function setPairToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.DESKTOP_PAIR_TOKEN]: token });
}

export async function clearPairToken(): Promise<void> {
  await chrome.storage.local.remove([STORAGE_KEYS.DESKTOP_PAIR_TOKEN]);
}

export async function probeHttp(): Promise<DesktopHealth | null> {
  try {
    const res = await timedFetch(
      `${ENV.DESKTOP_LOCAL_URL}/health`,
      { method: 'GET' },
      HEALTH_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    const json = await res.json();
    const parsed = DesktopHealthSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function rpcHttp(req: DesktopRpcRequest): Promise<DesktopRpcResponse> {
  const token = await getPairToken();
  if (!token) {
    return { ok: false, error: 'desktop not paired — open Settings → Pair desktop' };
  }
  try {
    const res = await timedFetch(
      `${ENV.DESKTOP_LOCAL_URL}/extension/rpc`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(req),
      },
      RPC_TIMEOUT_MS,
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      return { ok: false, error: `${res.status}: ${errText}` };
    }
    const json = await res.json();
    return json as DesktopRpcResponse;
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function timedFetch(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t));
}
