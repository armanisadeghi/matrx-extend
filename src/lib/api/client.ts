/**
 * REST client. Adds bearer token, handles 401 → refresh → retry once.
 * Streaming lives in src/lib/api/stream.ts (offscreen-buffered for >30s safety).
 *
 * Backend URL resolution is centralized in src/config/backend.ts. This module
 * never reads chrome.storage directly and never knows about env vars.
 */

import { getBackendUrl } from '@/config/backend';
import { getAccessToken, refreshAccessToken } from '@/lib/auth/flow';
import { log } from '@/lib/debug/log';
import type { z } from 'zod';

type ApiSuccess<T> = { ok: true; data: T };
type ApiFailure = { ok: false; error: string; status: number };
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export async function getApiBaseUrl(): Promise<string> {
  return getBackendUrl();
}

/**
 * Compatibility shim — backend.ts already invalidates its cache via
 * chrome.storage.onChanged whenever the env or override changes, so callers
 * no longer need to manually flush. Retained as a no-op for any leftover
 * imports.
 */
export function clearApiBaseCache(): void {
  /* no-op: backend.ts owns invalidation via chrome.storage.onChanged */
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
  /** Suppress the per-request error log line. Caller still gets the structured ApiResult. */
  silent?: boolean;
}

async function rawRequest<T>(opts: RequestOptions): Promise<ApiResult<T>> {
  const baseUrl = await getApiBaseUrl();
  const url = `${baseUrl}${opts.path}`;
  const headers = await buildHeaders(opts.headers);
  const hasAuth = !!headers.Authorization;
  log.info('api', `→ ${opts.method} ${opts.path}`, { url, auth: hasAuth });
  const start = performance.now();
  const init: RequestInit = {
    method: opts.method,
    headers,
    signal: opts.signal,
  };
  if (opts.body !== undefined && opts.body !== null) {
    init.body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (!opts.silent) {
      log.error('api', `✗ ${opts.method} ${opts.path} network error`, err);
    }
    return { ok: false, status: 0, error: (err as Error).message };
  }
  const ms = Math.round(performance.now() - start);
  if (res.status === 401 && opts.retryOn401 !== false) {
    log.warn('api', `← ${opts.path} 401 — refreshing & retrying`);
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return rawRequest<T>({ ...opts, retryOn401: false });
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    if (!opts.silent) {
      log.error('api', `✗ ${opts.method} ${opts.path} ${res.status} (${ms}ms)`, text);
    }
    return { ok: false, status: res.status, error: text || res.statusText };
  }
  if (res.status === 204) {
    log.success('api', `← ${opts.path} 204 (${ms}ms)`);
    return { ok: true, data: undefined as T };
  }
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json')
    ? ((await res.json()) as T)
    : ((await res.text()) as unknown as T);
  log.success('api', `← ${opts.method} ${opts.path} ${res.status} (${ms}ms)`);
  return { ok: true, data };
}

export async function apiGet<T>(
  path: string,
  signal?: AbortSignal,
  opts?: { silent?: boolean },
): Promise<ApiResult<T>> {
  return rawRequest<T>({ method: 'GET', path, signal, silent: opts?.silent });
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
