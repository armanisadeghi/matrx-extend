/** In-place Vault confirmation over an isolated auth client; never replaces OAuth.
 * The host supplies the generated primary-step-up operation and session-only storage.
 * This controller owns unfinished proof sessions. Completed grants outlive Vault's UI.
 */
import type { IdentityAccount, SupabaseAuthLike, VaultIdentity } from '@ai-matrx/vault';
import { createSupabaseIdentity } from '@ai-matrx/vault';

export interface ConfirmationParent {
  userId: string;
  sessionId: string;
  organizationId: string;
  email: string | null;
  hasPassword: boolean;
}
interface ProofResult {
  data: { user: { id: string } | null; session: { access_token: string } | null };
  error: { message: string } | null;
}
export interface IsolatedConfirmationAuth {
  signInWithPassword(input: { email: string; password: string }): Promise<ProofResult>;
  signInWithOtp(input: { email: string; options?: { shouldCreateUser?: boolean } }): Promise<{
    error: { message: string } | null;
  }>;
  verifyOtp(input: { email: string; token: string; type: 'email' }): Promise<ProofResult>;
  signOut(input: { scope: 'local' }): Promise<{ error: unknown }>;
}
export interface ConfirmationCache {
  id: string;
  userId: string;
  sessionId: string;
  organizationId: string;
  grant: string;
  expiresAtMs: number;
}
export interface ConfirmationDeps {
  actor: { userId: string; organizationId: string };
  /** Verified current OAuth identity. Null means there is no signed-in parent. */
  parent(): Promise<ConfirmationParent | null>;
  /** A NEW client per attempt: persistence/auto-refresh/URL detection all disabled. */
  auth(): IsolatedConfirmationAuth;
  /** Generated operation, authenticated as the unchanged parent session. */
  issueGrant(
    proofToken: string,
    parent: ConfirmationParent,
  ): Promise<{ grant: string; expires_in: number }>;
  /** Shared chrome.storage.session door; never localStorage or OAuth's session key. */
  cache: {
    read(): Promise<unknown>;
    write(value: ConfirmationCache): Promise<void>;
    remove(): Promise<void>;
  };
  /** Cross-context lock shared by every reader/writer of the cache. */
  lock<T>(work: () => Promise<T>): Promise<T>;
  now?: () => number;
  /** Fixed, value-free incident; a failed proof logout is never called clean. */
  cleanupFailed(): void;
}
export interface ExtensionVaultConfirmation extends VaultIdentity {
  cancel(): void;
  headers(): Promise<Record<string, string>>;
}
const CANCELLED = 'Not confirmed.';
const SIGNED_OUT = 'Sign in to use your Vault.';
const CHANGED = 'Your account changed. Open your Vault again.';
const FAILED = 'That confirmation was not accepted. Try again.';
const INCOMPLETE = 'Confirmation did not finish. Close it and try again.';
class ParentChanged extends Error {}
class ConfirmationCancelled extends Error {}

function same(a: ConfirmationParent, b: ConfirmationParent): boolean {
  return (
    a.userId === b.userId && a.sessionId === b.sessionId && a.organizationId === b.organizationId
  );
}
function cached(value: unknown): ConfirmationCache | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<ConfirmationCache>;
  return typeof row.id === 'string' &&
    typeof row.userId === 'string' &&
    typeof row.sessionId === 'string' &&
    typeof row.organizationId === 'string' &&
    typeof row.grant === 'string' &&
    row.grant.length > 0 &&
    typeof row.expiresAtMs === 'number' &&
    Number.isFinite(row.expiresAtMs)
    ? (row as ConfirmationCache)
    : null;
}

export function createVaultConfirmation(deps: ConfirmationDeps): ExtensionVaultConfirmation {
  const now = deps.now ?? Date.now;
  let generation = 0;
  type Attempt = {
    generation: number;
    /** The injected proof port (host-owned SDK custody), not a Supabase client. */
    port: IsolatedConfirmationAuth;
    parent: ConfirmationParent | null;
    running: boolean;
    proof: boolean;
    closed: boolean;
  };
  let email: { attempt: Attempt; identity: VaultIdentity } | null = null;

  const readParent = async () => {
    const parent = await deps.parent();
    if (!parent) throw new ParentChanged(SIGNED_OUT);
    if (parent.userId !== deps.actor.userId || parent.organizationId !== deps.actor.organizationId)
      throw new ParentChanged(CHANGED);
    return parent;
  };
  const check = async (attempt: Attempt) => {
    if (attempt.generation !== generation) throw new ConfirmationCancelled(CANCELLED);
    const parent = await readParent();
    if (attempt.generation !== generation) throw new ConfirmationCancelled(CANCELLED);
    if (attempt.parent && !same(attempt.parent, parent)) throw new ParentChanged(CHANGED);
    attempt.parent = parent;
    return parent;
  };
  const close = async (attempt: Attempt) => {
    if (attempt.closed) return;
    attempt.closed = true;
    try {
      const { error } = await attempt.port.signOut({ scope: 'local' });
      if (error) throw new Error(INCOMPLETE);
    } catch {
      deps.cleanupFailed();
      throw new Error(INCOMPLETE);
    }
  };
  const cancel = () => {
    generation += 1;
    const pending = email;
    email = null;
    if (pending && !pending.attempt.running) void close(pending.attempt).catch(() => undefined);
  };
  const begin = (): Attempt => {
    cancel();
    return {
      generation,
      port: deps.auth(),
      parent: null,
      running: true,
      proof: false,
      closed: false,
    };
  };
  const complete = async (attempt: Attempt, result: ProofResult) => {
    // Mark any returned session owned before validation, so mismatch still ends it.
    attempt.proof = result.data.session !== null;
    if (result.error) return { data: { user: null }, error: { message: FAILED } };
    const parent = await check(attempt);
    const token = result.data.session?.access_token;
    if (!token || result.data.user?.id !== parent.userId) throw new Error(FAILED);
    const started = now();
    const grant = await deps.issueGrant(token, parent);
    await check(attempt);
    if (
      typeof grant.grant !== 'string' ||
      !grant.grant ||
      !Number.isFinite(grant.expires_in) ||
      grant.expires_in <= 0
    )
      throw new Error(INCOMPLETE);
    const entry: ConfirmationCache = {
      id: crypto.randomUUID(),
      userId: parent.userId,
      sessionId: parent.sessionId,
      organizationId: parent.organizationId,
      grant: grant.grant,
      expiresAtMs: started + grant.expires_in * 1000,
    };
    // End the proof BEFORE publishing its grant; a cleanup failure is not success.
    await close(attempt);
    await deps.lock(async () => {
      await check(attempt);
      const previous = cached(await deps.cache.read());
      try {
        await deps.cache.write(entry);
        await check(attempt);
      } catch (error) {
        if (
          error instanceof ParentChanged ||
          error instanceof ConfirmationCancelled ||
          attempt.generation !== generation
        ) {
          // We still hold the cross-context lock: no conforming writer could have
          // replaced our write. Do not depend on another fallible read to undo it.
          if (previous) await deps.cache.write(previous);
          else await deps.cache.remove();
        }
        throw error;
      }
    });
    return { data: { user: { id: parent.userId } }, error: null };
  };
  const identityFor = (attempt: Attempt): VaultIdentity => {
    const auth: SupabaseAuthLike = {
      async getUser() {
        const parent = await check(attempt);
        return {
          data: {
            user: {
              id: parent.userId,
              email: parent.email,
              identities: parent.hasPassword ? [{ provider: 'email' }] : [],
            },
          },
          error: null,
        };
      },
      async signInWithPassword(input) {
        await check(attempt);
        return complete(attempt, await attempt.port.signInWithPassword(input));
      },
      async signInWithOtp(input) {
        await check(attempt);
        return attempt.port.signInWithOtp(input);
      },
      async verifyOtp(input) {
        await check(attempt);
        return complete(attempt, await attempt.port.verifyOtp(input));
      },
      async signInWithOAuth() {
        throw new Error('Confirm here with your password or email code.');
      },
    };
    return createSupabaseIdentity(auth);
  };

  return {
    cancel,
    async account(): Promise<IdentityAccount> {
      const parent = await readParent();
      return { email: parent.email, providers: [], hasPassword: parent.hasPassword };
    },
    async withProvider() {
      throw new Error('Confirm here with your password or email code.');
    },
    async withPassword(password) {
      const attempt = begin();
      try {
        await identityFor(attempt).withPassword(password);
      } finally {
        await close(attempt);
      }
    },
    async sendEmailCode() {
      const attempt = begin();
      const identity = identityFor(attempt);
      try {
        await identity.sendEmailCode();
        await check(attempt);
        attempt.running = false;
        email = { attempt, identity };
      } finally {
        if (email?.attempt !== attempt) await close(attempt);
      }
    },
    async withEmailCode(code) {
      const pending = email;
      if (!pending) throw new Error('Close confirmation and send a new code.');
      pending.attempt.running = true;
      try {
        await pending.identity.withEmailCode(code);
      } finally {
        pending.attempt.running = false;
        if (pending.attempt.proof || pending.attempt.generation !== generation) {
          if (email === pending) email = null;
          await close(pending.attempt);
        }
      }
    },
    async headers() {
      return deps.lock(async () => {
        const row = cached(await deps.cache.read());
        let parent: ConfirmationParent;
        try {
          parent = await readParent();
        } catch (error) {
          if (
            error instanceof ParentChanged &&
            row?.userId === deps.actor.userId &&
            row.organizationId === deps.actor.organizationId
          )
            await deps.cache.remove();
          throw error;
        }
        if (!row) return {};
        if (
          !same(parent, {
            ...parent,
            userId: row.userId,
            sessionId: row.sessionId,
            organizationId: row.organizationId,
          }) ||
          row.expiresAtMs <= now()
        ) {
          await deps.cache.remove();
          return {};
        }
        return { 'X-Matrx-Step-Up': row.grant };
      });
    },
  };
}
