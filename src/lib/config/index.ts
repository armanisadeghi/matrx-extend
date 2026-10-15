import { ENV } from '@/config/env';
import { log } from '@/lib/debug/log';
import { createAppConfigReader } from '@ai-matrx/data/app-config';
/**
 * The extension's ONE config door. Every app-config key and feature-knob read goes through here so
 * each is counted (key + where the value came from) and reported by the service worker for config
 * attestation. Raw `knob_resolve` / `knob_snapshot` / `from('app_config')` outside src/lib/config/ is
 * refused by `pnpm check:config-reads`. Nothing here swallows a failure: every refusal is a counted
 * warning in `configHealth()`.
 */
import type { ConfigReadRecorder } from '@ai-matrx/data/config-attestation';
import type { ConfigValueSource } from '@ai-matrx/data/config-attestation';
import { buildSha } from './build-sha';
import { BUNDLED_APP_CONFIG } from './bundled-app-config';
import { APP_SLUG, type AppConfigKey, REGISTERED_KNOBS } from './registry';

const CACHE_STORAGE_KEY = 'matrx.config.appConfigRow';
const FORWARD_KIND = 'matrx.config.read';

const counters = new Map<string, number>();
/** Counted, visible warnings (law 4): event → how many times this context has seen it. */
export function configHealth(): Record<string, number> {
  return Object.fromEntries(counters);
}
export function countConfigEvent(
  event: string,
  data: Record<string, unknown> = {},
  level: 'warn' | 'error' = 'warn',
): void {
  counters.set(event, (counters.get(event) ?? 0) + 1);
  log[level]('sys', event, { ...data, count: counters.get(event) });
}

export function isServiceWorker(): boolean {
  return (
    typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope
  );
}

let realRecorder: ConfigReadRecorder | null = null;
const pendingBeforeRecorder: Array<(r: ConfigReadRecorder) => void> = [];

/** Called by the service worker once the recorder is built; replays reads made before it existed. */
export function attachRecorder(r: ConfigReadRecorder): void {
  realRecorder = r;
  for (const apply of pendingBeforeRecorder.splice(0)) apply(r);
}

type ReadArg = Parameters<ConfigReadRecorder['read']>[0];
type MissingArg = Parameters<ConfigReadRecorder['missing']>[0];

const CHANNEL = 'matrx-config-reads';
let channel: BroadcastChannel | null = null;
function forward(payload: { read?: ReadArg; missing?: MissingArg }, key: string): void {
  try {
    // Same-origin extension pages reach the service worker over BroadcastChannel (no runtime-message traffic).
    channel ??= new BroadcastChannel(CHANNEL);
    channel.postMessage({ kind: FORWARD_KIND, ...payload });
  } catch {
    countConfigEvent('config.read_forward_failed', { key });
  }
}

function routeRead(read: ReadArg): void {
  if (isServiceWorker()) {
    if (realRecorder) realRecorder.read(read);
    else pendingBeforeRecorder.push((r) => r.read(read));
    return;
  }
  forward({ read }, read.key);
}

function routeMissing(m: MissingArg): void {
  if (isServiceWorker()) {
    if (realRecorder) realRecorder.missing(m);
    else pendingBeforeRecorder.push((r) => r.missing(m));
    return;
  }
  forward({ missing: m }, m.key);
}

/** The service worker installs this once: reads forwarded from the panel/pages land in the recorder. */
export function listenForForwardedReads(): void {
  const inbound = new BroadcastChannel(CHANNEL);
  inbound.onmessage = (ev: MessageEvent) => {
    const m = ev.data as { kind?: string; read?: ReadArg; missing?: MissingArg } | null;
    if (m?.kind !== FORWARD_KIND) return;
    if (m.read) routeRead(m.read);
    if (m.missing) routeMissing(m.missing);
  };
}

const forwardingRecorder: ConfigReadRecorder = {
  read: routeRead,
  missing: routeMissing,
  applied: () => undefined,
};

let cachedRow: unknown;
let reader: ReturnType<typeof createAppConfigReader> | null = null;

/** The build bootstrap; outside a WXT build (tests, tsx) it is absent, so live reads fail loudly and the seed serves. */
function bootstrapValue(read: () => string): string {
  try {
    return read();
  } catch (error) {
    countConfigEvent('config.bootstrap_missing', { error: String(error).slice(0, 120) });
    return '';
  }
}

function getReader() {
  if (reader) return reader;
  reader = createAppConfigReader({
    app: APP_SLUG,
    bootstrap: {
      databaseUrl: bootstrapValue(() => ENV.SUPABASE_URL),
      publishableKey: bootstrapValue(() => ENV.SUPABASE_PUBLISHABLE_KEY),
      serverUrl: BUNDLED_APP_CONFIG.config.aidream_server_url,
    },
    bundled: BUNDLED_APP_CONFIG,
    cache: {
      load: () => cachedRow,
      save: (row) => {
        cachedRow = row;
        void chrome.storage.local.set({ [CACHE_STORAGE_KEY]: row });
      },
    },
    log: (level, event, data) =>
      level === 'info'
        ? log.info('sys', event, data)
        : countConfigEvent(event, data, level === 'error' ? 'error' : 'warn'),
    recorder: forwardingRecorder,
  });
  reader.load();
  return reader;
}

/** Load the last-seen row from disk into memory (every context calls this at boot). */
export async function initAppConfig(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(CACHE_STORAGE_KEY);
    cachedRow = stored[CACHE_STORAGE_KEY];
    getReader().load();
  } catch (error) {
    countConfigEvent('config.cache_load_failed', { error: String(error).slice(0, 200) });
  }
}

/** Service worker: read the live row now and every 10 minutes. */
export function startAppConfig(): () => void {
  return getReader().start();
}

/** THE app-config read: one call = one counted read. */
export function appConfig<T = string>(key: AppConfigKey): T {
  return getReader().get(key as never) as unknown as T;
}

/** Record one knob read (explicit call sites and the platform snapshot). An unregistered key is a counted `missing`. */
export function recordKnobRead(fullKey: string, source: ConfigValueSource): void {
  if (!REGISTERED_KNOBS.has(fullKey)) {
    countConfigEvent('config.knob_read_not_in_registry', { key: fullKey });
    const i = fullKey.lastIndexOf('.');
    routeMissing({ kind: 'knob', feature: fullKey.slice(0, i), key: fullKey.slice(i + 1) });
    return;
  }
  const i = fullKey.lastIndexOf('.');
  routeRead({ kind: 'knob', feature: fullKey.slice(0, i), key: fullKey.slice(i + 1), source });
}

export { buildSha };
