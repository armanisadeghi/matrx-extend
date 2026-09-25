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
 *      — set from the Settings UI. It skips DISCOVERY, not verification: the
 *      port is probed, and a dead one returns null with a remedy rather than
 *      falling through to whatever else answers the scan (which could
 *      cross-connect a developer to the wrong engine).
 *   2. Cached port (`matrxLocalEnginePort` = `{port, expiresAt}`) if not
 *      expired. TTL is 30 minutes.
 *   3. The last port that ever answered (`matrxLocalEngineLastGoodPort`),
 *      re-probed on its own — one request, no rate limit.
 *   4. Parallel `health` probe across ports 22140-22159. First success wins,
 *      gets cached, and is returned. Rate-limited; see COST OF A MISS.
 *   5. The signed-in user's freshest active `app_instances.tunnel_url` row
 *      from Supabase. This is the cross-machine path; the tunnel URL is
 *      refreshed by matrx-local and protected by owner-only RLS.
 * If every rung fails the engine is offline and this returns `null`, which
 * every caller already handles: `probeHttp` reports transport 'none',
 * `rpcHttp` returns the "start matrx-local" remedy, `connectWs` reports
 * stage 'discover'.
 *
 * There is deliberately NO build-time fallback address. A build-time env var
 * (`WXT_DESKTOP_LOCAL_URL`, now deleted) used to be the last rung, and
 * because it was always set (22180 — a port
 * outside the scan range that the engine never binds) this function could
 * never return null: an offline engine was handed back as a real address.
 * Every graceful-degradation path above was therefore dead code, the bridge
 * reported itself reachable when it was not, and the WS runtime was handed a
 * ws:// URL for a port nothing was listening on — which is how it ended up
 * retrying a phantom endpoint forever. A stand-in that lies is worse than a
 * null.
 *
 * COST OF A MISS. The 30s desktop-probe alarm calls this forever, and a
 * failed sweep used to drop the cache and re-sweep on the very next tick:
 * 20 refused connections plus one Supabase round-trip every 30 seconds, for
 * the whole life of the browser, for everyone who does not run matrx-local.
 * Chrome prints every refused connection to the console whether or not the
 * fetch is caught, so that is a wall of red for a condition that is not an
 * error at all. Resolution is therefore two-tiered:
 *
 *   Tier A — re-probe the LAST PORT that ever worked. One request, never
 *            rate-limited, so "user just launched the desktop app" is still
 *            noticed within one alarm tick. Skipped entirely when no port
 *            has ever worked, which is the no-desktop user: they pay zero.
 *   Tier B — the 20-port sweep, rate-limited by SWEEP_BACKOFF_MS after
 *            consecutive misses (30s, 1min, then 2min forever). The ceiling
 *            is small on purpose: while the gate is shut this function says
 *            "no engine", so the ceiling is the longest a RUNNING engine can
 *            be reported offline.
 *   Tier C — the Supabase tunnel lookup, on its own gate. It must not share
 *            Tier B's, or a remote user — who never has a local engine —
 *            resets the loopback ladder on every hit and pays the full sweep
 *            forever.
 *
 * A human pressing Re-discover goes through the service worker, which owns
 * these counters, and calls `resetEngineDiscoveryBackoff()` there. A reset
 * called in the side panel would only clear that context's own copy.
 */

import { log } from '@/lib/debug/log';
import { DesktopHealthSchema } from '@/lib/desktop/types';
import { getSupabase } from '@/lib/supabase/client';
import { formatDurationMs } from '@ai-matrx/kit/format';

const STORAGE_KEY_CACHE = 'matrxLocalEnginePort';
const STORAGE_KEY_OVERRIDE = 'matrxLocalEnginePortOverride';
/**
 * Last port that ever answered, with no expiry. Distinct from the TTL cache:
 * that one says "this port is good right now", this one says "this is where
 * the engine lives when it is running" and survives every invalidation.
 */
const STORAGE_KEY_LAST_GOOD = 'matrxLocalEngineLastGoodPort';

const PROBE_PORT_RANGE_START = 22140;
const PROBE_PORT_RANGE_END = 22159;
const PROBE_TIMEOUT_MS = 250;
const CACHE_TTL_MS = 30 * 60 * 1000;
const REMOTE_CACHE_TTL_MS = 30 * 1000;
/** How long to wait before asking Supabase for a tunnel URL again. */
const REMOTE_LOOKUP_RETRY_MS = 60 * 1000;
/**
 * Wait after the Nth consecutive empty sweep before sweeping again; the last
 * entry is the CEILING, and the ceiling is deliberately small.
 *
 * A long ladder trades console noise for a lie: while the sweep is gated,
 * `getEngineBaseUrl()` answers "no engine" — and a running engine reported
 * offline is what `desktop_run_command` shows the user as "matrx-local is
 * not running" while the app is open on their dock. Two minutes is the most
 * this may ever be wrong by; Tier A covers the common restart instantly, and
 * `resetEngineDiscoveryBackoff()` makes a human's Re-discover immediate.
 */
const SWEEP_BACKOFF_MS = [30_000, 60_000, 120_000] as const;

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
let remoteCache: { baseUrl: string; expiresAt: number } | null = null;
let consecutiveEmptySweeps = 0;
let nextSweepAllowedAt = 0;
/**
 * The tunnel lookup has its OWN gate. Sharing the local one made the rate
 * limit a no-op for exactly the people who can never satisfy it: a remote
 * engine resolves, which reset the local counters, so the next tick re-swept
 * all twenty loopback ports — forever, for a user who has no local engine at
 * all and never will.
 */
let nextRemoteLookupAllowedAt = 0;
/** Warn once per outage, not once per 30s tick. */
let overrideReportedDead = false;

/**
 * Clear the full-sweep rate limit so the next resolve scans immediately.
 *
 * For explicit human actions ONLY (Settings → Desktop Bridge, Debug →
 * Bridges → Re-discover). A background poll must never call this, or the
 * rate limit means nothing and the console noise comes straight back.
 */
export function resetEngineDiscoveryBackoff(): void {
  consecutiveEmptySweeps = 0;
  nextSweepAllowedAt = 0;
  nextRemoteLookupAllowedAt = 0;
}

export async function getEngineBaseUrl(): Promise<string | null> {
  const override = await getEnginePortOverride();
  if (override !== null) {
    // An override is an explicit instruction about WHICH engine to talk to,
    // so a dead one is never silently replaced by whatever else answers the
    // scan — that could cross-connect a developer to the wrong engine. But
    // it must not be a silent permanent outage either: it skipped every
    // probe, and no transport failure or Re-discover could dislodge it, so
    // one stale override meant "matrx-local is not running" forever with
    // the app open. Probe it, and say exactly what is wrong when it is dead.
    const alive = await probeOne(override).catch(() => null);
    if (alive !== null) {
      overrideReportedDead = false;
      return `http://127.0.0.1:${override}`;
    }
    if (!overrideReportedDead) {
      overrideReportedDead = true;
      log.warn(
        'desktop',
        `desktop port override 127.0.0.1:${override} is not answering — no engine there. Clear or correct it in Settings → Desktop Bridge; auto-discovery stays off while an override is set.`,
      );
    }
    return null;
  }
  overrideReportedDead = false;

  const cached = await readCachedEntry();
  if (cached && cached.expiresAt > Date.now()) {
    return `http://127.0.0.1:${cached.port}`;
  }
  if (remoteCache && remoteCache.expiresAt > Date.now()) {
    return remoteCache.baseUrl;
  }

  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      // Tier A — the port that worked last time. One request, always
      // allowed, so the engine coming back on its usual port is noticed on
      // the next alarm tick rather than after a backoff.
      const lastGood = await readLastGoodPort();
      if (lastGood !== null) {
        const hit = await probeOne(lastGood).catch(() => null);
        if (hit !== null) return await acceptPort(hit);
      }

      // Tier B — the full loopback sweep, rate-limited on its own gate.
      const sweepAllowed = Date.now() >= nextSweepAllowedAt;
      if (sweepAllowed) {
        const port = await probePortRange();
        if (port !== null) return await acceptPort(port);
        // The sweep found nothing: drop the TTL cache so a later call
        // re-probes rather than serving a dead port, and back off.
        await invalidateEnginePortCache();
        backOffSweep();
      }

      // Tier C — the tunnel. Gated separately, and a hit here NEVER resets
      // the loopback ladder: a remote user's local sweep is still failing
      // and must stay backed off.
      if (Date.now() >= nextRemoteLookupAllowedAt) {
        const remote = await discoverRemoteEngineBaseUrl();
        if (remote) {
          nextRemoteLookupAllowedAt = 0;
          return remote;
        }
        nextRemoteLookupAllowedAt = Date.now() + REMOTE_LOOKUP_RETRY_MS;
      }
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function acceptPort(port: number): Promise<string> {
  consecutiveEmptySweeps = 0;
  nextSweepAllowedAt = 0;
  nextRemoteLookupAllowedAt = 0;
  await writeCachedEntry({ port, expiresAt: Date.now() + CACHE_TTL_MS });
  await writeLastGoodPort(port);
  return `http://127.0.0.1:${port}`;
}

function backOffSweep(): void {
  const idx = Math.min(consecutiveEmptySweeps, SWEEP_BACKOFF_MS.length - 1);
  const wait = SWEEP_BACKOFF_MS[idx] ?? SWEEP_BACKOFF_MS[SWEEP_BACKOFF_MS.length - 1] ?? 900_000;
  consecutiveEmptySweeps += 1;
  nextSweepAllowedAt = Date.now() + wait;
  if (wait > 0 && consecutiveEmptySweeps <= SWEEP_BACKOFF_MS.length) {
    // Say it once per rung, not once per tick: a missing desktop app is a
    // normal state, and this line exists so a REAL outage is still visible.
    log.info(
      'desktop',
      `engine not found on 127.0.0.1:${PROBE_PORT_RANGE_START}-${PROBE_PORT_RANGE_END} — next full scan in ${formatDurationMs(wait, { style: 'compact' })}`,
    );
  }
}

async function readLastGoodPort(): Promise<number | null> {
  const r = await chrome.storage.local.get([STORAGE_KEY_LAST_GOOD]);
  const v = r[STORAGE_KEY_LAST_GOOD];
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 65535 ? v : null;
}

async function writeLastGoodPort(port: number): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_LAST_GOOD]: port });
}

export async function invalidateEnginePortCache(): Promise<void> {
  remoteCache = null;
  await chrome.storage.local.remove([STORAGE_KEY_CACHE]);
}

interface RemoteEngineRow {
  instance_id: string;
  instance_name: string;
  tunnel_url: string;
  last_seen: string;
}

async function discoverRemoteEngineBaseUrl(): Promise<string | null> {
  if (remoteCache && remoteCache.expiresAt > Date.now()) {
    return remoteCache.baseUrl;
  }

  try {
    const { data, error } = await getSupabase()
      .from('app_instances')
      .select('instance_id,instance_name,tunnel_url,last_seen')
      .eq('is_active', true)
      .eq('tunnel_active', true)
      .is('deleted_at', null)
      .not('tunnel_url', 'is', null)
      .order('last_seen', { ascending: false })
      .limit(1);

    if (error) {
      log.warn('desktop', 'remote engine discovery failed', error.message);
      return null;
    }
    const row = (data?.[0] ?? null) as RemoteEngineRow | null;
    if (!row) return null;

    const parsed = new URL(row.tunnel_url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      log.warn('desktop', 'remote engine discovery rejected unsafe tunnel URL', {
        instanceId: row.instance_id,
        protocol: parsed.protocol,
      });
      return null;
    }

    const baseUrl = parsed.origin;
    remoteCache = { baseUrl, expiresAt: Date.now() + REMOTE_CACHE_TTL_MS };
    log.info('desktop', 'remote engine discovered from app_instances', {
      instanceId: row.instance_id,
      instanceName: row.instance_name,
      lastSeen: row.last_seen,
    });
    return baseUrl;
  } catch (err) {
    log.warn('desktop', 'remote engine discovery crashed', (err as Error).message);
    return null;
  }
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
