/**
 * Build-time environment configuration. Values come from .env.* files.
 *
 * Backend URL selection is RUNTIME-only via src/config/backend.ts — there is
 * no build-time default backend or URL override. Production is always the
 * fallback; only an admin can change it at runtime.
 *
 * ⚠ Lazy on purpose. `import.meta.env` is defined by Vite/WXT at build time
 *   and is `undefined` under plain `tsx`/Node (e.g. when the catalog script
 *   imports a module that transitively imports this file). Reading env vars
 *   eagerly at module load would crash any non-Vite tooling. Reads are
 *   deferred to property access via getters, so files that import ENV but
 *   never touch its fields (registry walk, catalog dump) load safely.
 *
 *   Same rule for any future module: NEVER call requireEnv() at top level.
 *   Wrap it in a getter, a function, or a closure invoked at runtime.
 */

export type BackendEnv = 'prod' | 'staging' | 'dev' | 'local';

// Defensive read: when import.meta.env itself is undefined (tsx in plain
// Node), return undefined rather than throwing TypeError on the indexer.
const readImportMetaEnv = (key: string): string | undefined => {
  const meta = import.meta as unknown as { env?: Record<string, unknown> };
  const value = meta.env?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const requireEnv = (key: keyof ImportMetaEnv): string => {
  const value = readImportMetaEnv(key as string);
  if (!value) {
    throw new Error(
      `Missing required env var: ${String(key)}. ` +
        'This usually means the module was loaded outside of Vite/WXT ' +
        '(e.g. a tsx script). Either avoid touching ENV from script context, ' +
        'or run inside the WXT build.',
    );
  }
  return value;
};

const optionalEnv = (key: keyof ImportMetaEnv): string | undefined =>
  readImportMetaEnv(key as string);

export const ENV = {
  get SUPABASE_URL(): string {
    return requireEnv('WXT_SUPABASE_URL');
  },
  get SUPABASE_PUBLISHABLE_KEY(): string {
    return requireEnv('WXT_SUPABASE_PUBLISHABLE_KEY');
  },
  get EXTENSION_OAUTH_CLIENT_ID(): string {
    return optionalEnv('WXT_EXTENSION_OAUTH_CLIENT_ID') ?? '';
  },
  get DESKTOP_LOCAL_URL(): string {
    return optionalEnv('WXT_DESKTOP_LOCAL_URL') ?? 'http://127.0.0.1:22180';
  },
  get DESKTOP_NATIVE_HOST(): string {
    return optionalEnv('WXT_DESKTOP_NATIVE_HOST') ?? 'com.matrx.local';
  },
} as const;

export const BACKEND_URLS: Readonly<Record<BackendEnv, string>> = {
  prod: 'https://server.app.matrxserver.com',
  staging: 'https://staging.server.app.matrxserver.com',
  dev: 'https://dev.server.app.matrxserver.com',
  local: 'http://localhost:8000',
};

export const STORAGE_KEYS = {
  BACKEND_ENV: 'matrx.backend.env',
  BACKEND_URL_OVERRIDE: 'matrx.backend.urlOverride',
  THEME: 'matrx.theme',
  USER_PROFILE: 'matrx.user.profile',
  IS_ADMIN: 'matrx.user.isAdmin',
  ACCESS_TOKEN: 'matrx.auth.accessToken',
  REFRESH_TOKEN_ENC: 'matrx.auth.refreshTokenEnc',
  REFRESH_TOKEN_IV: 'matrx.auth.refreshTokenIv',
  TOKEN_EXPIRES_AT: 'matrx.auth.expiresAt',
  DESKTOP_PAIR_TOKEN: 'matrx.desktop.pairToken',
  PKCE_VERIFIER: 'matrx.pkce.verifier',
  PKCE_STATE: 'matrx.pkce.state',
} as const;

export const ALARMS = {
  TOKEN_REFRESH: 'matrx.alarm.tokenRefresh',
  DESKTOP_PROBE: 'matrx.alarm.desktopProbe',
  SCRAPE_QUEUE_POLL: 'matrx.alarm.scrapeQueuePoll',
  AGENDA_SCAN: 'matrx.alarm.agendaScan',
} as const;
