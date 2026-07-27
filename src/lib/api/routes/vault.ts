/**
 * Vault browser-login routes — the ONLY server contract that can hand this
 * extension credential plaintext.
 *
 *   POST /api/vault/browser-login/matches
 *   POST /api/vault/browser-login/{item_id}/materialize
 *   POST /api/vault/browser-login/{item_id}/result
 *
 * Three rules this module exists to enforce:
 *
 * 1. **A real user JWT or nothing.** `src/lib/api/client.ts#buildHeaders`
 *    falls back to an `X-Fingerprint-ID` guest signature when no session
 *    exists — the server REJECTS that identity for this flow. So every call
 *    here is gated on `getAccessToken()` first and reports
 *    `sign_in_required` rather than letting the request go out and come
 *    back as an opaque 401/403.
 * 2. **No second HTTP client.** Everything goes through `apiPost` so bearer
 *    injection, 401-refresh-retry, timeouts, and the structured `ApiResult`
 *    envelope stay in one place.
 * 3. **Nothing here logs a value.** The materialize response carries
 *    plaintext; this module never passes it to `log.*`, never stores it, and
 *    returns it straight to the single caller that consumes it in local
 *    memory (`src/lib/tools/handlers/credential-login.ts`).
 */

import { type ApiResult, apiPost } from '@/lib/api/client';
import { getAccessToken } from '@/lib/auth/flow';
import { log } from '@/lib/debug/log';

const BASE = '/api/vault/browser-login';

/** One safe candidate from `/matches`. Never carries a credential value. */
export interface BrowserLoginMatch {
  item_id: string;
  display_name: string;
  definition_key: string;
  host: string;
}

export interface BrowserLoginMatchesResponse {
  matches: BrowserLoginMatch[];
  count: number;
}

/**
 * The transient payload from `/materialize` (served `Cache-Control: no-store`).
 * PLAINTEXT — the only object in this repo allowed to hold a vault secret.
 * It may live in one handler's local scope and nowhere else: not in
 * chrome.storage, Redux, IndexedDB, localStorage, tool args/results, logs,
 * traces, screenshots, clipboard, analytics, or model context.
 */
export interface BrowserLoginMaterialized {
  item_id: string;
  origin: string;
  username?: string;
  password: string;
}

/** Terminal outcome reported back for auditing. Mirrors the tool's status enum. */
export type BrowserLoginResultStatus =
  | 'authenticated'
  | 'needs_mfa'
  | 'captcha_or_takeover'
  | 'credentials_rejected'
  | 'selection_required'
  | 'no_matching_login'
  | 'unsafe_destination'
  | 'unknown';

/**
 * Reasons a vault call could not even be attempted. Distinct from the tool's
 * status enum so the handler decides how to surface them.
 */
export type VaultCallFailure =
  | { kind: 'sign_in_required' }
  | { kind: 'forbidden' }
  | { kind: 'server_error'; status: number };

/**
 * True only when a genuine signed-in user token exists. The guest-fingerprint
 * identity the rest of the extension treats as first-class is NOT acceptable
 * for any vault operation.
 */
export async function hasRealUserToken(): Promise<boolean> {
  return (await getAccessToken()) !== null;
}

function classifyFailure(status: number): VaultCallFailure {
  if (status === 401) return { kind: 'sign_in_required' };
  if (status === 403) return { kind: 'forbidden' };
  return { kind: 'server_error', status };
}

async function vaultPost<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  if (!(await hasRealUserToken())) {
    // Short-circuit: without a bearer token the client would attach the guest
    // fingerprint and the server would reject it anyway — but opaquely.
    return { ok: false, status: 401, error: 'sign_in_required' };
  }
  return apiPost<T>(path, body);
}

/** Ask the server which permitted login items match the CURRENT tab URL. */
export async function fetchBrowserLoginMatches(
  pageUrl: string,
): Promise<
  { ok: true; data: BrowserLoginMatchesResponse } | { ok: false; failure: VaultCallFailure }
> {
  log.info('api', '→ POST vault/browser-login/matches');
  const r = await vaultPost<BrowserLoginMatchesResponse>(`${BASE}/matches`, { page_url: pageUrl });
  if (!r.ok) return { ok: false, failure: classifyFailure(r.status) };
  const data = r.data;
  if (!data || !Array.isArray(data.matches)) {
    return { ok: false, failure: { kind: 'server_error', status: 200 } };
  }
  log.info('api', `← vault matches count=${data.matches.length}`);
  return { ok: true, data };
}

/**
 * Authorize + decrypt one item for THIS origin. The response is plaintext —
 * the caller must keep it in local scope and drop the reference when done.
 */
export async function materializeBrowserLogin(
  itemId: string,
  params: { pageUrl: string; toolInvocationId: string; clientBuild: string },
): Promise<
  { ok: true; data: BrowserLoginMaterialized } | { ok: false; failure: VaultCallFailure }
> {
  log.info('api', '→ POST vault/browser-login/{item}/materialize');
  const r = await vaultPost<BrowserLoginMaterialized>(
    `${BASE}/${encodeURIComponent(itemId)}/materialize`,
    {
      page_url: params.pageUrl,
      tool_invocation_id: params.toolInvocationId,
      client_build: params.clientBuild,
    },
  );
  if (!r.ok) return { ok: false, failure: classifyFailure(r.status) };
  const data = r.data;
  if (!data || typeof data.password !== 'string' || typeof data.origin !== 'string') {
    // Deliberately does NOT log the body — it may hold a partial credential.
    return { ok: false, failure: { kind: 'server_error', status: 200 } };
  }
  log.info('api', '← vault materialize ok');
  return { ok: true, data };
}

/**
 * Report the terminal outcome for auditing (204). Best-effort: a failure here
 * must never change what the tool returns to the agent.
 */
export async function reportBrowserLoginResult(
  itemId: string,
  params: {
    status: BrowserLoginResultStatus;
    pageUrl?: string | undefined;
    toolInvocationId?: string | undefined;
  },
): Promise<void> {
  const body: Record<string, unknown> = { status: params.status };
  if (params.pageUrl !== undefined) body.page_url = params.pageUrl;
  if (params.toolInvocationId !== undefined) body.tool_invocation_id = params.toolInvocationId;
  const r = await vaultPost<void>(`${BASE}/${encodeURIComponent(itemId)}/result`, body);
  if (!r.ok) {
    log.warn('api', `vault browser-login result POST failed status=${r.status}`);
  }
}
