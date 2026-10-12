/**
 * The extension's injector over `@ai-matrx/api`. The package owns the wire
 * (methods, bodies, streams, upload progress, redirect/cache, retry, the
 * session-ready wait, 401 → refresh → one retry, request ids). This file only
 * supplies what the package cannot know: the backend URL, the result shape
 * callers read (`ApiResult`), and THE one header builder (`buildHeaders`)
 * for the few callers that send outside the wire (the offscreen stream relay,
 * the manual-server probe, the sealed private lane). Credentials and the
 * pinned-actor refresh live in matrx-api.ts / session-credentials.ts.
 */

import { getBackendUrl } from '@/config/backend';
import {
  awaitSessionReady,
  currentBearerOrRefuse,
  sessionCredentials,
} from '@/lib/api/session-credentials';
import { log } from '@/lib/debug/log';
import { getActiveOrganizationId } from '@/lib/org/active-org';
import { applyOrganizationContextHeader } from '@ai-matrx/api';
import { credentialToHeaders } from '@ai-matrx/auth/credentials';
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
 * Status sentinel for "this request was never sent, because no organization
 * is selected". Every authenticated request to the platform carries BOTH the
 * user and the organization it acts in; the server's AuthMiddleware refuses
 * one without an organization, so sending it anyway would burn a round-trip
 * to earn a 400 the user cannot interpret. We refuse before I/O and hand the
 * UI a remedy instead (law 4: nothing fails silently).
 */
export const STATUS_NO_ORGANIZATION = -2;

/** The pinned user or organization changed before dispatch; no HTTP response exists. */
export const STATUS_EXPECTED_ACTOR_MISMATCH = -4;

/**
 * Status sentinel for "this request was never sent, because a signed-in
 * session has no readable bearer yet". 🚨 THE GUEST-DOWNGRADE DEFECT
 * (2026-09-19): a fresh install signed in, the side panel mounted its chat
 * surfaces, and the FIRST calls (`/mandates/extend.browser_chat/resolution`,
 * `/api/compute-targets/`) went out a beat before the bearer was readable.
 * `buildHeaders` silently fell back to the GUEST fingerprint, the server
 * correctly answered 401, and the agent picker showed "the server refused to
 * resolve it" for the whole session. A signed-in surface never speaks as a
 * guest: when the stored profile says signed in and no bearer can be read,
 * the request waits briefly for the session to settle and is then REFUSED
 * with this status and a remedy — never downgraded.
 */
export const STATUS_SESSION_NOT_READY = -3;

export { SessionNotReadyError } from '@/lib/api/session-credentials';

/**
 * The bearer for this request, or `null` ONLY when nobody is signed in on this
 * install; a signed-in install with no readable bearer waits (bounded) and is
 * then refused with `SessionNotReadyError` — see session-credentials.ts.
 */
export async function readSessionBearer(): Promise<string | null> {
  await awaitSessionReady();
  return currentBearerOrRefuse();
}

/**
 * The organization-context header NAME, derived from the package kernel that
 * writes it rather than typed a second time here. `the request path` reads the
 * header back to decide whether the request may be sent at all, and two
 * independent spellings of one header is exactly how a rename turns a
 * fail-closed check into a silent fail-open. Pinned by `ai-protocol.test.ts`.
 *
 * The probe id is a real UUID because the kernel VALIDATES what it binds.
 */
export const ORGANIZATION_CONTEXT_HEADER = Object.keys(
  applyOrganizationContextHeader({}, '00000000-0000-4000-8000-000000000000'),
)[0] as string;

/** Default per-request deadline for callers that outlast nothing (the wire applies it to every call). */
export const DEFAULT_TIMEOUT_MS = 30_000;

export async function getApiBaseUrl(): Promise<string> {
  return getBackendUrl();
}

/** Caller headers minus the ones the transport owns (any case): bearer, organization, fingerprint. */
export function withoutOwnedHeaders(headers: Record<string, string>): Record<string, string> {
  const owned = ['authorization', ORGANIZATION_CONTEXT_HEADER.toLowerCase(), 'x-fingerprint-id'];
  return Object.fromEntries(
    Object.entries(headers).filter(([k]) => !owned.includes(k.toLowerCase())),
  );
}

/**
 * THE one header builder for sends that leave outside the package wire. Same
 * credential mapping as the wire (`credentialToHeaders`), same org binding.
 * A caller cannot override the bearer, organization or fingerprint.
 */
export async function buildHeaders(
  extra: Record<string, string> = {},
  bound?: { token: string | null; organizationId: string | null },
): Promise<Record<string, string>> {
  if (!bound?.token) await awaitSessionReady();
  const credential = bound?.token
    ? ({ kind: 'user', accessToken: bound.token } as const)
    : await sessionCredentials.get();
  let headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...withoutOwnedHeaders(extra),
    ...(credential ? credentialToHeaders(credential) : {}),
  };
  if (credential?.kind === 'user') {
    const organizationId = bound?.organizationId ?? (await getActiveOrganizationId());
    if (organizationId) {
      try {
        headers = applyOrganizationContextHeader(headers, organizationId);
      } catch (err) {
        // Fail closed: a malformed stored id is never bound; callers see the missing org.
        log.error('api', 'stored organization id is malformed — not binding it', err);
      }
    }
  }
  return headers;
}

export interface ApiRequestOptions {
  silent?: boolean;
  /** This call's deadline in ms when its legitimate work outlasts DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
  /** The organization this call runs in when it is NOT the active one (an existing record's own). */
  organizationId?: string;
  /** Fail closed unless the actual bearer subject and canonical org still match. */
  expectedActor?: { userId: string; organizationId: string };
  headers?: Record<string, string>;
}

/** Paths an authenticated caller may reach without an organization: liveness and sign-in/identity. */
const ORG_EXEMPT_PATH_PREFIXES = ['/health', '/auth/'] as const;

/** A hand-typed path (not in the generated contract) run through the same package wire. */
async function runPath<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body: unknown,
  signal: AbortSignal | undefined,
  opts: ApiRequestOptions | undefined,
): Promise<ApiResult<T>> {
  const exempt = ORG_EXEMPT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
  const op = {
    m: method,
    p: path,
    d: 'aidream',
    a: 'user',
    o: exempt ? 'exempt' : 'optional',
    n: `ext.${method} ${path.split('?')[0]}`,
  } as const;
  // Lazy: matrx-api imports this module's constants, so a static import would be a load cycle.
  const { runOp } = await import('@/lib/api/matrx-api');
  return runOp((api, o) => api.call<T>(op, body === undefined ? {} : { body }, o), {
    ...opts,
    signal,
    // A signed-in caller always acts in an organization; a guest never does.
    ...(exempt ? {} : { orgForUsers: true }),
  });
}

export const apiGet = <T>(path: string, signal?: AbortSignal, opts?: ApiRequestOptions) =>
  runPath<T>('GET', path, undefined, signal, opts);
export const apiPost = <T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  opts?: ApiRequestOptions,
) => runPath<T>('POST', path, body, signal, opts);
export const apiPatch = <T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  opts?: ApiRequestOptions,
) => runPath<T>('PATCH', path, body, signal, opts);
export const apiPut = <T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  opts?: ApiRequestOptions,
) => runPath<T>('PUT', path, body, signal, opts);
export const apiDelete = <T>(path: string, signal?: AbortSignal, opts?: ApiRequestOptions) =>
  runPath<T>('DELETE', path, undefined, signal, opts);

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
