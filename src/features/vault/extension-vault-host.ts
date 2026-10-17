/**
 * THE EXTENSION'S HOST ABILITIES FOR `@ai-matrx/vault`.
 *
 * The package owns every Vault screen; this file only offers what touches a
 * page, a frame, a tab or this browser's fill key — the extension's existing
 * mechanics, unchanged, behind the package's host contracts
 * (`@ai-matrx/vault` `src/extension/host.ts`):
 *
 *   - capture     → the service-worker's pending "Save this login?" candidate
 *                   (`capture-candidates.ts`; metadata only, the SW writes the password)
 *   - fillSetup   → this browser's fill key (`lib/vault/fill-device.ts`)
 *   - newPasswordFields → the generation host (`lib/credentials/generation-host.ts`)
 *                   over its panel port
 *   - outcome maps for Fill (`credential-suggestions:panel-fill`) and Sign in
 *                   (the same `credential_login` handler the agent runs)
 *
 * No plaintext is kept here. A typed password (turn on filling) or a generated
 * value (use on page) travels straight through to the existing host once.
 */

import type {
  CaptureDecisionResult,
  CapturePromptMeta,
  CaptureStatusQuery,
  CaptureDecision as ExtensionCaptureDecision,
} from '@/lib/credentials/capture-types';
import {
  GENERATION_INVALIDATED,
  GENERATION_PANEL_PORT,
  type GenerationDiscoveryResponse,
  type GenerationInvalidationMessage,
  type GenerationOffer,
  type GenerationPanelConnectedMessage,
  type GenerationUseResponse,
} from '@/lib/credentials/generation-protocol';
import { on, send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import type { CredentialLoginStatus } from '@/lib/tools/handlers/credential-login';
import {
  fillDeviceStatus,
  fillStepUpMethods,
  passkeyApprovalLink,
  turnOnFillingHere,
} from '@/lib/vault/fill-device';
import type { VaultHostCapabilities } from '@ai-matrx/vault';
import type { PanelActionAdmission } from './usePanelAdmission';

// The package's host contracts, read off `VaultHostCapabilities` (one source of truth).
export type ExtensionPage = NonNullable<VaultHostCapabilities['page']>;
export type ExtensionFill = NonNullable<VaultHostCapabilities['fill']>;
export type CaptureHost = NonNullable<VaultHostCapabilities['capture']>;
export type FillSetupHost = NonNullable<VaultHostCapabilities['fillSetup']>;
export type NewPasswordFieldsHost = NonNullable<VaultHostCapabilities['newPasswordFields']>;
export type FillOutcome = Awaited<ReturnType<ExtensionFill>>;
export type SignInOutcome = Awaited<ReturnType<NonNullable<ExtensionPage['signIn']>>>;
export type PageMatchError = Extract<
  NonNullable<ExtensionPage['matchState']>,
  { status: 'error' }
>['reason'];
export type CapturePrompt = ReturnType<CaptureHost['get']>;
export type FillSetupState = ReturnType<FillSetupHost['get']>;
type CaptureResult = Awaited<ReturnType<CaptureHost['decide']>>;
type FillSetupResult = Awaited<ReturnType<FillSetupHost['finishPasskey']>>;
type NewPasswordFind = Awaited<ReturnType<NewPasswordFieldsHost['find']>>;
type NewPasswordFillOutcome = Awaited<ReturnType<NewPasswordFieldsHost['use']>>;

/** A small external store (the package reads it with useSyncExternalStore). */
function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: T) => {
      value = next;
      for (const listener of listeners) listener();
    },
    listeners,
  };
}

// ── Fill + Sign in: outcome codes ───────────────────────────────────────────

/** `credential-suggestions:panel-fill` reply → the package's Fill outcome. */
export function fillOutcomeOf(status: unknown): FillOutcome {
  if (status === 'filled') return 'filled';
  if (status === 'partial_manual_check') return 'partial';
  if (status === 'stale') return 'no_field';
  return 'unavailable';
}

/** The `credential_login` handler's terminal status → the package's "Sign in for me" outcome. */
export function signInOutcomeOf(status: CredentialLoginStatus | string): SignInOutcome {
  switch (status) {
    case 'authenticated':
      return 'signed_in';
    case 'needs_mfa':
      return 'needs_code';
    case 'captcha_or_takeover':
      return 'challenge';
    case 'credentials_rejected':
      return 'rejected';
    case 'selection_required':
      return 'several';
    case 'no_matching_login':
      return 'no_match';
    case 'unsafe_destination':
      return 'unsafe';
    case 'sign_in_required':
      return 'signed_out';
    default:
      return 'unknown';
  }
}

/** A failed match read (`VaultCallFailure.kind`) → the package's reason. */
export function matchErrorOf(kind: string): PageMatchError {
  if (kind === 'sign_in_required' || kind === 'forbidden' || kind === 'fill_setup_required')
    return kind;
  return 'server_error';
}

// ── Save this login? ────────────────────────────────────────────────────────

export function capturePromptOf(meta: CapturePromptMeta | null, tabId: number): CapturePrompt {
  if (!meta || meta.tabId !== tabId) return null;
  return {
    id: meta.candidateId,
    host: meta.host,
    username: meta.username,
    existing: meta.existing.map((e) => ({ itemId: e.item_id, name: e.display_name })),
    ...(meta.unavailable ? { unavailable: true } : {}),
  };
}

/** The pending capture for one tab, as a store. Listens to the SW only while something watches. */
export function createCaptureHost(tabId: number | null): CaptureHost {
  const store = createStore<CapturePrompt>(null);
  let epoch = 0;
  let off: (() => void) | null = null;
  const refresh = async () => {
    if (tabId === null) return store.set(null);
    const ticket = ++epoch;
    try {
      const meta = await send<CaptureStatusQuery, CapturePromptMeta | null>(
        CHANNELS.CREDENTIAL_CAPTURE_STATUS,
        { tabId },
      );
      if (ticket === epoch) store.set(capturePromptOf(meta ?? null, tabId));
    } catch {
      if (ticket === epoch) store.set(null);
    }
  };
  return {
    get: store.get,
    subscribe(onChange) {
      store.listeners.add(onChange);
      if (store.listeners.size === 1) {
        void refresh();
        off = on<{ tabId: number }, void>(CHANNELS.CREDENTIAL_CAPTURE_CHANGED, (p) => {
          if (p?.tabId === tabId) void refresh();
        });
      }
      return () => {
        store.listeners.delete(onChange);
        if (store.listeners.size === 0) {
          epoch++;
          off?.();
          off = null;
        }
      };
    },
    async decide(promptId, decision): Promise<CaptureResult> {
      const current = store.get();
      if (!current || current.id !== promptId) return 'expired';
      const wire: ExtensionCaptureDecision = {
        candidateId: promptId,
        action: decision.action,
        ...(decision.action === 'update' ? { itemId: decision.itemId } : {}),
      };
      try {
        const r = await send<ExtensionCaptureDecision, CaptureDecisionResult>(
          CHANNELS.CREDENTIAL_CAPTURE_DECISION,
          wire,
        );
        void refresh();
        return r.status;
      } catch {
        return 'error';
      }
    },
  };
}

// ── Turn on filling in this browser ─────────────────────────────────────────

/**
 * "The person went to approve this browser with their passkey" outlives a
 * remount of the workspace; it lasts for this panel's lifetime and ends when
 * filling turns on.
 */
let awaitingPasskeyApproval = false;

type Failure = Awaited<ReturnType<typeof turnOnFillingHere>>;

export function fillSetupResultOf(result: Failure): FillSetupResult {
  if (result.ok) return { ok: true };
  const f = result.failure;
  if (f.kind === 'sign_in_required') return { ok: false, reason: 'sign_in_required' };
  if (f.kind === 'step_up_required')
    return { ok: false, reason: 'not_approved', message: f.message };
  return { ok: false, reason: 'failed', message: f.message };
}

/** This browser's fill key as a store. Re-reads when the panel regains focus (the person may have approved on the web). */
export function createFillSetupHost(openUrl: (url: string) => void): FillSetupHost {
  const store = createStore<FillSetupState>({
    status: 'loading',
    methods: null,
    passkey: null,
    awaitingPasskey: awaitingPasskeyApproval,
  });
  const patch = (next: Partial<FillSetupState>) => store.set({ ...store.get(), ...next });
  const setAwaiting = (value: boolean) => {
    awaitingPasskeyApproval = value;
    patch({ awaitingPasskey: value });
  };
  const loadLink = async () => {
    try {
      const link = await passkeyApprovalLink();
      patch({ passkey: link.url ? { url: link.url, code: link.code } : null });
    } catch {
      patch({ passkey: null });
    }
  };
  let reading = false;
  const refresh = async () => {
    if (reading) return;
    reading = true;
    try {
      const status = await fillDeviceStatus();
      patch({ status });
      if (status !== 'off') return;
      void loadLink();
      if (awaitingPasskeyApproval) {
        const result = await turnOnFillingHere();
        if (result.ok) {
          setAwaiting(false);
          patch({ status: 'on' });
          return;
        }
      }
      patch({ methods: await fillStepUpMethods() });
    } catch {
      patch({ status: 'off' });
    } finally {
      reading = false;
    }
  };
  const onFocus = () => void refresh();
  return {
    get: store.get,
    subscribe(onChange) {
      store.listeners.add(onChange);
      if (store.listeners.size === 1) {
        void refresh();
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onFocus);
      }
      return () => {
        store.listeners.delete(onChange);
        if (store.listeners.size === 0) {
          window.removeEventListener('focus', onFocus);
          document.removeEventListener('visibilitychange', onFocus);
        }
      };
    },
    async turnOnWithPassword(password) {
      const result = await turnOnFillingHere(password);
      if (result.ok) patch({ status: 'on' });
      return fillSetupResultOf(result);
    },
    openPasskey() {
      const link = store.get().passkey;
      if (!link) return;
      setAwaiting(true);
      openUrl(link.url);
    },
    async finishPasskey() {
      const result = await turnOnFillingHere();
      if (result.ok) {
        setAwaiting(false);
        patch({ status: 'on' });
      } else {
        await loadLink();
      }
      return fillSetupResultOf(result);
    },
  };
}

// ── New-password boxes (generator → page) ───────────────────────────────────

export function newPasswordFindOf(r: GenerationDiscoveryResponse | null): NewPasswordFind {
  if (!r) return { status: 'unavailable' };
  if (r.status === 'ready')
    return {
      status: 'ready',
      targets: r.offers.map((o) => ({
        id: o.id,
        origin: o.origin,
        fieldCount: o.fieldCount,
        topFrame: o.frameId === 0,
      })),
    };
  if (r.status === 'no_targets') return { status: 'none' };
  if (r.status === 'unsafe_destination') return { status: 'unsafe' };
  return { status: r.status };
}

export function newPasswordFillOf(r: GenerationUseResponse | null): NewPasswordFillOutcome {
  if (!r) return 'unavailable';
  if (r.status === 'filled') return 'filled';
  if (r.status === 'partial_manual_check') return 'partial';
  if (r.status === 'stale' || r.status === 'unavailable') return r.status;
  return 'refused';
}

const CONNECT_WAIT_MS = 1_500;

/**
 * The generation host over its panel port. The port lives while the workspace
 * is mounted (`dispose` closes it); an invalidation from the page drops the
 * offers, so a later `use` answers `stale`.
 */
export function createNewPasswordFieldsHost(
  tabId: number | null,
  admission: PanelActionAdmission,
): NewPasswordFieldsHost & { dispose: () => void } {
  let port: chrome.runtime.Port | null = null;
  let connectionId: string | null = null;
  let waiting: Promise<string | null> | null = null;
  let offers: GenerationOffer[] = [];
  let disposed = false;

  const discard = (ids: string[]) => {
    if (ids.length === 0 || !connectionId) return;
    void chrome.runtime
      .sendMessage({
        __matrxCredentialGeneration: true,
        operation: 'discard',
        connectionId,
        offerIds: ids,
      })
      .catch(() => undefined);
  };

  const onInvalidated = (message: unknown) => {
    const m = message as Partial<GenerationInvalidationMessage>;
    if (
      m?.__matrxCredentialGeneration &&
      m.operation === GENERATION_INVALIDATED &&
      Array.isArray(m.offerIds) &&
      m.offerIds.some((id) => offers.some((o) => o.id === id))
    )
      offers = [];
  };
  chrome.runtime.onMessage.addListener(onInvalidated);

  const connect = (): Promise<string | null> => {
    if (disposed) return Promise.resolve(null);
    if (port && connectionId) return Promise.resolve(connectionId);
    if (waiting) return waiting;
    waiting = new Promise<string | null>((resolve) => {
      const next = chrome.runtime.connect({ name: GENERATION_PANEL_PORT });
      port = next;
      const timer = setTimeout(() => settle(null), CONNECT_WAIT_MS);
      function settle(id: string | null) {
        clearTimeout(timer);
        waiting = null;
        resolve(id);
      }
      next.onMessage.addListener((message: unknown) => {
        const h = message as Partial<GenerationPanelConnectedMessage>;
        if (
          port === next &&
          h.__matrxCredentialGeneration === true &&
          h.operation === 'connected' &&
          typeof h.connectionId === 'string' &&
          /^[a-f0-9]{36}$/.test(h.connectionId)
        ) {
          connectionId = h.connectionId;
          settle(h.connectionId);
        }
      });
      next.onDisconnect.addListener(() => {
        if (port !== next) return;
        port = null;
        connectionId = null;
        offers = [];
        settle(null);
      });
    });
    return waiting;
  };

  return {
    async find() {
      if (tabId === null) return { status: 'unavailable' };
      const id = await connect();
      if (!id) return { status: 'unavailable' };
      discard(offers.map((o) => o.id));
      offers = [];
      const r = await admission.run(
        async () =>
          (await chrome.runtime.sendMessage({
            __matrxCredentialGeneration: true,
            operation: 'discover',
            connectionId: id,
            tabId,
          })) as GenerationDiscoveryResponse,
      );
      if (r?.status === 'ready') offers = r.offers;
      return newPasswordFindOf(r);
    },
    async use(targetId, value) {
      const id = connectionId;
      if (!id || !offers.some((o) => o.id === targetId)) return 'stale';
      discard(offers.filter((o) => o.id !== targetId).map((o) => o.id));
      offers = [];
      const r = await admission.run(
        async () =>
          (await chrome.runtime.sendMessage({
            __matrxCredentialGeneration: true,
            operation: 'use',
            connectionId: id,
            offerId: targetId,
            value,
          })) as GenerationUseResponse,
      );
      return newPasswordFillOf(r);
    },
    dispose() {
      disposed = true;
      chrome.runtime.onMessage.removeListener(onInvalidated);
      discard(offers.map((o) => o.id));
      offers = [];
      const p = port;
      port = null;
      connectionId = null;
      p?.disconnect();
    },
  };
}
