/**
 * CONFIRM IT'S YOU — the extension's `identity` for `@ai-matrx/vault`.
 *
 * The server shows or copies a secret only after a sign-in from the last few
 * minutes: it reads the bearer's `amr` timestamps (aidream
 * `enforce_recent_auth_max_age`). This extension signs in through the Matrx
 * OAuth client, and every authorization-code exchange mints a NEW session whose
 * `amr` is `oauth_provider/authorization_code` stamped at the exchange — proven
 * live against db.matrxserver.com on 2026-10-16. So re-running the extension's
 * own sign-in is the way to confirm, exactly as the desktop app does
 * (`matrx-local` `desktopVaultIdentity`): one offer, "Continue with Browser".
 *
 * Password and email code are not offered: the extension holds no supabase-js
 * session, so neither could refresh the bearer the vault calls carry.
 */

import {
  getStoredAccessToken as readStoredAccessToken,
  restoreSupabaseSession,
  signIn as runSignIn,
} from '@/lib/auth/flow';
import { broadcast } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import type { IdentityAccount, VaultIdentity } from '@ai-matrx/vault';

interface TokenClaims {
  sub?: string;
  iat?: number;
  email?: string;
  amr?: unknown;
}

function claimsOf(token: string | null): TokenClaims {
  const payload = token?.split('.')[1];
  if (!payload) return {};
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as TokenClaims;
  } catch {
    return {};
  }
}

/** When this bearer's person last authenticated: the newest `amr` timestamp, else `iat`. */
export function authenticatedAt(claims: TokenClaims): number {
  const stamps = Array.isArray(claims.amr)
    ? claims.amr
        .map((entry) =>
          entry && typeof entry === 'object' ? (entry as { timestamp?: unknown }).timestamp : null,
        )
        .filter((t): t is number => typeof t === 'number' && Number.isFinite(t) && t > 0)
    : [];
  return stamps.length ? Math.max(...stamps) : (claims.iat ?? 0);
}

/** How long a browser sign-in may take before the dialog stops waiting for it. */
const FRESH_SIGN_IN_WAIT_MS = 5 * 60_000;
const POLL_MS = 1_000;
const SIGNED_OUT = 'You are signed out. Sign in again.';
const SAME_PERSON = 'That signed in a different account. Use the account this vault belongs to.';
const USE_BROWSER = 'Confirm in your browser instead.';
/** The one offer; the dialog labels it "Continue with Browser". */
const BROWSER = 'browser';

export interface ExtensionIdentityDeps {
  /** The stored bearer, read without refreshing. */
  readToken: () => Promise<string | null>;
  /** The interactive sign-in; resolves once stored (Chrome) or when the flow is merely started (Safari). */
  signIn: () => Promise<unknown>;
  /** Told when the sign-in landed a different person, so every surface rereads its session. */
  onDifferentPerson?: () => void;
  /** Told after a fresh sign-in landed, so the realtime client carries the new bearer. */
  onFresh?: () => unknown;
  waitMs?: number;
  pollMs?: number;
}

export function createExtensionVaultIdentity(deps: ExtensionIdentityDeps): VaultIdentity {
  const waitMs = deps.waitMs ?? FRESH_SIGN_IN_WAIT_MS;
  const pollMs = deps.pollMs ?? POLL_MS;

  /** Resolves once a bearer for `userId` authenticated after `before` is stored. */
  const waitForFreshToken = (userId: string, before: number, signInDone: Promise<unknown>) =>
    new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poll);
        if (error) reject(error);
        else resolve();
      };
      const check = async () => {
        if (settled) return;
        const claims = claimsOf(await deps.readToken());
        if (settled || !claims.sub) return;
        if (claims.sub !== userId) {
          deps.onDifferentPerson?.();
          finish(new Error(SAME_PERSON));
        } else if (authenticatedAt(claims) > before) {
          await deps.onFresh?.();
          finish();
        }
      };
      const poll = setInterval(() => void check(), pollMs);
      const timer = setTimeout(
        () => finish(new Error('The browser sign-in did not finish. Try again.')),
        waitMs,
      );
      // A cancelled or failed sign-in ends the wait with its own words; a finished one is checked at once.
      signInDone.then(
        () => void check(),
        (e: unknown) =>
          finish(e instanceof Error ? e : new Error('The sign-in did not finish. Try again.')),
      );
    });

  return {
    async account(): Promise<IdentityAccount> {
      const claims = claimsOf(await deps.readToken());
      if (!claims.sub) throw new Error(SIGNED_OUT);
      // `email: null` keeps the email-code offer off: it could not refresh this extension's bearer.
      return { email: null, providers: [BROWSER], hasPassword: false };
    },
    async withProvider() {
      const claims = claimsOf(await deps.readToken());
      if (!claims.sub) throw new Error(SIGNED_OUT);
      await waitForFreshToken(claims.sub, authenticatedAt(claims), deps.signIn());
    },
    withPassword() {
      return Promise.reject(new Error(USE_BROWSER));
    },
    sendEmailCode() {
      return Promise.reject(new Error(USE_BROWSER));
    },
    withEmailCode() {
      return Promise.reject(new Error(USE_BROWSER));
    },
  };
}

/** The extension's identity, over its own OAuth sign-in. */
export const extensionVaultIdentity: VaultIdentity = createExtensionVaultIdentity({
  readToken: readStoredAccessToken,
  signIn: runSignIn,
  onFresh: restoreSupabaseSession,
  // Every surface rereads the verified session, so no screen keeps showing the previous account.
  // (`broadcast` also fans out in this realm.)
  onDifferentPerson: () => broadcast(CHANNELS.AUTH_STATE_CHANGED, { user: null, isAdmin: false }),
});
