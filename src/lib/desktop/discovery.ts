/**
 * Desktop engine port discovery.
 *
 * The matrx-local Tauri engine binds an HTTP listener to the first free port
 * in the auto-scan range 22140-22159 and writes the chosen port into
 * `~/.matrx/local.json`. A Chrome service worker can't read that file
 * directly, so we discover the port the same way any LAN client would: probe
 * each candidate port with a tiny `health` RPC and cache the winner.
 *
 * Resolution order:
 *   1. User override in chrome.storage.local (`matrxLocalEnginePortOverride`)
 *      — set from the Settings UI, skips probing entirely.
 *   2. Cached port (`matrxLocalEnginePort` = `{port, expiresAt}`) if not
 *      expired. TTL is 30 minutes.
 *   3. Parallel `health` probe across ports 22140-22159. First success wins,
 *      gets cached, and is returned.
 *   4. Build-time `ENV.DESKTOP_LOCAL_URL` as a last-resort fallback. This
 *      mirrors how the bridge behaved before discovery shipped, so callers
 *      that depended on the old hardcoded port still work in environments
 *      where the engine doesn't respond to probes (e.g. native messaging
 *      transport).
 *
 * If every probe fails (engine offline) and no override / valid cache /
 * useful default exists, returns `null` so callers can degrade gracefully.
 */

import { ENV } from '@/config/env';
import { DesktopHealthSchema } from '@/lib/desktop/types';

const STORAGE_KEY_CACHE = 'matrxLocalEnginePort';
const STORAGE_KEY_OVERRIDE = 'matrxLocalEnginePortOverride';

const PROBE_PORT_RANGE_START = 22140;
const PROBE_PORT_RANGE_END = 22159;
const PROBE_TIMEOUT_MS = 250;
const CACHE_TTL_MS = 30 * 60 * 1000;

interface CachedEntry {
  port: number;
  expiresAt: number;
}

const isCachedEntry = (v: unknown): v is CachedEntry =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as CachedEntry).port === 'number' &&
  typeof (v as CachedEntry).expiresAt === 'number';

let inFlight: Promise<string | null> | null = null;

export async function getEngineBaseUrl(): Promise<string | null> {
  const override = await getEnginePortOverride();
  if (override !== null) {
    return `http://127.0.0.1:${override}`;
  }

  const cached = await readCachedEntry();
  if (cached && cached.expiresAt > Date.now()) {
    return `http://127.0.0.1:${cached.port}`;
  }

  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const port = await probePortRange();
      if (port !== null) {
        await writeCachedEntry({ port, expiresAt: Date.now() + CACHE_TTL_MS });
        return `http://127.0.0.1:${port}`;
      }
      // Probe failed: invalidate the cache so the next call re-probes
      // immediately rather than waiting for TTL.
      await invalidateEnginePortCache();
      const fallback = parsePortFromUrl(ENV.DESKTOP_LOCAL_URL);
      if (fallback !== null) {
        return `http://127.0.0.1:${fallback}`;
      }
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export async function invalidateEnginePortCache(): Promise<void> {
  await chrome.storage.local.remove([STORAGE_KEY_CACHE]);
}

export async function setEnginePortOverride(port: number | null): Promise<void> {
  if (port === null || port === 0) {
    await chrome.storage.local.remove([STORAGE_KEY_OVERRIDE]);
    return;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${port}`);
  }
  await chrome.storage.local.set({ [STORAGE_KEY_OVERRIDE]: port });
}

export async function getEnginePortOverride(): Promise<number | null> {
  const r = await chrome.storage.local.get([STORAGE_KEY_OVERRIDE]);
  const v = r[STORAGE_KEY_OVERRIDE];
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 65535) {
    return v;
  }
  return null;
}

async function readCachedEntry(): Promise<CachedEntry | null> {
  const r = await chrome.storage.local.get([STORAGE_KEY_CACHE]);
  const v = r[STORAGE_KEY_CACHE];
  return isCachedEntry(v) ? v : null;
}

async function writeCachedEntry(entry: CachedEntry): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_CACHE]: entry });
}

async function probePortRange(): Promise<number | null> {
  const candidates: number[] = [];
  for (let p = PROBE_PORT_RANGE_START; p <= PROBE_PORT_RANGE_END; p++) {
    candidates.push(p);
  }

  // Race every candidate. First success wins; failures are silent so the
  // single first-resolve is the winner. Promise.any returns AggregateError
  // when all reject, which we map to null.
  const probes = candidates.map((port) => probeOne(port));
  try {
    return await Promise.any(probes);
  } catch {
    return null;
  }
}

function probeOne(port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    // GET /health is the engine's public discovery endpoint
    // (app/api/routes.py + app/api/auth.py _PUBLIC_PATHS). No bearer
    // required — keeping the probe auth-free avoids spurious "missing
    // bearer token" warnings in the engine log on every alarm tick.
    // Validating the response body against DesktopHealthSchema
    // ensures we only cache a port whose listener actually identifies
    // itself as matrx-local, not some unrelated local service.
    fetch(`http://127.0.0.1:${port}/health`, {
      method: 'GET',
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          reject(new Error(`status ${res.status}`));
          return;
        }
        const json = await res.json().catch(() => null);
        const parsed = DesktopHealthSchema.safeParse(json);
        if (parsed.success) {
          resolve(port);
        } else {
          reject(new Error('health response did not match schema'));
        }
      })
      .catch((err) => reject(err))
      .finally(() => clearTimeout(timer));
  });
}

function parsePortFromUrl(url: string): number | null {
  try {
    const u = new URL(url);
    if (!u.port) return null;
    const n = Number(u.port);
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
  } catch {
    return null;
  }
}
