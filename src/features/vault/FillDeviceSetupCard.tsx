import { fillDeviceStatus, turnOnFillingHere } from '@/lib/vault/fill-device';
/**
 * "Turn on filling in this browser" (access ladder T-30).
 *
 * Filling a saved password needs this browser's own registered key, and
 * registering it needs the person's AI Matrx password once — the same bar
 * 1Password and Bitwarden set for every new browser. The password lives only in
 * the uncontrolled input for the length of one request and is cleared at once;
 * it is never stored, logged, or put in state.
 */
import { KeyRound, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export function FillDeviceSetupCard() {
  const [status, setStatus] = useState<'loading' | 'on' | 'off' | 'signed_out'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => setStatus(await fillDeviceStatus()), []);
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
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

  return (
    <div className="m-2 rounded-md border border-border p-2.5" data-testid="fill-device-setup">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <KeyRound className="size-3.5 text-muted-foreground" />
        Turn on filling in this browser
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Confirm your AI Matrx password once so this browser can fill your saved passwords. You can
        turn it off any time from Vault, Browsers on the web.
      </p>
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
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : 'Turn on'}
        </button>
      </form>
      {error && (
        <p className="mt-1.5 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
