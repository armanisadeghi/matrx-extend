/**
 * Mode dispatch — turn a `BrokeredCredential` into a ready-to-use transport.
 *
 * - `proxied` → `brokeredFetch`: provider-wire-shaped HTTP against
 *   `credential.endpoint` with `Authorization: Bearer <token>`. Works for
 *   JSON and SSE responses alike (the gateway is a wire-level pass-through
 *   of the provider's own protocol).
 * - `native_ephemeral` → `nativeConnectionInfo`: the endpoint + token +
 *   protocol hint for a consumer that opens its own connection (WebRTC /
 *   WebSocket realtime sessions, direct provider REST).
 *
 * `credential.endpoint` is DATA. Never hardcode a gateway or provider URL
 * anywhere in this repo — that is what lets the data plane move to an edge
 * worker with zero client changes.
 */

import type { BrokeredCredential } from './types';

export interface NativeConnectionInfo {
  endpoint: string;
  token: string;
  protocol: string;
  model: string | null;
  expiresAt: number;
}

/** Extract what a native_ephemeral consumer needs to open its own session. */
export function nativeConnectionInfo(credential: BrokeredCredential): NativeConnectionInfo {
  if (credential.credential_mode !== 'native_ephemeral') {
    throw new Error(
      `nativeConnectionInfo called with a ${credential.credential_mode} credential (${credential.audience})`,
    );
  }
  return {
    endpoint: credential.endpoint,
    token: credential.token,
    protocol: credential.protocol,
    model: credential.model,
    expiresAt: credential.expires_at,
  };
}

/**
 * Send a provider-shaped request through a proxied credential's gateway.
 *
 * The caller speaks the PROVIDER's protocol (e.g. Anthropic Messages JSON,
 * `stream: true` SSE included) — this helper only supplies the base URL and
 * the Bearer grant. Returns the raw `Response` so callers can stream.
 *
 * A 401 here means the grant expired or was rejected: invalidate + re-mint
 * once at the call site (see `callProxied` in index.ts), then fail loudly.
 */
export async function brokeredFetch(
  credential: BrokeredCredential,
  init: {
    body: unknown;
    method?: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
): Promise<Response> {
  if (credential.credential_mode !== 'proxied') {
    throw new Error(
      `brokeredFetch called with a ${credential.credential_mode} credential (${credential.audience}) — native credentials talk to the provider directly`,
    );
  }
  return fetch(credential.endpoint, {
    method: init.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credential.token}`,
      ...init.headers,
    },
    body: JSON.stringify(init.body),
    ...(init.signal !== undefined ? { signal: init.signal } : {}),
  });
}
