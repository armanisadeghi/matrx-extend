import { copyToClipboard } from '@/lib/clipboard/copy';
import { resolveGeneratedCredentialLimits } from '@/lib/credentials/generation-limits';
import type {
  GenerationDiscoveryResponse,
  GenerationInvalidationMessage,
  GenerationOffer,
  GenerationUseResponse,
} from '@/lib/credentials/generation-protocol';
import { GENERATION_INVALIDATED, GENERATION_PANEL_PORT, type GenerationPanelConnectedMessage } from '@/lib/credentials/generation-protocol';
import { GENERATED_SECRET_TTL_MS } from '@/lib/credentials/generation-targets';
import { useTransientSecret } from '@/lib/credentials/transient-secret';
import { cn } from '@/lib/utils';
import { Button, BasicInput as Input, Switch } from '@ai-matrx/design-system';
import {
  type CredentialGenerationOptions,
  generateCredentialSecret,
} from '@ai-matrx/kit/credential-generator';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  WandSparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PanelActionAdmission } from './usePanelAdmission';

type GeneratorKind = 'password' | 'passphrase';

const PASSWORD_DEFAULTS = {
  length: 24,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: true,
};
const PASSPHRASE_DEFAULTS: {
  wordCount: number;
  separator: '-' | ' ' | '.';
  capitalize: boolean;
  appendDigit: boolean;
} = {
  wordCount: 6,
  separator: '-' as const,
  capitalize: false,
  appendDigit: false,
};

export function PasswordGenerator({
  tabId,
  actor,
  admission,
}: {
  tabId: number | null;
  actor: { userId: string; organizationId: string } | null;
  admission: PanelActionAdmission;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<GeneratorKind>('password');
  const [password, setPassword] = useState(PASSWORD_DEFAULTS);
  const [passphrase, setPassphrase] = useState(PASSPHRASE_DEFAULTS);
  const [offers, setOffers] = useState<GenerationOffer[]>([]);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [reconnectEpoch, setReconnectEpoch] = useState(0);
  const opener = useRef<HTMLButtonElement>(null);
  const { value: generatedValue, hold, clear } = useTransientSecret(GENERATED_SECRET_TTL_MS);
  const busyRef = useRef(false);
  const offersRef = useRef<GenerationOffer[]>([]);
  const generationEpoch = useRef(0);
  const connectionId = useRef<string | null>(null);
  const connectionPort = useRef<chrome.runtime.Port | null>(null);
  const connectionWaiter = useRef<{
    promise: Promise<string | null>;
    settle: (connection: string | null) => void;
    timeout: ReturnType<typeof setTimeout>;
  } | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  offersRef.current = offers;

  const replaceOffers = useCallback((next: GenerationOffer[]) => {
    // The invalidation listener and a Use click can arrive before React has
    // rendered state. Keep the authoritative panel projection in sync first.
    offersRef.current = next;
    setOffers(next);
  }, []);

  const discard = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const currentConnectionId = connectionId.current;
    if (!currentConnectionId) return;
    void chrome.runtime
      .sendMessage({
        __matrxCredentialGeneration: true,
        operation: 'discard',
        connectionId: currentConnectionId,
        offerIds: ids,
      })
      .catch(() => undefined);
  }, []);

  const clearGenerated = useCallback(
    (message?: string) => {
      generationEpoch.current += 1;
      if (expiryTimer.current !== null) {
        clearTimeout(expiryTimer.current);
        expiryTimer.current = null;
      }
      const ids = offersRef.current.map((offer) => offer.id);
      replaceOffers([]);
      discard(ids);
      clear();
      setSelectedOfferId(null);
      setRevealed(false);
      busyRef.current = false;
      setBusy(false);
      if (message !== undefined) setStatus(message);
    },
    [clear, discard, replaceOffers],
  );

  useEffect(() => () => clearGenerated(), [clearGenerated]);
  useEffect(() => {
    let disposed = false;
    const port = chrome.runtime.connect({ name: GENERATION_PANEL_PORT });
    connectionPort.current = port;
    const connected = (message: unknown) => {
      const handshake = message as Partial<GenerationPanelConnectedMessage>;
      if (
        !disposed &&
        connectionPort.current === port &&
        handshake.__matrxCredentialGeneration === true &&
        handshake.operation === 'connected' &&
        typeof handshake.connectionId === 'string' &&
        /^[a-f0-9]{36}$/.test(handshake.connectionId)
      ) {
        connectionId.current = handshake.connectionId;
        connectionWaiter.current?.settle(handshake.connectionId);
      }
    };
    const disconnected = () => {
      if (connectionPort.current !== port) return;
      connectionPort.current = null;
      connectionId.current = null;
      connectionWaiter.current?.settle(null);
      generationEpoch.current += 1;
      if (!disposed) clearGenerated('The generator connection changed. Generate a new value to continue.');
    };
    port.onMessage.addListener(connected);
    port.onDisconnect.addListener(disconnected);
    return () => {
      disposed = true;
      port.onMessage.removeListener(connected);
      port.onDisconnect.removeListener(disconnected);
      if (connectionPort.current === port) connectionPort.current = null;
      connectionId.current = null;
      port.disconnect();
    };
  }, [clearGenerated, reconnectEpoch]);

  const waitForConnection = useCallback((): Promise<string | null> => {
    if (connectionId.current && connectionPort.current) return Promise.resolve(connectionId.current);
    if (connectionWaiter.current) return connectionWaiter.current.promise;
    let resolve!: (connection: string | null) => void;
    const promise = new Promise<string | null>((next) => {
      resolve = next;
    });
    const waiter = {
      promise,
      settle: (connection: string | null) => {
        if (connectionWaiter.current !== waiter) return;
        clearTimeout(waiter.timeout);
        connectionWaiter.current = null;
        resolve(connection);
      },
      timeout: undefined as unknown as ReturnType<typeof setTimeout>,
    };
    waiter.timeout = setTimeout(() => waiter.settle(null), 1_500);
    connectionWaiter.current = waiter;
    setReconnectEpoch((current) => current + 1);
    return promise;
  }, []);
  useEffect(() => {
    if (!admission.current()) clearGenerated('The page changed. Generate a new value to continue.');
  }, [admission, clearGenerated]);
  useEffect(() => {
    const invalidated = (message: unknown) => {
      const invalidation = message as Partial<GenerationInvalidationMessage>;
      if (
        invalidation.__matrxCredentialGeneration &&
        invalidation.operation === GENERATION_INVALIDATED &&
        Array.isArray(invalidation.offerIds) &&
        invalidation.offerIds.some(
          (offerId): offerId is string =>
            typeof offerId === 'string' && offersRef.current.some((offer) => offer.id === offerId),
        )
      )
        clearGenerated('The page changed. Generate a new value to continue.');
    };
    chrome.runtime.onMessage.addListener(invalidated);
    return () => chrome.runtime.onMessage.removeListener(invalidated);
  }, [clearGenerated]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !open) return;
      event.preventDefault();
      setOpen(false);
      clearGenerated();
      opener.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clearGenerated, open]);

  const changeOptions = useCallback(
    (change: () => void) => {
      change();
      clearGenerated('Options changed. Generate a new value to use it.');
    },
    [clearGenerated],
  );

  const generate = useCallback(async () => {
    if (busyRef.current || tabId === null || !actor) {
      clearGenerated('Password generation is unavailable. Check your sign-in and try again.');
      return;
    }
    const currentConnectionId = await waitForConnection();
    if (!currentConnectionId || connectionId.current !== currentConnectionId || !connectionPort.current) {
      clearGenerated('Password generation is unavailable. Check your sign-in and try again.');
      return;
    }
    clearGenerated();
    const operationEpoch = generationEpoch.current;
    busyRef.current = true;
    setBusy(true);
    try {
      const limits = await resolveGeneratedCredentialLimits(actor, admission);
      if (generationEpoch.current !== operationEpoch || !admission.current()) return;
      if (!limits.ok) {
        clearGenerated(
          limits.reason === 'configuration_unavailable'
            ? 'Password generation is unavailable because this organization’s secure limits could not be loaded. Try again later.'
            : 'The page changed. Generate a new value to continue.',
        );
        return;
      }
      const options: CredentialGenerationOptions =
        kind === 'password' ? { kind, ...password } : { kind, ...passphrase };
      const generated = generateCredentialSecret(options, limits.limits);
      if (!generated.ok) {
        clearGenerated('A secure value could not be generated. Check the options and try again.');
        return;
      }
      hold(generated.value);
      expiryTimer.current = setTimeout(() => {
        if (generationEpoch.current === operationEpoch)
          clearGenerated('This generated value expired. Generate a new value to continue.');
      }, GENERATED_SECRET_TTL_MS);
      setStatus('Finding compatible new-password fields…');
      const discovery = await admission.run(
        async () =>
          chrome.runtime.sendMessage({
            __matrxCredentialGeneration: true,
            operation: 'discover',
            connectionId: currentConnectionId,
            tabId,
          }) as Promise<GenerationDiscoveryResponse>,
      );
      // A newer panel operation owns the screen now. It may have generated a
      // different value, so an old continuation must be a true no-op.
      if (generationEpoch.current !== operationEpoch) return;
      // This is still our operation, but admission failed after plaintext was
      // created. Drop it rather than leaving a value usable in an unverified
      // tab/actor context.
      if (!admission.current() || !discovery) {
        clearGenerated('The page or account changed. Generate a new value to continue.');
        return;
      }
      setRevealed(false);
      if (discovery.status !== 'ready') {
        setStatus(`${discovery.message} You can still copy the generated value manually.`);
        return;
      }
      replaceOffers(discovery.offers);
      const oneTopFrameOffer = discovery.offers.length === 1 && discovery.offers[0]?.frameId === 0;
      setSelectedOfferId(oneTopFrameOffer ? (discovery.offers[0]?.id ?? null) : null);
      setStatus(
        oneTopFrameOffer
          ? 'Generated. Select Use to fill the new-password fields.'
          : 'Generated. Choose the password fields before using it.',
      );
    } finally {
      if (generationEpoch.current === operationEpoch) {
        busyRef.current = false;
        if (admission.current()) setBusy(false);
      }
    }
  }, [actor, admission, clearGenerated, hold, kind, passphrase, password, replaceOffers, tabId, waitForConnection]);

  const copy = useCallback(async () => {
    if (busyRef.current || !generatedValue) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const copied = await copyToClipboard(generatedValue);
      if (admission.current())
        setStatus(
          copied
            ? 'Copied. Clipboard is not cleared automatically.'
            : 'Could not copy. Select Reveal and copy it manually.',
        );
    } finally {
      busyRef.current = false;
      if (admission.current()) setBusy(false);
    }
  }, [admission, generatedValue]);

  const useGenerated = useCallback(async () => {
    const offerId = selectedOfferId;
    const value = generatedValue;
    const currentConnectionId = connectionId.current;
    if (busyRef.current || !offerId || !value || !currentConnectionId) return;
    busyRef.current = true;
    setBusy(true);
    const useEpoch = generationEpoch.current + 1;
    generationEpoch.current = useEpoch;
    if (expiryTimer.current !== null) {
      clearTimeout(expiryTimer.current);
      expiryTimer.current = null;
    }
    const otherIds = offersRef.current.map((offer) => offer.id).filter((id) => id !== offerId);
    // Claim in this UI before any await. The host separately claims its offer.
    replaceOffers([]);
    setSelectedOfferId(null);
    setRevealed(false);
    clear();
    discard(otherIds);
    try {
      const result = await admission.run(
        async () =>
          chrome.runtime.sendMessage({
            __matrxCredentialGeneration: true,
            operation: 'use',
            connectionId: currentConnectionId,
            offerId,
            value,
          }) as Promise<GenerationUseResponse>,
      );
      if (generationEpoch.current === useEpoch && admission.current())
        setStatus(result?.message ?? 'The page changed. Generate a new value to continue.');
    } finally {
      if (generationEpoch.current === useEpoch) {
        busyRef.current = false;
        if (admission.current()) setBusy(false);
      }
    }
  }, [admission, clear, discard, generatedValue, replaceOffers, selectedOfferId]);

  const hasValue = generatedValue !== null;
  return (
    <section className="border-b px-2 py-1.5" aria-label="Password generator">
      <button
        ref={opener}
        type="button"
        className="flex w-full items-center gap-1.5 rounded px-0.5 py-1 text-left text-xs font-medium hover:bg-muted/60"
        aria-expanded={open}
        onClick={() =>
          setOpen((current) => {
            if (current) clearGenerated();
            return !current;
          })
        }
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <WandSparkles className="size-3 text-muted-foreground" /> Password generator
      </button>
      {open && (
        <div className="space-y-2 px-0.5 pb-1 pt-1.5">
          <div className="grid grid-cols-2 gap-1">
            {(['password', 'passphrase'] as const).map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={kind === option ? 'default' : 'outline'}
                className="h-6 text-[11px]"
                disabled={busy}
                onClick={() => changeOptions(() => setKind(option))}
              >
                {option === 'password' ? 'Password' : 'Passphrase'}
              </Button>
            ))}
          </div>
          {kind === 'password' ? (
            <PasswordOptions
              value={password}
              disabled={busy}
              onChange={(next) => changeOptions(() => setPassword(next))}
            />
          ) : (
            <PassphraseOptions
              value={passphrase}
              disabled={busy}
              onChange={(next) => changeOptions(() => setPassphrase(next))}
            />
          )}
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              className="h-7 flex-1 gap-1 text-[11px]"
              disabled={busy}
              onClick={() => void generate()}
            >
              {busy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <WandSparkles className="size-3" />
              )}
              {hasValue ? 'Regenerate' : 'Generate'}
            </Button>
            {hasValue && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                disabled={busy}
                onClick={() => clearGenerated()}
              >
                <X className="size-3" />
                <span className="sr-only">Clear generated value</span>
              </Button>
            )}
          </div>
          {hasValue && (
            <>
              <div className="flex min-w-0 items-center gap-1 rounded border bg-muted/30 px-2 py-1.5">
                <code className="min-w-0 flex-1 truncate text-[11px]">
                  {revealed ? generatedValue : '••••••••••••••••••••••••'}
                </code>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={revealed ? 'Hide generated value' : 'Reveal generated value'}
                  disabled={busy}
                  onClick={() => setRevealed((current) => !current)}
                >
                  {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 flex-1 gap-1 text-[11px]"
                  disabled={busy}
                  onClick={() => void copy()}
                >
                  <Copy className="size-3" /> Copy
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 flex-1 text-[11px]"
                  disabled={busy || !selectedOfferId}
                  onClick={() => void useGenerated()}
                >
                  Use
                </Button>
              </div>
              {offers.length > 0 && (
                <OfferPicker
                  offers={offers}
                  selectedId={selectedOfferId}
                  disabled={busy}
                  onSelect={setSelectedOfferId}
                />
              )}
            </>
          )}
          {status && (
            <p aria-live="polite" className="text-[11px] leading-relaxed text-muted-foreground">
              {status}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function PasswordOptions({
  value,
  disabled,
  onChange,
}: {
  value: typeof PASSWORD_DEFAULTS;
  disabled: boolean;
  onChange: (next: typeof PASSWORD_DEFAULTS) => void;
}) {
  return (
    <div className="space-y-1.5 text-[11px]">
      <div className="flex items-center gap-2">
        Length{' '}
        <Input
          aria-label="Password length"
          type="number"
          min={1}
          value={value.length}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, length: Number(event.target.value) })}
          className="ml-auto h-6 w-16 text-xs"
        />
      </div>
      <ToggleGrid disabled={disabled} value={value} onChange={onChange} />
    </div>
  );
}
function ToggleGrid({
  value,
  disabled,
  onChange,
}: {
  value: typeof PASSWORD_DEFAULTS;
  disabled: boolean;
  onChange: (next: typeof PASSWORD_DEFAULTS) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-1">
      {(
        [
          ['lowercase', 'Lowercase'],
          ['uppercase', 'Uppercase'],
          ['digits', 'Digits'],
          ['symbols', 'Symbols'],
          ['excludeAmbiguous', 'Exclude ambiguous'],
        ] as const
      ).map(([key, label]) => (
        <div key={key} className="flex items-center gap-1.5">
          <Switch
            aria-label={label}
            checked={value[key]}
            disabled={disabled}
            onCheckedChange={(checked) => onChange({ ...value, [key]: checked })}
          />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
function PassphraseOptions({
  value,
  disabled,
  onChange,
}: {
  value: typeof PASSPHRASE_DEFAULTS;
  disabled: boolean;
  onChange: (next: typeof PASSPHRASE_DEFAULTS) => void;
}) {
  return (
    <div className="space-y-1.5 text-[11px]">
      <div className="flex items-center gap-2">
        Words{' '}
        <Input
          aria-label="Passphrase word count"
          type="number"
          min={1}
          value={value.wordCount}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, wordCount: Number(event.target.value) })}
          className="ml-auto h-6 w-16 text-xs"
        />
      </div>
      <div className="flex items-center gap-2">
        Separator{' '}
        <select
          aria-label="Passphrase separator"
          className="ml-auto h-6 rounded border bg-background px-1 text-[11px]"
          value={value.separator}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, separator: event.target.value as '-' | ' ' | '.' })
          }
        >
          <option value="-">Hyphen</option>
          <option value=" ">Space</option>
          <option value=".">Dot</option>
        </select>
      </div>
      {(
        [
          ['capitalize', 'Capitalize'],
          ['appendDigit', 'Append digit'],
        ] as const
      ).map(([key, label]) => (
        <div key={key} className="flex items-center gap-1.5">
          <Switch
            aria-label={label}
            checked={value[key]}
            disabled={disabled}
            onCheckedChange={(checked) => onChange({ ...value, [key]: checked })}
          />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
function OfferPicker({
  offers,
  selectedId,
  disabled,
  onSelect,
}: {
  offers: GenerationOffer[];
  selectedId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-[11px] text-muted-foreground">Choose password fields</legend>
      {offers.map((offer, index) => (
        <label
          key={offer.id}
          className={cn(
            'flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-[11px]',
            selectedId === offer.id && 'border-primary',
          )}
        >
          <input
            type="radio"
            name="generated-password-target"
            checked={selectedId === offer.id}
            disabled={disabled}
            onChange={() => onSelect(offer.id)}
          />
          <span className="truncate">
            {offer.origin} · {offer.fieldCount} {offer.fieldCount === 1 ? 'field' : 'fields'}
            {offers.length > 1 ? ` · ${index + 1}` : ''}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
