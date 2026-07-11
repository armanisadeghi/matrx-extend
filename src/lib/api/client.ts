/**
 * REST client. Adds bearer token, handles 401 → refresh → retry once.
 * Streaming lives in src/lib/api/stream.ts (offscreen-buffered for >30s safety).
 *
 * Backend URL resolution is centralized in src/config/backend.ts. This module
 * never reads chrome.storage directly and never knows about env vars.
 */

import { getBackendUrl } from '@/config/backend';
import { getAccessToken, refreshAccessToken } from '@/lib/auth/flow';
import { getOrCreateGuestSignature } from '@/lib/auth/guest-signature';
import { log } from '@/lib/debug/log';
import { broadcast } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import type { z } from 'zod';

type ApiSuccess<T> = { ok: true; data: T };
type ApiFailure = { ok: false; error: string; status: number };
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

/**
 * Status sentinel for "the server replied 2xx but the body failed local
 * validation / parsing". Distinct from 0 (network-down) — callers branching
 * on `status === 0` to say "check your connection" were misdiagnosing server
 * shape bugs as the user's wifi (audit P2-22).
 */
export const STATUS_INVALID_BODY = -1;

/**
 * Default per-request deadline. NO call site passed an AbortSignal before
 * 2026-06-10, so a stalled (not failed) connection hung postToolResults,
 * the chat-send compute-target resolve, the turn-boundary inbox, and file
 * uploads forever (audit P1-2). Callers with longer legitimate work pass
 * their own signal.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else {
    // No signed-in session — fall back to guest fingerprint so the server's
    // AuthMiddleware can resolve us to a stable anonymous auth.users row.
    const sig = await getOrCreateGuestSignature();
    headers['X-Fingerprint-ID'] = sig;
  }
  return { ...headers, ...extra };
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
  // Caller signal + the default deadline. AbortSignal.any (Chrome 116+)
  // combines them; the bare timeout covers the no-signal common case.
  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const signal = opts.signal
    ? typeof AbortSignal.any === 'function'
      ? AbortSignal.any([opts.signal, timeoutSignal])
      : opts.signal
    : timeoutSignal;
  const init: RequestInit = {
    method: opts.method,
    headers,
    signal,
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
    // A 401 that SURVIVED the refresh-retry (or arrived with refresh
    // disabled) means the session is genuinely invalid server-side. No
    // caller anywhere reacts to a 401 result (audit P2-23) — broadcast so
    // the UI can drop into the sign-in state instead of failing every
    // request generically while still claiming "signed in".
    if (res.status === 401 && opts.retryOn401 === false) {
      // Shape matches use-auth's listener: user:null flips the UI to the
      // signed-out state (which shows the sign-in affordance).
      broadcast(CHANNELS.AUTH_STATE_CHANGED, {
        user: null,
        isAdmin: false,
        reason: 'unauthorized',
      });
    }
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
  // Body reads can reject (truncated stream, dying gateway sending invalid
  // JSON under a 200 + application/json) — before this guard the exception
  // escaped rawRequest entirely, violating the ApiResult contract and
  // leaving tool calls / inbox cards stuck (audit P1-3).
  try {
    const ct = res.headers.get('content-type') ?? '';
    const data = ct.includes('application/json')
      ? ((await res.json()) as T)
      : ((await res.text()) as unknown as T);
    log.success('api', `← ${opts.method} ${opts.path} ${res.status} (${ms}ms)`);
    return { ok: true, data };
  } catch (err) {
    if (!opts.silent) {
      log.error('api', `✗ ${opts.method} ${opts.path} invalid response body (${ms}ms)`, err);
    }
    return {
      ok: false,
      status: STATUS_INVALID_BODY,
      error: `invalid response body: ${(err as Error).message}`,
    };
  }
}

export async function apiGet<T>(
  path: string,
  signal?: AbortSignal,
  opts?: { silent?: boolean },
): Promise<ApiResult<T>> {
  return rawRequest<T>({
    method: 'GET',
    path,
    ...(signal !== undefined ? { signal } : {}),
    ...(opts?.silent !== undefined ? { silent: opts.silent } : {}),
  });
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  return rawRequest<T>({ method: 'POST', path, body, ...(signal !== undefined ? { signal } : {}) });
}

export async function apiPatch<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  return rawRequest<T>({
    method: 'PATCH',
    path,
    body,
    ...(signal !== undefined ? { signal } : {}),
  });
}

export async function apiPut<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  return rawRequest<T>({ method: 'PUT', path, body, ...(signal !== undefined ? { signal } : {}) });
}

export async function apiDelete<T>(path: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  return rawRequest<T>({ method: 'DELETE', path, ...(signal !== undefined ? { signal } : {}) });
}

/**
 * Wrap an apiResult with Zod validation. Returns a typed `data` or a parse error.
 */
export function withSchema<T>(result: ApiResult<unknown>, schema: z.ZodType<T>): ApiResult<T> {
  if (!result.ok) return result;
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) {
    console.warn('[matrx-extend] api response failed schema', parsed.error.format());
    // STATUS_INVALID_BODY, not 0 — a schema failure is a server-shape bug,
    // not the user's network (audit P2-22).
    return { ok: false, status: STATUS_INVALID_BODY, error: 'Schema validation failed' };
  }
  return { ok: true, data: parsed.data };
}
