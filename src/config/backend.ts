/**
 * Backend URL — single source of truth.
 *
 * chrome.storage.local is authoritative; every extension context (sidepanel,
 * service worker, offscreen, content script) reads through this module so
 * they all agree. The default is ALWAYS 'prod'. There is no build-time
 * override; only an admin can change it at runtime via Settings.
 *
 * On change, every consumer is notified via chrome.storage.onChanged so the
 * cached URL invalidates everywhere — including across MV3 contexts.
 */

import { useEffect, useState } from 'react';
import { BACKEND_URLS, type BackendEnv, STORAGE_KEYS } from './env';

const FALLBACK: BackendEnv = 'prod';

let cachedEnv: BackendEnv = FALLBACK;
let cachedOverride = '';
let initPromise: Promise<void> | null = null;

const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

async function init(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      if (!chrome?.storage?.local) return;
      const stored = await chrome.storage.local.get([
        STORAGE_KEYS.BACKEND_ENV,
        STORAGE_KEYS.BACKEND_URL_OVERRIDE,
      ]);
      const envVal = stored[STORAGE_KEYS.BACKEND_ENV];
      cachedEnv = isBackendEnv(envVal) ? envVal : FALLBACK;
      const overrideVal = stored[STORAGE_KEYS.BACKEND_URL_OVERRIDE];
      cachedOverride = typeof overrideVal === 'string' ? overrideVal : '';

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        let changed = false;
        const envChange = changes[STORAGE_KEYS.BACKEND_ENV];
        if (envChange) {
          cachedEnv = isBackendEnv(envChange.newValue) ? envChange.newValue : FALLBACK;
          changed = true;
        }
        const overrideChange = changes[STORAGE_KEYS.BACKEND_URL_OVERRIDE];
        if (overrideChange) {
          cachedOverride =
            typeof overrideChange.newValue === 'string' ? overrideChange.newValue : '';
          changed = true;
        }
        if (changed) notify();
      });
    } catch {
      // ignore — defaults are safe
    }
  })();
  return initPromise;
}

function isBackendEnv(v: unknown): v is BackendEnv {
  return v === 'prod' || v === 'staging' || v === 'dev' || v === 'local';
}

/** Async — guaranteed to reflect chrome.storage.local. Call from API client. */
export async function getBackendUrl(): Promise<string> {
  await init();
  const o = cachedOverride.trim();
  if (o) return o.replace(/\/$/, '');
  return BACKEND_URLS[cachedEnv];
}

export async function getBackendEnv(): Promise<BackendEnv> {
  await init();
  return cachedEnv;
}

export async function getBackendOverride(): Promise<string> {
  await init();
  return cachedOverride;
}

/** Admin-only. Writes to chrome.storage.local; onChanged broadcasts to all contexts. */
export async function setBackendEnv(env: BackendEnv): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.BACKEND_ENV]: env });
  // The onChanged listener will update cachedEnv and notify subscribers, but
  // do it eagerly too so the caller's next sync read is correct.
  cachedEnv = env;
  notify();
}

export async function setBackendOverride(url: string): Promise<void> {
  const value = url.trim();
  await chrome.storage.local.set({ [STORAGE_KEYS.BACKEND_URL_OVERRIDE]: value });
  cachedOverride = value;
  notify();
}

/** React hook — re-renders on any change from any context. */
export function useBackendConfig(): {
  env: BackendEnv;
  override: string;
  url: string;
  ready: boolean;
} {
  const [, force] = useState(0);
  const [ready, setReady] = useState(initPromise !== null);

  useEffect(() => {
    let cancelled = false;
    void init().then(() => {
      if (!cancelled) setReady(true);
    });
    const unsub = (() => {
      const fn = () => force((n) => n + 1);
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    })();
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const url = cachedOverride.trim() || BACKEND_URLS[cachedEnv];
  return { env: cachedEnv, override: cachedOverride, url, ready };
}
