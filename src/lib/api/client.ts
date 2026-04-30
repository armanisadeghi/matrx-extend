/**
 * REST client. Adds bearer token, handles 401 → refresh → retry once.
 * Streaming lives in src/lib/api/stream.ts (offscreen-buffered for >30s safety).
 */

import { BACKEND_URLS, ENV, STORAGE_KEYS } from '@/config/env';
import { getAccessToken, refreshAccessToken } from '@/lib/auth/flow';
import type { z } from 'zod';

type ApiSuccess<T> = { ok: true; data: T };
type ApiFailure = { ok: false; error: string; status: number };
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

let cachedBaseUrl: string | null = null;

export async function getApiBaseUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl;

  // Build-time override wins over everything (used in CI / locked builds).
  if (ENV.BACKEND_URL_OVERRIDE) {
    cachedBaseUrl = ENV.BACKEND_URL_OVERRIDE;
    return cachedBaseUrl;
  }

  // Runtime override (Settings UI) — chrome.storage.sync
  const synced = await chrome.storage.sync.get([
    STORAGE_KEYS.BACKEND_ENV,
    STORAGE_KEYS.BACKEND_URL_OVERRIDE,
  ]);

  const urlOverride = synced[STORAGE_KEYS.BACKEND_URL_OVERRIDE] as string | undefined;
  if (urlOverride && urlOverride.length > 0) {
    cachedBaseUrl = urlOverride.replace(/\/$/, '');
    return cachedBaseUrl;
  }

  const envName =
    (synced[STORAGE_KEYS.BACKEND_ENV] as keyof typeof BACKEND_URLS | undefined) ??
    ENV.DEFAULT_BACKEND;
  cachedBaseUrl = BACKEND_URLS[envName];
  return cachedBaseUrl;
}

/** Invalidate cached base URL — call after Settings change it. */
export function clearApiBaseCache(): void {
  cachedBaseUrl = null;
}

async function buildHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  retryOn401?: boolean;
}

async function rawRequest<T>(opts: RequestOptions): Promise<ApiResult<T>> {
  const baseUrl = await getApiBaseUrl();
  const url = `${baseUrl}${opts.path}`;
  const headers = await buildHeaders(opts.headers);
  const init: RequestInit = {
    method: opts.method,
    headers,
    signal: opts.signal,
  };
  if (opts.body !== undefined && opts.body !== null) {
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, init);
  if (res.status === 401 && opts.retryOn401 !== false) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return rawRequest<T>({ ...opts, retryOn401: false });
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    return { ok: false, status: res.status, error: text || res.statusText };
  }
  if (res.status === 204) {
    return { ok: true, data: undefined as T };
  }
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json')
    ? ((await res.json()) as T)
    : ((await res.text()) as unknown as T);
  return { ok: true, data };
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  return rawRequest<T>({ method: 'GET', path, signal });
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  return rawRequest<T>({ method: 'POST', path, body, signal });
}

export async function apiPatch<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  return rawRequest<T>({ method: 'PATCH', path, body, signal });
}

export async function apiPut<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  return rawRequest<T>({ method: 'PUT', path, body, signal });
}

export async function apiDelete<T>(path: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  return rawRequest<T>({ method: 'DELETE', path, signal });
}

/**
 * Wrap an apiResult with Zod validation. Returns a typed `data` or a parse error.
 */
export function withSchema<T>(result: ApiResult<unknown>, schema: z.ZodType<T>): ApiResult<T> {
  if (!result.ok) return result;
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) {
    console.warn('[matrx-extend] api response failed schema', parsed.error.format());
    return { ok: false, status: 0, error: 'Schema validation failed' };
  }
  return { ok: true, data: parsed.data };
}
