/**
 * The extension host for Vault's in-place primary confirmation.
 *
 * The parent OAuth session is only read and locally verified. Password/email-code
 * proof happens in a new, non-persisting Supabase client and is exchanged for a
 * session-bound grant through the generated API operation.
 */
import { ENV, STORAGE_KEYS } from '@/config/env';
import { type PackageSession, createPackageApi } from '@/lib/api/matrx-api';
import {
  getAccessTokenStrict,
  getStoredAccessToken,
  refreshAccessTokenStrict,
} from '@/lib/auth/flow';
import { type BearerVerificationResult, verifyBearerClaims } from '@/lib/auth/verify-claims';
import { log } from '@/lib/debug/log';
import { getActiveOrganizationId } from '@/lib/org/active-org';
import type { Api } from '@ai-matrx/api';
import { primaryStepUpGrant } from '@ai-matrx/api/account';
import { createClient } from '@supabase/supabase-js';
import {
  type ConfirmationParent,
  type ExtensionVaultConfirmation,
  type IsolatedConfirmationAuth,
  createVaultConfirmation,
} from './vault-confirmation';

const CACHE_KEY = 'matrx.vault.primary-confirmation.v1';
const LOCK_NAME = 'matrx:vault:primary-confirmation';

export class VaultParentUnverifiableError extends Error {
  override name = 'VaultParentUnverifiableError';
}

type ClaimsVerifier = (token: string) => Promise<BearerVerificationResult>;

export interface ParentSnapshotDeps {
  accessToken(): Promise<string | null>;
  storedAccessToken(): Promise<string | null>;
  activeOrganizationId(): Promise<string | null>;
  verify: ClaimsVerifier;
}

interface ParentSnapshot {
  parent: ConfirmationParent;
  bearer: string;
}

function stringClaim(claims: Record<string, unknown>, key: string): string | null {
  const value = claims[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function providersOf(claims: Record<string, unknown>): Set<string> {
  const metadata = claims.app_metadata;
  if (!metadata || typeof metadata !== 'object') return new Set();
  const row = metadata as { provider?: unknown; providers?: unknown };
  return new Set([
    ...(typeof row.provider === 'string' ? [row.provider] : []),
    ...(Array.isArray(row.providers)
      ? row.providers.filter((provider): provider is string => typeof provider === 'string')
      : []),
  ]);
}

/**
 * Read one stable, verified parent snapshot. Invalid/absent is signed out; an
 * inconclusive verification or a changing token/org is retryable uncertainty.
 */
export async function readParentSnapshot(deps: ParentSnapshotDeps): Promise<ParentSnapshot | null> {
  const bearer = await deps.accessToken();
  if (!bearer) return null;
  const verified = await deps.verify(bearer);
  if (verified.status === 'invalid') return null;
  if (verified.status === 'unverifiable') {
    throw new VaultParentUnverifiableError(
      `Could not verify the current Vault session. Try again. (${verified.reason})`,
    );
  }
  const sessionId = stringClaim(verified.claims, 'session_id');
  if (!sessionId) return null;
  const organizationId = await deps.activeOrganizationId();
  if (!organizationId) return null;
  const [storedAfter, organizationAfter] = await Promise.all([
    deps.storedAccessToken(),
    deps.activeOrganizationId(),
  ]);
  if (storedAfter !== bearer || organizationAfter !== organizationId) {
    throw new VaultParentUnverifiableError(
      'Your Vault session changed while it was being checked. Try again.',
    );
  }
  const providers = providersOf(verified.claims);
  return {
    bearer,
    parent: {
      userId: verified.user.id,
      sessionId,
      organizationId,
      email: verified.user.email,
      // Same inference as createSupabaseIdentity: an email identity means password-capable.
      hasPassword: providers.has('email'),
    },
  };
}

const productionParentDeps: ParentSnapshotDeps = {
  accessToken: getAccessTokenStrict,
  storedAccessToken: getStoredAccessToken,
  activeOrganizationId: getActiveOrganizationId,
  verify: verifyBearerClaims,
};

/** Metadata only: React keys workspaces with this and never retains a bearer. */
export async function readVaultParentMetadata(): Promise<ConfirmationParent | null> {
  return (await readParentSnapshot(productionParentDeps))?.parent ?? null;
}

/** Rerun verified metadata when the canonical OAuth session row changes. */
export function listenForVaultAuthSessionChanges(onChange: () => void): () => void {
  const changed: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
    changes,
    areaName,
  ) => {
    if (areaName === 'local' && changes[STORAGE_KEYS.AUTH_SESSION]) onChange();
  };
  chrome.storage.onChanged.addListener(changed);
  return () => chrome.storage.onChanged.removeListener(changed);
}

export interface VaultConfirmationHost {
  identity: ExtensionVaultConfirmation;
  api: Api;
  dispose(): void;
}

export interface VaultConfirmationHostDeps {
  readSnapshot(): Promise<ParentSnapshot | null>;
  refresh(rejectedBearer?: string): Promise<{ access_token: string } | null>;
  api(organizationId: string, session: PackageSession): Api;
  proofAuth(): IsolatedConfirmationAuth;
  issueGrant(api: Api, proofToken: string): Promise<{ grant: string; expires_in: number }>;
  cache: {
    read(): Promise<unknown>;
    write(value: unknown): Promise<void>;
    remove(): Promise<void>;
  };
  lock<T>(work: () => Promise<T>): Promise<T>;
  cleanupFailed(): void;
}

function sameParent(left: ConfirmationParent, right: ConfirmationParent): boolean {
  return (
    left.userId === right.userId &&
    left.sessionId === right.sessionId &&
    left.organizationId === right.organizationId
  );
}

function pinnedSession(
  expected: ConfirmationParent,
  deps: VaultConfirmationHostDeps,
): PackageSession {
  let rejectedBearer: string | undefined;
  const requireExpected = async (): Promise<ParentSnapshot> => {
    const snapshot = await deps.readSnapshot();
    if (!snapshot || !sameParent(snapshot.parent, expected)) {
      throw new Error('Your account changed. Open your Vault again.');
    }
    rejectedBearer = snapshot.bearer;
    return snapshot;
  };
  return {
    async bearer() {
      return (await requireExpected()).bearer;
    },
    async refresh() {
      const refreshed = await deps.refresh(rejectedBearer);
      if (!refreshed) return false;
      const snapshot = await requireExpected();
      return snapshot.bearer === refreshed.access_token;
    },
  };
}

/** Composition seam used by focused host tests; production dependencies stay below. */
export function composeVaultConfirmationHost(
  parent: ConfirmationParent,
  deps: VaultConfirmationHostDeps,
): VaultConfirmationHost {
  const confirmedSession = pinnedSession(parent, deps);
  const identity: ExtensionVaultConfirmation = createVaultConfirmation({
    actor: { userId: parent.userId, organizationId: parent.organizationId },
    parent: async () => (await deps.readSnapshot())?.parent ?? null,
    auth: deps.proofAuth,
    issueGrant: async (proofToken, confirmedParent) => {
      if (!sameParent(confirmedParent, parent)) {
        throw new Error('Your account changed. Open your Vault again.');
      }
      // Deliberately plain: confirmation headers here would recursively wait on this grant.
      const grantApi = deps.api(parent.organizationId, pinnedSession(parent, deps));
      return deps.issueGrant(grantApi, proofToken);
    },
    cache: deps.cache,
    lock: deps.lock,
    cleanupFailed: deps.cleanupFailed,
  });
  const api = deps.api(parent.organizationId, {
    ...confirmedSession,
    headers: () => identity.headers(),
  });
  return {
    identity,
    api,
    // A completed session-cache grant is shared; only unfinished UI proof is cancelled.
    dispose: () => identity.cancel(),
  };
}

function requireLocks<T>(work: () => Promise<T>): Promise<T> {
  const locks = navigator.locks;
  if (!locks?.request) {
    throw new Error('Secure Vault confirmation locking is unavailable in this browser context.');
  }
  return locks.request(LOCK_NAME, { mode: 'exclusive' }, work);
}

const productionDeps: VaultConfirmationHostDeps = {
  readSnapshot: () => readParentSnapshot(productionParentDeps),
  refresh: refreshAccessTokenStrict,
  api: createPackageApi,
  proofAuth: () => {
    const client = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    // The SDK auth object never escapes this custody boundary. In particular, cleanup always uses
    // local scope so an isolated proof cannot revoke or replace the extension's OAuth session.
    return {
      signInWithPassword: (input) => client.auth.signInWithPassword(input),
      signInWithOtp: (input) => client.auth.signInWithOtp(input),
      verifyOtp: (input) => client.auth.verifyOtp(input),
      signOut: () => client.auth.signOut({ scope: 'local' }),
    } satisfies IsolatedConfirmationAuth;
  },
  issueGrant: (api, proofToken) => primaryStepUpGrant(api, { body: { access_token: proofToken } }),
  cache: {
    async read() {
      return (await chrome.storage.session.get([CACHE_KEY]))[CACHE_KEY];
    },
    async write(value) {
      await chrome.storage.session.set({ [CACHE_KEY]: value });
    },
    async remove() {
      await chrome.storage.session.remove([CACHE_KEY]);
    },
  },
  lock: requireLocks,
  cleanupFailed: () =>
    log.error('auth', 'isolated confirmation session cleanup failed; grant was not published'),
};

export function createVaultConfirmationHost(parent: ConfirmationParent): VaultConfirmationHost {
  return composeVaultConfirmationHost(parent, productionDeps);
}
