/**
 * Localhost HTTP transport for the matrx-local desktop bridge.
 *
 * 127.0.0.1 is exempt from Private Network Access prompts in current Chrome,
 * so this works without CORS preflight juggling. Bearer token via a one-time
 * pairing flow (Settings → Pair desktop), persisted in chrome.storage.local.
 *
 * The base URL is no longer hardcoded — `getEngineBaseUrl()` (in
 * `discovery.ts`) resolves the port at runtime by checking the user override,
 * then a cached probe, then probing 22140-22159 in parallel. If discovery
 * fails entirely, both `probeHttp` and `rpcHttp` degrade gracefully so the
 * capability detector at `bridge.ts` flips to `transport: 'none'`.
 */

import { STORAGE_KEYS } from '@/config/env';
import { getEngineBaseUrl, invalidateEnginePortCache } from '@/lib/desktop/discovery';
import {
  type DesktopHealth,
  DesktopHealthSchema,
  type DesktopRpcRequest,
  type DesktopRpcResponse,
} from '@/lib/desktop/types';

const HEALTH_TIMEOUT_MS = 500;
const RPC_TIMEOUT_MS = 30_000;

/**
 * Resolve the bearer token used by every desktop-engine transport (HTTP RPC
 * Authorization header, WS `?token=` query param). EXPLICIT pair-token only.
 *
 * The previous fallback to the user's Supabase ACCESS token was a credential
 * leak (audit P1-5): the engine's base URL is discovered by probing
 * localhost ports 22140-22159 for anything whose /health matches a known,
 * guessable JSON shape — any unprivileged local process binding a port in
 * that range could harvest the user's full Supabase JWT over plaintext HTTP.
 * The pairing flow (Settings → Pair desktop) exists; un-paired = no bridge
 * auth, and callers surface the "open Settings → Pair desktop" remediation.
 */
export async function getPairToken(): Promise<string | null> {
  const r = await chrome.storage.local.get([STORAGE_KEYS.DESKTOP_PAIR_TOKEN]);
  const v = r[STORAGE_KEYS.DESKTOP_PAIR_TOKEN];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export async function setPairToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.DESKTOP_PAIR_TOKEN]: token });
}

export async function clearPairToken(): Promise<void> {
  await chrome.storage.local.remove([STORAGE_KEYS.DESKTOP_PAIR_TOKEN]);
}

export async function probeHttp(): Promise<DesktopHealth | null> {
  const baseUrl = await getEngineBaseUrl();
  if (!baseUrl) return null;
  try {
    const res = await timedFetch(`${baseUrl}/health`, { method: 'GET' }, HEALTH_TIMEOUT_MS);
    if (!res.ok) {
      // The cached port responded with non-2xx, which usually means we hit
      // some other unrelated service on that port. Drop the cache so the
      // next probe re-discovers a real engine.
      await invalidateEnginePortCache();
      return null;
    }
    const json = await res.json();
    const parsed = DesktopHealthSchema.safeParse(json);
    if (!parsed.success) {
      await invalidateEnginePortCache();
      return null;
    }
    return parsed.data;
  } catch {
    await invalidateEnginePortCache();
    return null;
  }
}

export async function rpcHttp(req: DesktopRpcRequest): Promise<DesktopRpcResponse> {
  const baseUrl = await getEngineBaseUrl();
  if (!baseUrl) {
    return {
      ok: false,
      error:
        'desktop engine not reachable — start matrx-local or set the port override in Settings',
    };
  }
  const token = await getPairToken();
  if (!token) {
    return { ok: false, error: 'desktop not paired — open Settings → Pair desktop' };
  }
  try {
    const res = await timedFetch(
      `${baseUrl}/extension/rpc`,
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
      // 5xx / connection-refused-shaped errors invalidate the cache so the
      // next call re-discovers (engine may have restarted on a new port).
      if (res.status >= 500 || res.status === 0) {
        await invalidateEnginePortCache();
      }
      return { ok: false, error: `${res.status}: ${errText}` };
    }
    const json = await res.json();
    return json as DesktopRpcResponse;
  } catch (err) {
    await invalidateEnginePortCache();
    return { ok: false, error: (err as Error).message };
  }
}

function timedFetch(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t));
}
