/**
 * Build-time environment configuration. Values come from .env.* files.
 *
 * Backend URL selection is RUNTIME-only via src/config/backend.ts — there is
 * no build-time default backend or URL override. Production is always the
 * fallback; only an admin can change it at runtime.
 */

export type BackendEnv = 'prod' | 'staging' | 'dev' | 'local';

const requireEnv = (key: keyof ImportMetaEnv): string => {
  const value = import.meta.env[key];
  if (!value || typeof value !== 'string') {
    throw new Error(`Missing required env var: ${String(key)}`);
  }
  return value;
};

const optionalEnv = (key: keyof ImportMetaEnv): string | undefined => {
  const value = import.meta.env[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

export const ENV = {
  SUPABASE_URL: requireEnv('WXT_SUPABASE_URL'),
  SUPABASE_PUBLISHABLE_KEY: requireEnv('WXT_SUPABASE_PUBLISHABLE_KEY'),
  EXTENSION_OAUTH_CLIENT_ID: optionalEnv('WXT_EXTENSION_OAUTH_CLIENT_ID') ?? '',
  DESKTOP_LOCAL_URL: optionalEnv('WXT_DESKTOP_LOCAL_URL') ?? 'http://127.0.0.1:22180',
  DESKTOP_NATIVE_HOST: optionalEnv('WXT_DESKTOP_NATIVE_HOST') ?? 'com.matrx.local',
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
} as const;
