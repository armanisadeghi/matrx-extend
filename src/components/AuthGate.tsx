import { useAuth } from '@/hooks/use-auth';
import { Button } from '@ai-matrx/design-system';
import { LogIn, RefreshCw, X } from 'lucide-react';
import { useId } from 'react';

/**
 * Pass-through wrapper. Kept as a named component so existing call sites
 * (sidepanel App.tsx) don't need to change. As of the guest-mode rollout
 * (2026-05-16) the extension never blocks on sign-in — the SW resolves
 * the caller via X-Fingerprint-ID when there's no Supabase session. The
 * audience switchboard exposes Chat and the local Scrape, Data, SEO, and
 * Settings tabs to guests.
 *
 * Sign-in remains available from the user menu.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  // Eager-boot the auth hook here so the one-time boot (restore Supabase
  // session, refresh admin flag) still runs on cold sidepanel open even if
  // no other early component subscribes. The hook is internally guarded
  // against double boot.
  const { error, sessionEnded } = useAuth();
  return (
    <>
      {sessionEnded ? <SessionEndedCard /> : error ? <AuthNotice /> : null}
      {children}
    </>
  );
}

/**
 * The saved account could not be restored (usually an expired session). The
 * panel works as a guest, so this is a choice, not a failure: sign back in, or
 * keep going as a guest (which forgets the stale account on this device).
 */
export function SessionEndedCard() {
  const { status, signIn, retry, continueAsGuest } = useAuth();
  const busy = status === 'signing-in';
  const titleId = useId();
  return (
    <div className="shrink-0 px-3 pt-3">
      <section
        role="alert"
        aria-labelledby={titleId}
        className="rounded-xl border border-border bg-card px-3.5 py-3 shadow-sm"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LogIn className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-sm font-medium text-foreground">
              You've been signed out
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Sign in to pick up where you left off, or keep going as a guest.
            </p>
          </div>
          <button
            type="button"
            aria-label="Try restoring my sign-in again"
            title="Try again"
            disabled={busy}
            onClick={() => void retry()}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <Button size="sm" className="flex-1" disabled={busy} onClick={() => void signIn()}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            disabled={busy}
            onClick={() => void continueAsGuest()}
          >
            Use as guest
          </Button>
        </div>
      </section>
    </div>
  );
}

/** Any other account notice (a failed sign-in, a role check that did not answer): quiet, dismissible. */
function AuthNotice() {
  const { error, retry, status, user, dismissError } = useAuth();
  if (!error) return null;
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground"
    >
      <span className="min-w-0 flex-1 truncate" title={error}>
        {user ? error : `Couldn't sign you in. ${error}`}
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-xs"
        disabled={status === 'signing-in'}
        onClick={() => void retry()}
      >
        Try again
      </Button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismissError}
        className="flex size-6 items-center justify-center rounded-md hover:bg-accent hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
