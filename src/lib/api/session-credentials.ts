/**
 * The extension's session as a `CredentialsPort`: `ready()` is the
 * session-readiness wait the package awaits before every call, `get()` is the
 * bearer — or the guest fingerprint ONLY when nobody is signed in. A signed-in
 * install whose bearer is not readable is REFUSED (`SessionNotReadyError`),
 * never downgraded to a guest (the 2026-09-19 guest-downgrade defect).
 */

import { describeStoredSession, getAccessToken, getCurrentUser } from '@/lib/auth/flow';
import { getOrCreateGuestSignature } from '@/lib/auth/guest-signature';
import { log } from '@/lib/debug/log';
import type { CredentialsPort } from '@ai-matrx/api';

export class SessionNotReadyError extends Error {
  readonly remedy = 'Wait a moment and try again. If this keeps happening, sign out and back in.';
  constructor() {
    super('You are signed in, but your session is not ready yet, so this request was not sent.');
    this.name = 'SessionNotReadyError';
  }
}

/**
 * `getAccessToken()` is null for a signed-in install ONLY when the stored token
 * is outside its freshness margin AND the refresh returned nothing (a 5xx or a
 * rate limit; a terminal 400/401 signs the install out). Each re-ask is a real
 * refresh attempt, so they are FEW and SPACED. Internal timing, not a knob.
 */
const SESSION_REASK_ATTEMPTS = 2;
const SESSION_REASK_SPACING_MS = 1_000;
/** Upper bound the package gives `ready()` (re-asks plus the refresh round trips). */
export const SESSION_READY_TIMEOUT_MS = 15_000;

/** Resolve once a bearer is readable, nobody is signed in, or the bounded re-asks ran out. */
export async function awaitSessionReady(): Promise<void> {
  if (await getAccessToken()) return;
  if (!(await getCurrentUser())) return;
  for (let attempt = 0; attempt < SESSION_REASK_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, SESSION_REASK_SPACING_MS));
    if (await getAccessToken()) return;
    if (!(await getCurrentUser())) return; // signed out while waiting
  }
}

/** The bearer now, `null` ONLY when nobody is signed in; otherwise refuse. */
export async function currentBearerOrRefuse(): Promise<string | null> {
  const token = await getAccessToken();
  if (token) return token;
  const profile = await getCurrentUser();
  if (!profile) return null;
  const failure = new SessionNotReadyError();
  log.error('api', 'signed in, but no bearer became readable — refusing to send as a guest', {
    userId: profile.id,
    session: await describeStoredSession(),
    remedy: failure.remedy,
  });
  throw failure;
}

/** Remembers the bearer last handed out so the 401 refresh can name the rejected one. */
export const sessionCredentials: CredentialsPort & { lastBearer: string | null } = {
  lastBearer: null,
  ready: awaitSessionReady,
  async get() {
    const token = await currentBearerOrRefuse();
    sessionCredentials.lastBearer = token;
    if (token) return { kind: 'user', accessToken: token };
    return { kind: 'guest', fingerprintId: await getOrCreateGuestSignature() };
  },
};
