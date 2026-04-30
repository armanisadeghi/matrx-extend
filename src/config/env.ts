/**
 * Build-time environment configuration. Values come from .env.* files.
 * Runtime overrides for backend/desktop URLs live in chrome.storage.sync
 * and are read via getApiBaseUrl() / getDesktopUrl() in their respective modules.
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
  DEFAULT_BACKEND: (optionalEnv('WXT_DEFAULT_BACKEND') ?? 'prod') as BackendEnv,
  BACKEND_URL_OVERRIDE: optionalEnv('WXT_BACKEND_URL'),
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
  // chrome.storage.sync — small, persistent, cross-device user prefs
  BACKEND_ENV: 'matrx.backend.env',
  BACKEND_URL_OVERRIDE: 'matrx.backend.urlOverride',
  THEME: 'matrx.theme',
  // chrome.storage.local — extension-local data
  USER_PROFILE: 'matrx.user.profile',
  ACCESS_TOKEN: 'matrx.auth.accessToken', // promoted to session-only when SW supports it cleanly
  REFRESH_TOKEN_ENC: 'matrx.auth.refreshTokenEnc',
  REFRESH_TOKEN_IV: 'matrx.auth.refreshTokenIv',
  TOKEN_EXPIRES_AT: 'matrx.auth.expiresAt',
  DESKTOP_PAIR_TOKEN: 'matrx.desktop.pairToken',
  // chrome.storage.session — short-lived, in-memory
  PKCE_VERIFIER: 'matrx.pkce.verifier',
  PKCE_STATE: 'matrx.pkce.state',
} as const;

export const ALARMS = {
  TOKEN_REFRESH: 'matrx.alarm.tokenRefresh',
  DESKTOP_PROBE: 'matrx.alarm.desktopProbe',
  SCRAPE_QUEUE_POLL: 'matrx.alarm.scrapeQueuePoll',
} as const;
