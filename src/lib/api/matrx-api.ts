/**
 * THE one `createApi` instance of this extension, and the `ApiResult` adapter
 * every route function runs its generated `@ai-matrx/api/<domain>` operation
 * through. This file only INJECTS identity and policy the package cannot know:
 * the bearer (with the signed-in-never-guest refusal), the guest fingerprint,
 * the 401 refresh hook, the active organization and the backend URL.
 * Paths, methods, bodies and org rules come from the generated operation.
 */

import { getBackendUrl } from '@/config/backend';
import {
  type ApiRequestOptions,
  type ApiResult,
  STATUS_EXPECTED_ACTOR_MISMATCH,
  STATUS_INVALID_BODY,
  STATUS_NO_ORGANIZATION,
  STATUS_SESSION_NOT_READY,
} from '@/lib/api/client';
import {
  SESSION_READY_TIMEOUT_MS,
  SessionNotReadyError,
  awaitSessionReady,
  currentBearerOrRefuse,
  sessionCredentials,
} from '@/lib/api/session-credentials';
import {
  getAccessToken,
  getStoredAccessToken,
  getVerifiedCurrentUser,
  refreshAccessToken,
} from '@/lib/auth/flow';
import { log } from '@/lib/debug/log';
import { broadcast } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import {
  OrganizationNotSelectedError,
  getActiveOrganizationId,
  isOrganizationNoMembershipsError,
  isOrganizationNotSelectedError,
  requireActiveOrganizationId,
} from '@/lib/org/active-org';
import {
  type Api,
  type CallOptions,
  type CreateApiOptions,
  MatrxApiError,
  OrganizationContextError,
  createApi,
  isNetError,
} from '@ai-matrx/api';

const DEFAULT_TOTAL_TIMEOUT_MS = 30_000;

/** Backend URL for the call in flight (resolveBaseUrl is synchronous). */
let currentBase = '';

let instance: Api | null = null;

function buildApi(
  credentials: NonNullable<CreateApiOptions['credentials']>,
  refresh: boolean,
): Api {
  return createApi({
    credentials,
    resolveBaseUrl: () => currentBase || undefined,
    totalTimeoutMs: DEFAULT_TOTAL_TIMEOUT_MS,
    readyTimeoutMs: SESSION_READY_TIMEOUT_MS,
    ...(refresh
      ? {
          refreshCredentials: async () => {
            log.warn('api', '401 — refreshing & retrying');
            return (await refreshAccessToken(sessionCredentials.lastBearer ?? undefined)) !== null;
          },
        }
      : {}),
    onRequest: (info) => log.info('api', `→ ${info.method} ${info.url}`),
  });
}

export function getMatrxApi(): Api {
  instance ??= buildApi(sessionCredentials, true);
  return instance;
}

/**
 * A call pinned to one person AND organization: verified now, dispatched with
 * exactly that bearer, or refused (`STATUS_EXPECTED_ACTOR_MISMATCH`) — never sent as
 * a different identity after a sign-in or organization switch.
 */
async function pinnedApi(expected: {
  userId: string;
  organizationId: string;
}): Promise<Api | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await awaitSessionReady();
    const token = await currentBearerOrRefuse();
    if (!token) return null;
    const verified = await getVerifiedCurrentUser(token);
    const [after, org] = await Promise.all([getAccessToken(), getActiveOrganizationId()]);
    if (after !== token) continue;
    if (verified?.id !== expected.userId || org !== expected.organizationId) return null;
    sessionCredentials.lastBearer = token;
    return buildApi({ kind: 'user', accessToken: token }, false);
  }
  return null;
}

/** The server's own body, verbatim, so callers can read its structured refusal. */
function errorText(err: MatrxApiError): string {
  const d = err.serverDetail;
  if (typeof d === 'string' && d) return d;
  if (d && typeof d === 'object') return JSON.stringify(d);
  return err.message;
}

function noOrganization(err: unknown): ApiResult<never> {
  const failure =
    isOrganizationNotSelectedError(err) || isOrganizationNoMembershipsError(err)
      ? err
      : new OrganizationNotSelectedError();
  return {
    ok: false,
    status: STATUS_NO_ORGANIZATION,
    error: `${failure.message} ${failure.remedy}`,
  };
}

function isSessionNotReady(err: unknown): err is SessionNotReadyError {
  return err instanceof SessionNotReadyError;
}

async function announceUnauthorized(): Promise<void> {
  // A 401 that survived the refresh-retry: tell the UI, unless a newer bearer exists.
  const rejected = sessionCredentials.lastBearer;
  if (rejected && rejected === (await getStoredAccessToken())) {
    broadcast(CHANNELS.AUTH_STATE_CHANGED, { user: null, isAdmin: false, reason: 'unauthorized' });
  }
}

/**
 * Run one generated operation and answer in the extension's `ApiResult` shape.
 * `call` receives the shared client and the per-call options (signal, org,
 * timeout, headers) — it is the generated function with its args applied:
 * `runOp((api, o) => sendGmail(api, { body }, o), opts)`.
 */
export async function runOp<T>(
  call: (api: Api, options: CallOptions) => Promise<T>,
  opts: ApiRequestOptions & { signal?: AbortSignal | undefined } = {},
): Promise<ApiResult<T>> {
  currentBase = await getBackendUrl();
  const options: CallOptions = {
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.headers ? { headers: opts.headers } : {}),
    ...(opts.timeoutMs !== undefined ? { totalTimeoutMs: opts.timeoutMs } : {}),
  };
  const pinned = opts.expectedActor ? await pinnedApi(opts.expectedActor) : null;
  if (opts.expectedActor && !pinned) {
    return { ok: false, status: STATUS_EXPECTED_ACTOR_MISMATCH, error: 'expected_actor_mismatch' };
  }
  const api = pinned ?? getMatrxApi();
  const attempt = async (): Promise<T> => {
    const organizationId =
      opts.expectedActor?.organizationId ??
      opts.organizationId ??
      (await getActiveOrganizationId());
    return call(api, { ...options, ...(organizationId ? { organizationId } : {}) });
  };
  try {
    try {
      return { ok: true, data: await attempt() };
    } catch (err) {
      if (
        !(err instanceof OrganizationContextError) ||
        err.code !== 'organization_context_required'
      )
        throw err;
      // ONE ORGANIZATION, NEVER A QUESTION: settle it from the load ladder, then retry once.
      const resolved = await requireActiveOrganizationId();
      return { ok: true, data: await call(api, { ...options, organizationId: resolved }) };
    }
  } catch (err) {
    if (isSessionNotReady(err)) {
      return { ok: false, status: STATUS_SESSION_NOT_READY, error: `${err.message} ${err.remedy}` };
    }
    if (
      isOrganizationNotSelectedError(err) ||
      isOrganizationNoMembershipsError(err) ||
      err instanceof OrganizationContextError
    ) {
      return noOrganization(err);
    }
    if (err instanceof MatrxApiError) {
      if (err.status === 401) await announceUnauthorized();
      if (!opts.silent) log.error('api', `✗ ${err.path} ${err.status}`, err.message);
      return { ok: false, status: err.status, error: errorText(err) };
    }
    // The generated JSON operation lets response.json() SyntaxError escape a
    // successful HTTP response. Keep a bad server body distinct from transport.
    if (err instanceof SyntaxError) {
      if (!opts.silent) log.error('api', 'invalid response body', err);
      return {
        ok: false,
        status: STATUS_INVALID_BODY,
        error: `invalid response body: ${err.message}`,
      };
    }
    if (!opts.silent) log.error('api', 'network error', err);
    return {
      ok: false,
      status: 0,
      error: isNetError(err) || err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * `runOp` for callers that own the response shape (a local interface or a zod
 * schema validates it) — the generated result type is deliberately not trusted
 * over the shape the caller already checks.
 */
export function runOpAs<T>(
  call: (api: Api, options: CallOptions) => Promise<unknown>,
  opts: ApiRequestOptions & { signal?: AbortSignal | undefined } = {},
): Promise<ApiResult<T>> {
  return runOp(call, opts) as Promise<ApiResult<T>>;
}
