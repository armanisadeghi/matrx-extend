import {
  fillDeviceStatus,
  fillStepUpMethods,
  passkeyApprovalLink,
  turnOnFillingHere,
} from '@/lib/vault/fill-device';
/**
 * "Turn on filling in this browser" (access ladder T-30, T-30c).
 *
 * Filling a saved password needs this browser's own registered key, and
 * registering it needs the person to confirm it is them — the same bar
 * 1Password and Bitwarden set for every new browser. Two equal ways:
 * - their AI Matrx password, typed here. It lives only in the uncontrolled input
 *   for the length of one request and is cleared at once; never stored, logged,
 *   or put in state;
 * - their account passkey, on the AI Matrx web page this card opens (passkeys
 *   belong to the web app's domain, not to the extension). When the person comes
 *   back here, the card claims that approval and filling turns on.
 * An account with neither (Google sign-in only) is told so and sent to add a
 * passkey on the same page.
 */
import { ExternalLink, Fingerprint, KeyRound, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

type Methods = { password: boolean; passkey: boolean };

/**
 * "The person went to approve this browser with their passkey" outlives a
 * remount of the card (the Vault view re-renders while the web page is open);
 * it lasts for this panel's lifetime and ends when filling turns on.
 */
let awaitingPasskeyApproval = false;

export function FillDeviceSetupCard() {
  const [status, setStatus] = useState<'loading' | 'on' | 'off' | 'signed_out'>('loading');
  const [methods, setMethods] = useState<Methods | null>(null);
  const [link, setLink] = useState<{ url: string; code: string } | null>(null);
  const [waiting, setWaitingState] = useState(awaitingPasskeyApproval);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const setWaiting = useCallback((value: boolean) => {
    awaitingPasskeyApproval = value;
    setWaitingState(value);
  }, []);

  const loadLink = useCallback(async () => {
    try {
      const next = await passkeyApprovalLink();
      setLink(next.url ? { url: next.url, code: next.code } : null);
    } catch (err) {
      setLink(null);
      setError(
        `The passkey approval link could not be prepared in this browser (${(err as Error).name || 'error'}). Reload the panel and try again, or use your password.`,
      );
    }
  }, []);

  const refresh = useCallback(async () => {
    const next = await fillDeviceStatus();
    setStatus(next);
    if (next !== 'off') return;
    void loadLink();
    if (awaitingPasskeyApproval) {
      // The person may have just approved this browser with their passkey.
      const result = await turnOnFillingHere();
      if (result.ok) {
        setWaiting(false);
        setStatus('on');
        return;
      }
      if (result.failure.kind !== 'step_up_required') {
        setError(
          result.failure.kind === 'sign_in_required'
            ? 'Sign in to AI Matrx in this panel first.'
            : result.failure.message,
        );
      }
    }
    setMethods(await fillStepUpMethods());
  }, [loadLink, setWaiting]);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refresh]);

  if (status !== 'off') return null;

  const submit = async () => {
    const field = input.current;
    const password = field?.value ?? '';
    if (field) field.value = '';
    if (!password) {
      setError('Enter the password you sign in to AI Matrx with.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await turnOnFillingHere(password);
    setBusy(false);
    if (result.ok) {
      setStatus('on');
      return;
    }
    const f = result.failure;
    setError(
      f.kind === 'sign_in_required' ? 'Sign in to AI Matrx in this panel first.' : f.message,
    );
  };

  const finishWithPasskey = async () => {
    setBusy(true);
    setError(null);
    const result = await turnOnFillingHere();
    setBusy(false);
    if (result.ok) {
      setWaiting(false);
      setStatus('on');
      return;
    }
    const f = result.failure;
    setError(
      f.kind === 'step_up_required'
        ? 'This browser has not been approved yet. Approve it with your passkey on the page that opened, then come back.'
        : f.kind === 'sign_in_required'
          ? 'Sign in to AI Matrx in this panel first.'
          : f.message,
    );
    await loadLink();
  };

  const neither = methods !== null && !methods.password && !methods.passkey;
  const showPassword = methods === null || methods.password;

  return (
    <div className="m-2 rounded-md border border-border p-2.5" data-testid="fill-device-setup">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <KeyRound className="size-3.5 text-muted-foreground" />
        Turn on filling in this browser
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {neither
          ? 'Your AI Matrx account has no password or passkey yet, so filling cannot be turned on. Add a passkey on the web, then approve this browser with it.'
          : showPassword
            ? 'Confirm it is you once so this browser can fill your saved passwords: type your AI Matrx password, or approve with your passkey. You can turn it off any time from Vault, Browsers on the web.'
            : 'Approve this browser with your passkey once so it can fill your saved passwords. You can turn it off any time from Vault, Browsers on the web.'}
      </p>
      {showPassword && !neither && (
        <form
          className="mt-2 flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            ref={input}
            type="password"
            autoComplete="current-password"
            aria-label="Your AI Matrx password"
            placeholder="Your AI Matrx password"
            className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 text-xs"
            disabled={busy}
            data-testid="fill-device-password"
          />
          <button
            type="submit"
            className="h-7 shrink-0 rounded bg-primary px-2.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
            disabled={busy}
            data-testid="fill-device-turn-on"
          >
            {busy && !waiting ? <Loader2 className="size-3.5 animate-spin" /> : 'Turn on'}
          </button>
        </form>
      )}
      {link && (
        <div className="mt-2 flex flex-col gap-1.5">
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              setWaiting(true);
              setError(null);
            }}
            className="inline-flex h-7 items-center justify-center gap-1.5 rounded border border-border px-2.5 text-xs font-medium hover:bg-muted"
            data-testid="fill-device-passkey"
          >
            <Fingerprint className="size-3.5" />
            {neither ? 'Add a passkey on the web' : 'Approve with a passkey'}
            <ExternalLink className="size-3 text-muted-foreground" />
          </a>
          {waiting && (
            <div className="flex items-center gap-1.5" data-testid="fill-device-waiting">
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                Approve code <span className="font-mono text-foreground">{link.code}</span> on
                the page that opened, then come back here.
              </p>
              <button
                type="button"
                onClick={() => void finishWithPasskey()}
                className="h-7 shrink-0 rounded bg-primary px-2.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
                disabled={busy}
                data-testid="fill-device-passkey-done"
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : 'I approved it'}
              </button>
            </div>
          )}
        </div>
      )}
      {error && (
        <p className="mt-1.5 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
