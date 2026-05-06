/**
 * Build-time environment configuration. Values come from .env.* files.
 *
 * Backend URL selection is RUNTIME-only via src/config/backend.ts — there is
 * no build-time default backend or URL override. Production is always the
 * fallback; only an admin can change it at runtime.
 *
 * ⚠ Two constraints, both real:
 *
 *   1. Vite STATICALLY replaces `import.meta.env.WXT_FOO` (literal property
 *      access) at build time with the actual value. Dynamic access like
 *      `import.meta.env[key]` is NOT replaced — at runtime, that object
 *      only contains Vite's built-in keys (MODE/DEV/PROD/SSR). Each env
 *      var must therefore be referenced by literal name in source.
 *
 *   2. The catalog script (scripts/dump-tool-catalog.ts) walks the tool
 *      registry under plain `tsx`, where `import.meta.env` is undefined.
 *      The module must therefore be importable without throwing on load
 *      — reads are deferred via getters and wrapped in try/catch so the
 *      throw only happens on actual access, not at import time.
 *
 *   Together those mean: each env var gets its own getter, with a literal
 *   `import.meta.env.WXT_FOO` access guarded by try/catch. Don't refactor
 *   to a generic `getEnv(key)` helper — that breaks Vite's literal-pattern
 *   replacement and the var disappears at runtime (the 0.1.7 → 0.1.8
 *   "Missing required env var" incident).
 */

export type BackendEnv = 'prod' | 'staging' | 'dev' | 'local';

// Wraps a literal `import.meta.env.X` access. In Vite/WXT, the access is
// replaced at build time with a string literal and this function returns it.
// In plain tsx (catalog script), `import.meta.env` is undefined and the
// access throws TypeError; we catch it and return undefined so callers can
// decide whether to throw a meaningful error or fall back to a default.
const safeRead = (read: () => unknown): string | undefined => {
  try {
    const v = read();
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
};

const required = (label: string, value: string | undefined): string => {
  if (value) return value;
  throw new Error(
    `Missing required env var: ${label}. ` +
      'This usually means the module was loaded outside of Vite/WXT ' +
      '(e.g. a tsx script). Either avoid touching ENV from script context, ' +
      'or run inside the WXT build.',
  );
};

export const ENV = {
  get SUPABASE_URL(): string {
    return required(
      'WXT_SUPABASE_URL',
      safeRead(() => import.meta.env.WXT_SUPABASE_URL),
    );
  },
  get SUPABASE_PUBLISHABLE_KEY(): string {
    return required(
      'WXT_SUPABASE_PUBLISHABLE_KEY',
      safeRead(() => import.meta.env.WXT_SUPABASE_PUBLISHABLE_KEY),
    );
  },
  get EXTENSION_OAUTH_CLIENT_ID(): string {
    return safeRead(() => import.meta.env.WXT_EXTENSION_OAUTH_CLIENT_ID) ?? '';
  },
  get DESKTOP_LOCAL_URL(): string {
    return safeRead(() => import.meta.env.WXT_DESKTOP_LOCAL_URL) ?? 'http://127.0.0.1:22180';
  },
  get DESKTOP_NATIVE_HOST(): string {
    return safeRead(() => import.meta.env.WXT_DESKTOP_NATIVE_HOST) ?? 'com.matrx.local';
  },
  get FRONTEND_URL(): string {
    return safeRead(() => import.meta.env.WXT_FRONTEND_URL) ?? 'https://aimatrx.com';
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
