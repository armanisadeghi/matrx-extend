import {
  type PrivateApiResult,
  type PrivateExpectedActor,
  getPrivateExpectedActor,
} from '@/lib/api/client';
import { parseStrictPrivateJson } from '@/lib/api/client';
import {
  type LocalBrowserAckResponse,
  type LocalVerifyResponse,
  acknowledgeLocalBrowser,
  verifyLocalBrowser,
} from '@/lib/api/routes/local-browser';
import {
  type LocalCommandResult,
  approveLocalCommand,
  claimLocalCommand,
  completeLocalCommand,
  parseLocalCommand,
  verifyLocalCommandTransport,
} from '@/lib/api/routes/local-browser-commands';
import { type LoginFormProbe, credentialDomSource } from '@/lib/credentials/fill-primitive';
import { log } from '@/lib/debug/log';
import {
  localBrowserApprovalGeneration,
  onLocalBrowserApprovalGenerationChange,
  requestLocalBrowserApproval,
} from '@/lib/desktop/local-browser/approvals';
import {
  type LocalCommand,
  mapLocalCommandToHandler,
} from '@/lib/desktop/local-browser/command-mapping';
import {
  getLocalBrowserSocketEpoch,
  onLocalBrowserEpochInvalidated,
  onLocalBrowserLifecycle,
  sendLocalBrowserLifecycle,
} from '@/lib/desktop/ws-client';
import { on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { onActiveOrganizationChange } from '@/lib/org/active-org';
import {
  type AdmittedExecutionStage,
  type CredentialLoginStatus,
  runAdmittedAuthenticatorAttempt,
  runAdmittedCredentialAttempt,
} from '@/lib/tools/handlers/credential-login';
import {
  type EvaluatedObservation,
  parseVerificationFields,
  verificationDigestMatches,
} from './local-login-verification';
import {
  type LocalBrowserExecute,
  type LocalBrowserGrantClaims,
  type LocalBrowserRefusalReason,
  type LocalBrowserRegistration,
  localBrowserResult,
  parseLocalBrowserFrame,
  parseLocalBrowserGrantClaims,
} from './protocol';

const MAX_OWNED_RUNS = 32;

type Registration = {
  socketEpoch: string;
  engineBootId: string;
  revision: number;
  extensionGeneration: string;
  connectionId: string;
};
type OwnedRun = {
  key: string;
  registration: Registration;
  runId: string;
  admissionId: string;
  grantJti: string;
  grant: string;
  actor: PrivateExpectedActor;
  tabId: number | null;
  leaseExpiresAtMs: number | null;
  terminalAdmissionReceipt: 'cancelled' | 'failed' | null;
  grantDeadlineMs: number;
  admitted: Promise<AdmissionOutcome> | null;
  cleanup: Promise<
    { receipt: 'closed' | 'already_absent' | 'unconfirmed' } | { reason: LocalBrowserRefusalReason }
  > | null;
  cleanupStopId: string | null;
  expiryTimer: ReturnType<typeof setTimeout> | null;
};
type AdmissionOutcome =
  | { receipt: 'created' | 'cancelled' | 'failed' }
  | { reason: LocalBrowserRefusalReason };
type CleanupReceipt = {
  grant: string;
  registration: Registration;
  grantJti: string;
  receipt: 'closed' | 'already_absent' | 'unconfirmed' | null;
  expiresAtMs: number;
  inFlight: Promise<CleanupOutcome> | null;
};
type CleanupOutcome =
  | { receipt: 'closed' | 'already_absent' | 'unconfirmed' }
  | { reason: LocalBrowserRefusalReason };
type CommandOutcome =
  | { receipt: LocalCommandResult; document?: { url: string; document_id: string } }
  | { reason: LocalBrowserRefusalReason };
type InspectReplay = { deadlineMs: number; inFlight: Promise<CommandOutcome> | null };

export interface LocalBrowserControllerDeps {
  getExpectedActor: (deadlineMs: number) => Promise<PrivateApiResult<PrivateExpectedActor>>;
  verify: (
    request: Parameters<typeof verifyLocalBrowser>[0],
  ) => Promise<PrivateApiResult<LocalVerifyResponse>>;
  acknowledge: (
    request: Parameters<typeof acknowledgeLocalBrowser>[0],
  ) => Promise<PrivateApiResult<LocalBrowserAckResponse>>;
  getSocketEpoch: () => string | null;
  send: (socketEpoch: string, payload: unknown) => Promise<boolean>;
  onLifecycle: (handler: (payload: unknown, socketEpoch: string) => void) => () => void;
  onEpochInvalidated: (handler: (nextSocketEpoch: string | null) => void) => () => void;
  onAuthChanged: (handler: () => void) => () => void;
  onOrganizationChanged: (handler: () => void) => () => void;
  tabs: {
    create: (properties: chrome.tabs.CreateProperties) => Promise<chrome.tabs.Tab>;
    remove: (tabId: number) => Promise<void>;
    get: (tabId: number) => Promise<chrome.tabs.Tab>;
    update: (tabId: number, properties: chrome.tabs.UpdateProperties) => Promise<chrome.tabs.Tab>;
    onUpdated: (
      handler: (tabId: number, changeInfo: { status?: string | undefined }) => void,
    ) => () => void;
    onRemoved: (handler: (tabId: number) => void) => () => void;
  };
  /** Optional in tests; production is the only owner of command execution. */
  command?: {
    verify: typeof verifyLocalCommandTransport;
    approve: typeof approveLocalCommand;
    claim: typeof claimLocalCommand;
    complete: typeof completeLocalCommand;
    currentDocument: (tabId: number) => Promise<{ documentId: string; url: string } | null>;
  };
}

type BrowserDocument = { documentId: string; url: string };

export function postSubmitDocumentObserver({
  original,
  deadlineMs,
  isCurrent,
  isSubmitted,
  currentDocument,
}: {
  original: BrowserDocument;
  deadlineMs: number;
  isCurrent: () => boolean;
  isSubmitted: () => boolean;
  currentDocument: () => Promise<BrowserDocument | null>;
}): () => Promise<BrowserDocument | null> {
  let replacement: BrowserDocument | null = null;
  return async () => {
    if (!isSubmitted() || !isCurrent() || Date.now() >= deadlineMs) return null;
    const current = await currentDocument();
    if (!current || !isCurrent() || Date.now() >= deadlineMs) return null;
    try {
      const originalUrl = new URL(original.url);
      const currentUrl = new URL(current.url);
      if (
        originalUrl.protocol !== 'https:' ||
        currentUrl.protocol !== 'https:' ||
        currentUrl.origin !== originalUrl.origin
      )
        return null;
    } catch {
      return null;
    }
    // The first same-origin transition is read-only evidence only. A SPA may
    // retain Chrome's document id while changing its URL; freeze that pair for
    // observation exactly as we freeze a cross-document replacement. Mutation
    // still uses `original`, which was captured before this observer existed.
    if (replacement)
      return current.documentId === replacement.documentId && current.url === replacement.url
        ? current
        : null;
    if (current.documentId === original.documentId && current.url === original.url) return current;
    replacement = current;
    return current;
  };
}

function productionDeps(): LocalBrowserControllerDeps {
  return {
    getExpectedActor: getPrivateExpectedActor,
    verify: verifyLocalBrowser,
    acknowledge: acknowledgeLocalBrowser,
    getSocketEpoch: getLocalBrowserSocketEpoch,
    send: sendLocalBrowserLifecycle,
    onLifecycle: onLocalBrowserLifecycle,
    onEpochInvalidated: onLocalBrowserEpochInvalidated,
    onAuthChanged: (handler) => on(CHANNELS.AUTH_STATE_CHANGED, () => handler()),
    onOrganizationChanged: onActiveOrganizationChange,
    tabs: {
      create: (properties) => chrome.tabs.create(properties),
      remove: (tabId) => chrome.tabs.remove(tabId),
      get: (tabId) => chrome.tabs.get(tabId),
      update: (tabId, properties) => chrome.tabs.update(tabId, properties),
      onUpdated: (handler) => {
        chrome.tabs.onUpdated.addListener(handler);
        return () => chrome.tabs.onUpdated.removeListener(handler);
      },
      onRemoved: (handler) => {
        chrome.tabs.onRemoved.addListener(handler);
        return () => chrome.tabs.onRemoved.removeListener(handler);
      },
    },
    command: {
      verify: verifyLocalCommandTransport,
      approve: approveLocalCommand,
      claim: claimLocalCommand,
      complete: completeLocalCommand,
      currentDocument: async (tabId) => {
        let frame: {
          documentId?: unknown;
          url?: unknown;
          errorOccurred?: unknown;
        } | null;
        try {
          frame = (await chrome.webNavigation.getFrame({ tabId, frameId: 0 })) as typeof frame;
        } catch {
          // Missing/failed frames cannot prove navigation or authorize a login.
          return null;
        }
        // Chrome can keep the requested HTTPS URL on an error document. It is
        // not evidence that navigation succeeded or that a login page exists.
        return frame?.errorOccurred !== true &&
          typeof frame?.documentId === 'string' &&
          typeof frame.url === 'string'
          ? { documentId: frame.documentId, url: frame.url }
          : null;
      },
    },
  };
}

function deadlineFromClaims(claims: LocalBrowserGrantClaims): number | null {
  if (claims.exp > Math.floor(Number.MAX_SAFE_INTEGER / 1000)) return null;
  const deadline = claims.exp * 1000;
  return deadline > Date.now() ? deadline : null;
}

/** Server projections can retain milliseconds; JWT expiry authority is whole seconds. */
export function canonicalGrantDeadlineMs(deadlineMs: number): number | null {
  if (!Number.isFinite(deadlineMs) || deadlineMs < 0) return null;
  const second = Math.floor(deadlineMs / 1000);
  return second <= Math.floor(Number.MAX_SAFE_INTEGER / 1000) ? second * 1000 : null;
}

function mapPrivateFailure(error: string): LocalBrowserRefusalReason {
  switch (error) {
    case 'identity_changed':
      return 'binding_changed';
    case 'invalid_response':
      return 'authority_refused';
    case 'deadline_exceeded':
    case 'network_error':
    case 'http_error':
    case 'response_too_large':
      return 'transport_unavailable';
    default:
      return 'authority_refused';
  }
}

function privateFailureDiagnosticLabel(
  error: string,
):
  | 'identity_changed'
  | 'invalid_response'
  | 'deadline_exceeded'
  | 'network_error'
  | 'http_error'
  | 'response_too_large'
  | 'other' {
  switch (error) {
    case 'identity_changed':
    case 'invalid_response':
    case 'deadline_exceeded':
    case 'network_error':
    case 'http_error':
    case 'response_too_large':
      return error;
    default:
      return 'other';
  }
}

function sameRegistration(left: Registration | null, right: Registration): boolean {
  return (
    left?.socketEpoch === right.socketEpoch &&
    left.engineBootId === right.engineBootId &&
    left.revision === right.revision &&
    left.extensionGeneration === right.extensionGeneration &&
    left.connectionId === right.connectionId
  );
}

function runKey(claims: Extract<LocalBrowserGrantClaims, { admission_id: string }>): string {
  return [
    claims.run_id,
    claims.admission_id,
    claims.extension_generation,
    claims.connection_id,
  ].join(':');
}

function cleanupKey(claims: Extract<LocalBrowserGrantClaims, { operation: 'cleanup' }>): string {
  return `${runKey(claims)}:${claims.stop_id}`;
}

/** Private, background-only owner for tabs created by the lifecycle protocol. */
export class LocalBrowserController {
  private readonly entries = new Map<string, OwnedRun>();
  private readonly cleanupReceipts = new Map<string, CleanupReceipt>();
  /** Consumed inspect requests retain identity only; their transient document is never retained. */
  private readonly inspectReplays = new Map<string, InspectReplay>();
  private pendingRegistration: Registration | null = null;
  private activeRegistration: Registration | null = null;
  private lastRegistrationRequired: Extract<
    ReturnType<typeof parseLocalBrowserFrame>,
    { type: 'local_browser.register_required'; engine_boot_id: string; revision: number }
  > | null = null;
  private contextGeneration = 0;
  private readonly unsubscribe: Array<() => void> = [];

  private readonly deps: LocalBrowserControllerDeps;

  constructor(deps: LocalBrowserControllerDeps = productionDeps()) {
    this.deps = deps;
  }

  start(): void {
    if (this.unsubscribe.length > 0) return;
    this.unsubscribe.push(
      this.deps.onLifecycle((payload, socketEpoch) => {
        void this.receive(payload, socketEpoch).catch(() => {
          // Frames can carry grants. Never surface an exception or the frame.
        });
      }),
      this.deps.onEpochInvalidated(() => this.invalidate()),
      this.deps.onAuthChanged(() => this.invalidateAndReregister()),
      this.deps.onOrganizationChanged(() => this.invalidateAndReregister()),
      this.deps.tabs.onRemoved((tabId) => this.forgetRemovedTab(tabId)),
    );
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe();
    this.invalidate();
  }

  private invalidate(): void {
    this.contextGeneration += 1;
    this.pendingRegistration = null;
    this.activeRegistration = null;
    const retired = [...this.entries.values()];
    this.entries.clear();
    this.cleanupReceipts.clear();
    this.inspectReplays.clear();
    for (const entry of retired) {
      if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
      if (entry.tabId !== null) void this.closeTab(entry.tabId);
    }
  }

  private invalidateAndReregister(): void {
    const required = this.lastRegistrationRequired;
    this.invalidate();
    const socketEpoch = this.deps.getSocketEpoch();
    if (!required || !socketEpoch) return;
    void this.register(required, socketEpoch);
  }

  private forgetRemovedTab(tabId: number): void {
    for (const [_key, entry] of this.entries) {
      if (entry.tabId !== tabId) continue;
      // A browser close is terminal for this exact admission. Keep its
      // identity-fenced tombstone through the original grant deadline so a
      // delayed retry cannot replace it with another tab.
      this.terminalize(entry, entry.terminalAdmissionReceipt ?? 'cancelled', null);
    }
  }

  private async closeTab(tabId: number): Promise<void> {
    try {
      await this.deps.tabs.remove(tabId);
    } catch {
      // A private owned tab can disappear through a normal user close. Its id
      // is never re-used, searched for, or surfaced.
    }
  }

  private currentRegistration(socketEpoch: string): Registration | null {
    const registration = this.activeRegistration;
    return registration?.socketEpoch === socketEpoch && this.deps.getSocketEpoch() === socketEpoch
      ? registration
      : null;
  }

  private async receive(payload: unknown, socketEpoch: string): Promise<void> {
    if (socketEpoch !== this.deps.getSocketEpoch()) return;
    const frame = parseLocalBrowserFrame(payload);
    if (!frame) return;
    if (frame.type === 'local_browser.invalidate') {
      this.invalidate();
      return;
    }
    if (frame.type === 'local_browser.register_required') {
      if ('status' in frame) {
        this.invalidate();
        return;
      }
      this.lastRegistrationRequired = frame;
      await this.register(frame, socketEpoch);
      return;
    }
    if (frame.type === 'local_browser.registration') {
      this.acceptRegistration(frame, socketEpoch);
      return;
    }
    await this.execute(frame, socketEpoch);
  }

  private async register(
    required: Extract<
      ReturnType<typeof parseLocalBrowserFrame>,
      { type: 'local_browser.register_required' }
    >,
    socketEpoch: string,
  ): Promise<void> {
    if ('status' in required) {
      this.invalidate();
      return;
    }
    const existing = this.activeRegistration ?? this.pendingRegistration;
    if (
      existing &&
      existing.socketEpoch === socketEpoch &&
      existing.engineBootId === required.engine_boot_id &&
      existing.revision === required.revision
    )
      return;
    this.invalidate();
    if (socketEpoch !== this.deps.getSocketEpoch()) return;
    const registration: Registration = {
      socketEpoch,
      engineBootId: required.engine_boot_id,
      revision: required.revision,
      extensionGeneration: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
    };
    this.pendingRegistration = registration;
    const sent = await this.deps.send(socketEpoch, {
      type: 'local_browser.register',
      version: 1,
      engine_boot_id: registration.engineBootId,
      expected_revision: registration.revision,
      extension_generation: registration.extensionGeneration,
      connection_id: registration.connectionId,
    } as never);
    if (
      this.pendingRegistration === registration &&
      (!sent || socketEpoch !== this.deps.getSocketEpoch())
    )
      this.pendingRegistration = null;
  }

  private acceptRegistration(frame: LocalBrowserRegistration, socketEpoch: string): void {
    const pending = this.pendingRegistration;
    if (
      !pending ||
      pending.socketEpoch !== socketEpoch ||
      socketEpoch !== this.deps.getSocketEpoch() ||
      frame.engine_boot_id !== pending.engineBootId ||
      frame.expected_revision !== pending.revision ||
      frame.extension_generation !== pending.extensionGeneration ||
      frame.connection_id !== pending.connectionId
    )
      return;
    this.pendingRegistration = null;
    if (frame.status !== 'acknowledged') return;
    this.activeRegistration = pending;
  }

  private async execute(frame: LocalBrowserExecute, socketEpoch: string): Promise<void> {
    const registration = this.currentRegistration(socketEpoch);
    const claims = parseLocalBrowserGrantClaims(frame.grant);
    const deadlineMs = claims ? deadlineFromClaims(claims) : null;
    if (!registration)
      return this.respond(frame, socketEpoch, { reason: 'registration_unavailable' });
    if (!claims || !deadlineMs || claims.operation !== frame.operation)
      return this.respond(frame, socketEpoch, { reason: 'invalid_request' });
    if (
      claims.operation !== 'discover' &&
      (claims.extension_generation !== registration.extensionGeneration ||
        claims.connection_id !== registration.connectionId)
    )
      return this.respond(frame, socketEpoch, { reason: 'binding_changed' });
    const context = this.contextGeneration;
    const actor = await this.deps.getExpectedActor(deadlineMs);
    if (!actor.ok)
      return this.respond(frame, socketEpoch, { reason: mapPrivateFailure(actor.error) });
    if (!this.isCurrent(context, registration, socketEpoch))
      return this.respond(frame, socketEpoch, { reason: 'binding_changed' });
    if (claims.sub !== actor.data.userId || claims.organization_id !== actor.data.organizationId)
      return this.respond(frame, socketEpoch, { reason: 'binding_changed' });
    const outcome = await this.run(frame, claims, deadlineMs, actor.data, registration, context);
    await this.respond(frame, socketEpoch, outcome);
  }

  private isCurrent(context: number, registration: Registration, socketEpoch: string): boolean {
    return (
      context === this.contextGeneration &&
      socketEpoch === this.deps.getSocketEpoch() &&
      sameRegistration(this.activeRegistration, registration)
    );
  }

  private canMutate(context: number, registration: Registration, deadlineMs: number): boolean {
    return (
      Date.now() < deadlineMs && this.isCurrent(context, registration, registration.socketEpoch)
    );
  }

  private terminalize(
    entry: OwnedRun,
    receipt: 'cancelled' | 'failed',
    tabId: number | null = entry.tabId,
  ): void {
    entry.terminalAdmissionReceipt = receipt;
    entry.tabId = null;
    entry.leaseExpiresAtMs = null;
    this.armTerminalTombstone(entry);
    if (tabId !== null) void this.closeTab(tabId);
  }

  private armTerminalTombstone(entry: OwnedRun): void {
    // A Chrome removal event can arrive while cleanup awaits tabs.remove().
    // Keep this exact entry through the in-flight cleanup acknowledgement; a
    // completed cleanup persists its receipt separately and then re-arms the
    // original bounded tombstone.
    if (entry.cleanup) {
      if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
      entry.expiryTimer = null;
      return;
    }
    if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
    entry.expiryTimer = setTimeout(
      () => {
        if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
      },
      Math.max(0, entry.grantDeadlineMs - Date.now()),
    );
  }

  private async run(
    frame: LocalBrowserExecute,
    claims: LocalBrowserGrantClaims,
    deadlineMs: number,
    actor: PrivateExpectedActor,
    registration: Registration,
    context: number,
  ): Promise<
    | { receipt: unknown; document?: { url: string; document_id: string } }
    | { reason: LocalBrowserRefusalReason }
  > {
    switch (claims.operation) {
      case 'discover':
        return this.discover(frame, claims, deadlineMs, actor, registration, context);
      case 'admit':
        return this.admit(frame, claims, deadlineMs, actor, registration, context);
      case 'renew':
        return this.renew(frame, claims, deadlineMs, actor, registration, context);
      case 'cleanup':
        return this.cleanup(frame, claims, deadlineMs, actor, registration, context);
      case 'approve':
        return this.approve(frame, claims, deadlineMs, actor, registration, context);
    }
  }

  /**
   * The sole local command executor. It is deliberately reached only from the
   * registered owned-tab lifecycle, and uses the admitted helpers for every
   * secret-bearing action. No normal tool dispatcher or Vault materializer is
   * reachable from this path.
   */
  private async approve(
    frame: LocalBrowserExecute,
    claims: Extract<LocalBrowserGrantClaims, { operation: 'approve' }>,
    deadlineMs: number,
    actor: PrivateExpectedActor,
    registration: Registration,
    context: number,
  ): Promise<CommandOutcome> {
    const parsed = frame.command_json ? parseStrictPrivateJson(frame.command_json) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return { reason: 'invalid_request' };
    if ((parsed as { operation?: unknown }).operation !== 'inspect_login')
      return this.executeApprove(frame, claims, deadlineMs, actor, registration, context);
    this.purgeInspectReplays();
    const key = [
      claims.run_id,
      claims.app_instance_id,
      claims.command_id,
      claims.sequence,
      claims.command_digest,
      claims.jti,
    ].join(':');
    const prior = this.inspectReplays.get(key);
    if (prior) {
      if (prior.inFlight) return await prior.inFlight;
      return { reason: 'discovery_refresh_required' };
    }
    const inFlight = this.executeApprove(frame, claims, deadlineMs, actor, registration, context);
    const replay: InspectReplay = { deadlineMs, inFlight };
    this.inspectReplays.set(key, replay);
    try {
      return await inFlight;
    } finally {
      // Transition before publish/settlement: later callers cannot join a completed future.
      replay.inFlight = null;
    }
  }

  private async executeApprove(
    frame: LocalBrowserExecute,
    claims: Extract<LocalBrowserGrantClaims, { operation: 'approve' }>,
    deadlineMs: number,
    actor: PrivateExpectedActor,
    registration: Registration,
    context: number,
  ): Promise<CommandOutcome> {
    const port = this.deps.command;
    if (!port || !frame.command_json) return { reason: 'authority_refused' };
    const entry = this.entries.get(runKey(claims));
    if (!entry || entry.tabId === null || entry.leaseExpiresAtMs === null)
      return { reason: 'authority_refused' };
    let command: LocalCommand;
    try {
      const parsed = parseStrictPrivateJson(frame.command_json);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return { reason: 'invalid_request' };
      const checked = parseLocalCommand(frame.command_json);
      if (!checked) return { reason: 'invalid_request' };
      const verification =
        checked.operation === 'vault_login' || checked.operation === 'authenticator'
          ? parseVerificationFields(checked)
          : null;
      if (
        (checked.operation === 'vault_login' || checked.operation === 'authenticator') &&
        (!verification || !(await verificationDigestMatches(verification)))
      )
        return { reason: 'invalid_request' };
      command = checked as LocalCommand;
    } catch {
      return { reason: 'invalid_request' };
    }
    const abort = new AbortController();
    const permissionGeneration = localBrowserApprovalGeneration();
    const unsubscribePermission = onLocalBrowserApprovalGenerationChange((generation) => {
      if (generation !== permissionGeneration) abort.abort();
    });
    const isCurrent = () =>
      !abort.signal.aborted &&
      this.canMutate(context, registration, deadlineMs) &&
      this.entries.get(entry.key) === entry &&
      entry.tabId !== null &&
      entry.leaseExpiresAtMs !== null &&
      Date.now() < entry.leaseExpiresAtMs;
    const isBindingCurrent = () =>
      this.canMutate(context, registration, deadlineMs) &&
      this.entries.get(entry.key) === entry &&
      entry.tabId !== null &&
      entry.leaseExpiresAtMs !== null &&
      Date.now() < entry.leaseExpiresAtMs;
    const currentnessPredicates = (): string[] => {
      const predicates: string[] = [];
      if (abort.signal.aborted) predicates.push('permission_abort');
      if (context !== this.contextGeneration) predicates.push('context');
      if (registration.socketEpoch !== this.deps.getSocketEpoch()) predicates.push('socket');
      if (!sameRegistration(this.activeRegistration, registration)) predicates.push('registration');
      if (this.entries.get(entry.key) !== entry) predicates.push('entry');
      if (entry.tabId === null) predicates.push('tab');
      if (entry.leaseExpiresAtMs === null) predicates.push('lease');
      if (entry.leaseExpiresAtMs !== null && Date.now() >= entry.leaseExpiresAtMs)
        predicates.push('lease_expired');
      if (Date.now() >= deadlineMs) predicates.push('deadline_expired');
      return predicates;
    };
    const verificationDiagnostic = (label: string) =>
      `local_browser_approve_verify_failed:${[label, ...currentnessPredicates()].join(',')}`;
    try {
      // A signed grant is routing data only. Reconstruct every immutable field
      // through the server before showing policy UI or touching the tab.
      const verified = await port.verify({
        grant: frame.grant,
        operation: 'approve',
        app_instance_id: claims.app_instance_id,
        command_json: frame.command_json,
        expectedActor: actor,
        deadlineMs,
        isCurrent,
        signal: abort.signal,
      });
      if (!verified.ok) {
        log.warn('desktop', verificationDiagnostic(`verify_${verified.error}`));
        return { reason: mapPrivateFailure(verified.error) };
      }
      if (verified.data.status !== 'accepted') {
        log.warn('desktop', verificationDiagnostic('verify_not_accepted'));
        return { reason: 'authority_refused' };
      }
      const projection = verified.data as unknown as {
        operation: 'approve';
        actor_id: string;
        organization_id: string;
        profile_id: string;
        admission_id: string;
        command_id: string;
        sequence: number;
        command_digest: string;
        approval_id: string;
        deadline_ms: number;
        expires_at_ms: number;
        extension_generation: string;
        connection_id: string;
        run_id: string;
        app_instance_id: string;
        controller_revision: number;
        jti: string;
      };
      if (projection.operation !== 'approve') return { reason: 'authority_refused' };
      const rejectedPredicates: string[] = [];
      const rejectWhen = (failed: boolean, predicate: string) => {
        if (failed) rejectedPredicates.push(predicate);
      };
      rejectWhen(projection.actor_id !== actor.userId, 'actor');
      rejectWhen(projection.organization_id !== actor.organizationId, 'organization');
      rejectWhen(projection.profile_id !== claims.profile_id, 'profile');
      rejectWhen(projection.admission_id !== entry.admissionId, 'admission');
      rejectWhen(projection.command_id !== claims.command_id, 'command');
      rejectWhen(projection.sequence !== claims.sequence, 'sequence');
      rejectWhen(projection.command_digest !== claims.command_digest, 'command_digest');
      rejectWhen(projection.approval_id !== claims.jti, 'approval');
      rejectWhen(projection.run_id !== claims.run_id, 'run');
      rejectWhen(projection.app_instance_id !== claims.app_instance_id, 'device');
      rejectWhen(
        projection.controller_revision !== claims.controller_revision,
        'controller_revision',
      );
      rejectWhen(projection.jti !== claims.jti, 'jti');
      rejectWhen(canonicalGrantDeadlineMs(projection.deadline_ms) !== deadlineMs, 'deadline');
      rejectWhen(canonicalGrantDeadlineMs(projection.expires_at_ms) !== deadlineMs, 'expiry');
      rejectWhen(
        projection.extension_generation !== registration.extensionGeneration,
        'generation',
      );
      rejectWhen(projection.connection_id !== registration.connectionId, 'connection');
      rejectedPredicates.push(...currentnessPredicates());
      if (rejectedPredicates.length) {
        log.warn(
          'desktop',
          `local_browser_approve_projection_fence_failed:${rejectedPredicates.join(',')}`,
        );
        return { reason: 'binding_changed' };
      }
      const decision = await requestLocalBrowserApproval({
        binding: {
          actorId: actor.userId,
          organizationId: actor.organizationId,
          deviceId: claims.app_instance_id,
          runId: claims.run_id,
          profileId: claims.profile_id,
          extensionGeneration: registration.extensionGeneration,
          connectionId: registration.connectionId,
          controllerRevision: claims.controller_revision,
          admissionId: entry.admissionId,
          commandSequence: claims.sequence,
          commandId: claims.command_id,
          commandDigest: claims.command_digest,
        },
        command,
        ownedTabId: entry.tabId,
        deadlineMs,
        isBindingCurrent: () => isCurrent(),
      });
      if (decision.decision !== 'allow' || !isCurrent()) {
        if (isBindingCurrent())
          await port.approve({
            grant: frame.grant,
            approval_id: projection.approval_id,
            decision: decision.decision === 'deny' ? 'deny' : 'cancel',
            expectedActor: actor,
            deadlineMs,
            isCurrent: isBindingCurrent,
            signal: abort.signal,
          });
        return { reason: 'authority_refused' };
      }
      const allowed = await port.approve({
        grant: frame.grant,
        approval_id: projection.approval_id,
        decision: 'allow',
        expectedActor: actor,
        deadlineMs,
        isCurrent,
        signal: abort.signal,
      });
      if (!allowed.ok || allowed.data.status !== 'allowed' || !isCurrent())
        return { reason: allowed.ok ? 'authority_refused' : mapPrivateFailure(allowed.error) };
      const doc = await port.currentDocument(entry.tabId);
      if (!doc || !isCurrent()) return { reason: 'binding_changed' };
      // Claim authorization is deliberately short.  Once the server accepts
      // it, execution may use the owned lease (never a fresh grant).
      const requestStartMs = Date.now();
      const executionDeadlineMs = Math.min(requestStartMs + 60_000, entry.leaseExpiresAtMs ?? 0);
      const claimed = await port.claim({
        grant: allowed.data.claim_grant,
        command_json: frame.command_json,
        document: { url: doc.url, document_id: doc.documentId },
        expectedActor: actor,
        deadlineMs: executionDeadlineMs,
        authorizationDeadlineMs: allowed.data.deadline_ms,
        executionDeadlineMs,
        commandId: claims.command_id,
        isCurrent,
        signal: abort.signal,
      });
      if (!claimed.ok || claimed.data.status !== 'claimed' || !isCurrent())
        return { reason: claimed.ok ? 'authority_refused' : mapPrivateFailure(claimed.error) };
      const result = await this.performClaimedCommand(
        command,
        entry.tabId,
        doc,
        claimed.data,
        isCurrent,
        async () => await this.documentStillCurrent(entry.tabId as number, doc, isCurrent),
      );
      // A permission generation can withdraw injection authority after the claim. It must not
      // mint authority in a new context, but the original completion grant may still close the
      // exact claimed row while the actor/org/controller binding remains current.
      const completionCurrent = isBindingCurrent;
      if (!completionCurrent()) return { reason: 'binding_changed' };
      const completionResult: LocalCommandResult = isCurrent()
        ? result
        : {
            command_id: claimed.data.command_id,
            operation: command.operation,
            outcome: 'cancelled',
            reason: 'binding_changed',
          };
      const completionAbort = new AbortController();
      const completed = await port.complete({
        grant: claimed.data.completion_grant,
        result: completionResult,
        expectedActor: actor,
        deadlineMs: claimed.data.deadline_ms,
        isCurrent: completionCurrent,
        signal: completionAbort.signal,
      });
      if (!completed.ok || completed.data.status !== 'completed')
        return { reason: completed.ok ? 'authority_refused' : mapPrivateFailure(completed.error) };
      return {
        receipt: completed.data.result,
        ...(command.operation === 'inspect_login'
          ? {
              document: {
                url: new URL(doc.url).origin + new URL(doc.url).pathname,
                document_id: doc.documentId,
              },
            }
          : {}),
      };
    } finally {
      abort.abort();
      unsubscribePermission();
    }
  }

  private async documentStillCurrent(
    tabId: number,
    expected: { documentId: string; url: string },
    isCurrent: () => boolean,
  ): Promise<boolean> {
    if (!isCurrent() || !this.deps.command) return false;
    const current = await this.deps.command.currentDocument(tabId);
    return (
      isCurrent() &&
      current?.documentId === expected.documentId &&
      current.url === expected.url &&
      new URL(current.url).origin === new URL(expected.url).origin
    );
  }

  private async performClaimedCommand(
    command: LocalCommand,
    tabId: number,
    document: { documentId: string; url: string },
    claimed: Extract<Awaited<ReturnType<typeof claimLocalCommand>>, { ok: true }>['data'] & {
      status: 'claimed';
    },
    isCurrent: () => boolean,
    assertCurrentDocument: () => Promise<boolean>,
  ): Promise<LocalCommandResult> {
    const terminal = (
      reason:
        | 'unsafe_destination'
        | 'field_unavailable'
        | 'form_changed'
        | 'needs_mfa'
        | 'captcha_or_takeover'
        | 'credentials_rejected'
        | 'deadline_exceeded'
        | 'binding_changed'
        | 'tab_lost'
        | 'configuration_error',
    ): LocalCommandResult => ({
      command_id: claimed.command_id,
      operation: command.operation,
      outcome: 'outcome_unknown',
      reason,
    });
    if (!isCurrent() || !(await assertCurrentDocument())) return terminal('binding_changed');
    if (command.operation === 'navigate') {
      try {
        const target = new URL(command.url);
        if (target.protocol !== 'https:') return terminal('unsafe_destination');
        const completed = await this.navigateOwnedTab(
          tabId,
          document,
          target,
          claimed.deadline_ms,
          isCurrent,
        );
        if (!completed) return terminal('tab_lost');
        return {
          command_id: claimed.command_id,
          operation: 'navigate',
          outcome: 'completed',
          reason: 'none',
          data: { origin: target.origin },
        };
      } catch {
        return terminal('configuration_error');
      }
    }
    if (command.operation === 'inspect_login') {
      try {
        const [probe] = await chrome.scripting.executeScript({
          target: { tabId, documentIds: [document.documentId] },
          func: credentialDomSource,
          args: [{ operation: 'auto_probe' }],
        });
        const value = probe?.result as LoginFormProbe | undefined;
        const origin = new URL(document.url).origin;
        if (
          !value ||
          !value.is_top_frame ||
          value.origin !== origin ||
          !value.destination_safe ||
          !(await assertCurrentDocument())
        )
          return terminal('unsafe_destination');
        return {
          command_id: claimed.command_id,
          operation: 'inspect_login',
          outcome: 'completed',
          reason: 'none',
          data: {
            origin,
            form: value.password_selector
              ? 'login'
              : value.username_selector
                ? 'username_first'
                : 'none',
            challenge: 'unknown',
          },
        };
      } catch {
        return terminal('tab_lost');
      }
    }
    let filled = false;
    let submitted = false;
    let observation: EvaluatedObservation | null = null;
    let lastStage: AdmittedExecutionStage | null = null;
    const executionTerminal = async (
      status: CredentialLoginStatus,
    ): Promise<LocalCommandResult> => {
      const reason =
        !isCurrent() || (!submitted && !(await assertCurrentDocument()))
          ? 'binding_changed'
          : Date.now() >= claimed.deadline_ms
            ? 'deadline_exceeded'
            : status === 'unsafe_destination'
              ? 'unsafe_destination'
              : lastStage === 'initial_probe'
                ? 'form_changed'
                : lastStage === 'selector_check' || lastStage === 'materialize'
                  ? 'field_unavailable'
                  : lastStage === 'wait'
                    ? 'form_changed'
                    : lastStage === 'post_submit_document'
                      ? 'tab_lost'
                      : lastStage === 'before_evidence' ||
                          lastStage === 'step_probe' ||
                          lastStage === 'fill' ||
                          lastStage === 'submit' ||
                          lastStage === 'classification'
                        ? 'form_changed'
                        : 'configuration_error';
      log.warn(
        'desktop',
        `local_browser_terminal:${command.operation}:${lastStage ?? 'none'}:filled=${filled}:submitted=${submitted}`,
      );
      return terminal(reason);
    };
    const frozenVerification = parseVerificationFields(command);
    if (!frozenVerification) return terminal('configuration_error');
    const observePostSubmitDocument = postSubmitDocumentObserver({
      original: document,
      deadlineMs: claimed.deadline_ms,
      isCurrent,
      isSubmitted: () => submitted,
      currentDocument: async () => (await this.deps.command?.currentDocument(tabId)) ?? null,
    });
    const mapped = mapLocalCommandToHandler(command, tabId);
    if (!mapped || mapped.toolName !== 'credential_login') return terminal('configuration_error');
    const result =
      command.operation === 'vault_login'
        ? await runAdmittedCredentialAttempt(mapped.args, tabId, document.url, {
            commandId: claimed.command_id,
            documentId: document.documentId,
            deadlineMs: claimed.deadline_ms,
            isCurrent,
            onProgress: (event) => {
              if (event === 'filled') filled = true;
              else submitted = true;
            },
            onStage: (stage) => {
              lastStage = stage;
            },
            observePostSubmitDocument,
            assertCurrent: async () => {
              if (!isCurrent() || !(await assertCurrentDocument()))
                throw new Error('binding_changed');
            },
            materialize: async () =>
              claimed.injection && 'fields' in claimed.injection
                ? {
                    ok: true,
                    data: {
                      item_id: command.credential_item_id as string,
                      origin: claimed.injection.origin,
                      fields: claimed.injection.fields,
                    },
                  }
                : { ok: false, failure: { kind: 'forbidden' } },
            report: async () => undefined,
            verificationSpec: frozenVerification.spec,
            recordObservation: (value) => {
              observation = value;
            },
          })
        : await runAdmittedAuthenticatorAttempt(mapped.args, tabId, document.url, {
            commandId: claimed.command_id,
            documentId: document.documentId,
            deadlineMs: claimed.deadline_ms,
            isCurrent,
            onProgress: (event) => {
              if (event === 'filled') filled = true;
              else submitted = true;
            },
            onStage: (stage) => {
              lastStage = stage;
            },
            observePostSubmitDocument,
            assertCurrent: async () => {
              if (!isCurrent() || !(await assertCurrentDocument()))
                throw new Error('binding_changed');
            },
            materialize: async () =>
              claimed.injection && 'code' in claimed.injection
                ? {
                    ok: true,
                    data: {
                      injection_id: claimed.command_id,
                      origin: claimed.injection.origin,
                      code: claimed.injection.code,
                      expires_at: claimed.injection.expires_at,
                    },
                  }
                : { ok: false, failure: { kind: 'forbidden' } },
            report: async () => undefined,
            verificationSpec: frozenVerification.spec,
            recordObservation: (value) => {
              observation = value;
            },
          });
    const verification =
      result.status === 'authenticated'
        ? 'verified'
        : result.status === 'needs_mfa'
          ? 'needs_mfa'
          : result.status === 'credentials_rejected'
            ? 'credentials_rejected'
            : result.status === 'captcha_or_takeover'
              ? 'captcha_or_takeover'
              : 'unverified';
    if (!observation) return await executionTerminal(result.status);
    return command.operation === 'vault_login'
      ? {
          command_id: claimed.command_id,
          operation: 'vault_login',
          outcome: 'completed',
          reason: 'none',
          data: {
            filled,
            submitted,
            verification,
            observation,
            verification_digest: frozenVerification.verification_digest,
          },
        }
      : {
          command_id: claimed.command_id,
          operation: 'authenticator',
          outcome: 'completed',
          reason: 'none',
          data: {
            filled,
            submitted,
            challenge_detected: result.status === 'needs_mfa',
            verification,
            observation,
            verification_digest: frozenVerification.verification_digest,
          },
        };
  }

  private async navigateOwnedTab(
    tabId: number,
    original: { documentId: string; url: string },
    target: URL,
    deadlineMs: number,
    isCurrent: () => boolean,
  ): Promise<boolean> {
    if (!isCurrent() || Date.now() >= deadlineMs) return false;
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        off();
        resolve(value);
      };
      const off = this.deps.tabs.onUpdated((updatedTabId, changeInfo) => {
        if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
        void (async () => {
          if (!isCurrent() || Date.now() >= deadlineMs) return settle(false);
          const current = await this.deps.command?.currentDocument(tabId);
          settle(
            !!current &&
              isCurrent() &&
              current.documentId !== original.documentId &&
              new URL(current.url).origin === target.origin,
          );
        })();
      });
      const timeout = setTimeout(() => settle(false), Math.max(0, deadlineMs - Date.now()));
      void this.deps.tabs.update(tabId, { url: target.toString() }).catch(() => settle(false));
    });
  }

  private async discover(
    frame: LocalBrowserExecute,
    _claims: Extract<LocalBrowserGrantClaims, { operation: 'discover' }>,
    deadlineMs: number,
    actor: PrivateExpectedActor,
    registration: Registration,
    context: number,
  ): Promise<{ receipt: 'accepted' } | { reason: LocalBrowserRefusalReason }> {
    const result = await this.deps.verify({
      grant: frame.grant,
      proof: {
        operation: 'discover',
        extension_generation: registration.extensionGeneration,
        connection_id: registration.connectionId,
      },
      expectedActor: actor,
      deadlineMs,
    });
    if (!result.ok) return { reason: mapPrivateFailure(result.error) };
    if (result.data.status !== 'accepted') return { reason: 'authority_refused' };
    if (!this.canMutate(context, registration, deadlineMs)) return { reason: 'binding_changed' };
    return { receipt: 'accepted' };
  }

  private async admit(
    frame: LocalBrowserExecute,
    claims: Extract<LocalBrowserGrantClaims, { operation: 'admit' }>,
    deadlineMs: number,
    actor: PrivateExpectedActor,
    registration: Registration,
    context: number,
  ): Promise<
    { receipt: 'created' | 'cancelled' | 'failed' } | { reason: LocalBrowserRefusalReason }
  > {
    const key = runKey(claims);
    const existing = this.entries.get(key);
    if (existing) {
      if (
        !sameRegistration(existing.registration, registration) ||
        existing.grantJti !== claims.jti ||
        existing.grant !== frame.grant
      )
        return { reason: 'retry_conflict' };
      if (
        existing.actor.userId !== actor.userId ||
        existing.actor.organizationId !== actor.organizationId ||
        existing.actor.sessionId !== actor.sessionId
      )
        return { reason: 'binding_changed' };
      if (existing.admitted) return existing.admitted;
      if (existing.terminalAdmissionReceipt) return { receipt: existing.terminalAdmissionReceipt };
      if (existing.tabId !== null && existing.leaseExpiresAtMs === null)
        return this.acknowledgeAdmission(existing, frame, claims, deadlineMs, actor, context);
      return { receipt: existing.tabId === null ? 'cancelled' : 'created' };
    }
    if (this.entries.size >= MAX_OWNED_RUNS) return { reason: 'rate_limited' };
    const entry: OwnedRun = {
      key,
      registration,
      runId: claims.run_id,
      admissionId: claims.admission_id,
      grantJti: claims.jti,
      grant: frame.grant,
      actor,
      tabId: null,
      leaseExpiresAtMs: null,
      terminalAdmissionReceipt: null,
      grantDeadlineMs: deadlineMs,
      admitted: null,
      cleanup: null,
      cleanupStopId: null,
      expiryTimer: null,
    };
    this.entries.set(key, entry);
    entry.admitted = this.createAndAcknowledge(entry, frame, claims, deadlineMs, actor, context);
    const outcome = await entry.admitted;
    entry.admitted = null;
    return outcome;
  }

  private async createAndAcknowledge(
    entry: OwnedRun,
    frame: LocalBrowserExecute,
    claims: Extract<LocalBrowserGrantClaims, { operation: 'admit' }>,
    deadlineMs: number,
    actor: PrivateExpectedActor,
    context: number,
  ): Promise<AdmissionOutcome> {
    const verified = await this.deps.verify({
      grant: frame.grant,
      proof: { operation: 'admit', admission_id: claims.admission_id },
      expectedActor: actor,
      deadlineMs,
    });
    if (
      !verified.ok ||
      verified.data.status !== 'accepted' ||
      !this.canMutate(context, entry.registration, deadlineMs) ||
      this.entries.get(entry.key) !== entry
    ) {
      this.terminalize(entry, 'cancelled');
      return { reason: verified.ok ? 'binding_changed' : mapPrivateFailure(verified.error) };
    }
    if (entry.cleanup) {
      this.terminalize(entry, 'cancelled');
      return { receipt: 'cancelled' };
    }
    if (
      !this.canMutate(context, entry.registration, deadlineMs) ||
      this.entries.get(entry.key) !== entry
    )
      return { reason: 'binding_changed' };
    let tab: chrome.tabs.Tab;
    try {
      tab = await this.deps.tabs.create({ url: 'about:blank', active: false });
    } catch {
      this.terminalize(entry, 'failed');
      return { receipt: 'failed' };
    }
    if (typeof tab.id !== 'number') {
      this.terminalize(entry, 'failed');
      return { receipt: 'failed' };
    }
    if (!this.canMutate(context, entry.registration, deadlineMs)) {
      this.terminalize(entry, 'cancelled', tab.id);
      return { receipt: 'cancelled' };
    }
    entry.tabId = tab.id;
    entry.grantDeadlineMs = deadlineMs;
    this.armDeadline(entry);
    return this.acknowledgeAdmission(entry, frame, claims, deadlineMs, actor, context);
  }

  private async acknowledgeAdmission(
    entry: OwnedRun,
    frame: LocalBrowserExecute,
    claims: Extract<LocalBrowserGrantClaims, { operation: 'admit' }>,
    deadlineMs: number,
    actor: PrivateExpectedActor,
    context: number,
  ): Promise<AdmissionOutcome> {
    if (entry.tabId === null) return { receipt: entry.terminalAdmissionReceipt ?? 'cancelled' };
    const acknowledged = await this.deps.acknowledge({
      grant: frame.grant,
      operation: 'admit',
      receipt: { admission_id: claims.admission_id, status: 'created' },
      expectedActor: actor,
      deadlineMs,
    });
    if (
      !this.canMutate(context, entry.registration, deadlineMs) ||
      this.entries.get(entry.key) !== entry
    ) {
      return { reason: 'binding_changed' };
    }
    if (!acknowledged.ok) return { reason: mapPrivateFailure(acknowledged.error) };
    if (
      acknowledged.data.status !== 'accepted' ||
      acknowledged.data.operation !== 'admit' ||
      acknowledged.data.receipt.status !== 'created' ||
      acknowledged.data.lease_expires_at_ms === null ||
      acknowledged.data.lease_expires_at_ms <= Date.now()
    ) {
      this.terminalize(entry, 'cancelled');
      return { receipt: 'cancelled' };
    }
    entry.leaseExpiresAtMs = acknowledged.data.lease_expires_at_ms;
    this.armExpiry(entry);
    return { receipt: 'created' };
  }

  private async renew(
    frame: LocalBrowserExecute,
    claims: Extract<LocalBrowserGrantClaims, { operation: 'renew' }>,
    deadlineMs: number,
    actor: PrivateExpectedActor,
    registration: Registration,
    context: number,
  ): Promise<{ receipt: 'accepted' } | { reason: LocalBrowserRefusalReason }> {
    const entry = this.entries.get(runKey(claims));
    if (
      !entry ||
      entry.tabId === null ||
      entry.leaseExpiresAtMs === null ||
      entry.leaseExpiresAtMs <= Date.now() ||
      !sameRegistration(entry.registration, registration)
    )
      return { reason: 'authority_refused' };
    try {
      await this.deps.tabs.get(entry.tabId);
    } catch {
      this.terminalize(entry, 'cancelled');
      return { reason: 'authority_refused' };
    }
    const verified = await this.deps.verify({
      grant: frame.grant,
      proof: {
        operation: 'renew',
        renewal_id: claims.renewal_id,
        admission_id: claims.admission_id,
      },
      expectedActor: actor,
      deadlineMs,
    });
    if (!verified.ok) return { reason: mapPrivateFailure(verified.error) };
    if (
      !this.canMutate(context, registration, deadlineMs) ||
      this.entries.get(entry.key) !== entry ||
      verified.data.status !== 'accepted' ||
      !('expires_at_ms' in verified.data) ||
      verified.data.expires_at_ms <= Date.now()
    )
      return { reason: 'binding_changed' };
    entry.leaseExpiresAtMs = verified.data.expires_at_ms;
    this.armExpiry(entry);
    return { receipt: 'accepted' };
  }

  private async cleanup(
    frame: LocalBrowserExecute,
    claims: Extract<LocalBrowserGrantClaims, { operation: 'cleanup' }>,
    deadlineMs: number,
    actor: PrivateExpectedActor,
    registration: Registration,
    context: number,
  ): Promise<CleanupOutcome> {
    this.purgeCleanupReceipts();
    const entry = this.entries.get(runKey(claims));
    const key = cleanupKey(claims);
    const existing = this.cleanupReceipts.get(key);
    if (existing) {
      if (
        !sameRegistration(existing.registration, registration) ||
        existing.grantJti !== claims.jti ||
        existing.grant !== frame.grant
      )
        return { reason: 'retry_conflict' };
      if (existing.inFlight) return existing.inFlight;
      if (existing.receipt !== null)
        return this.acknowledgeCleanup(
          frame,
          claims,
          deadlineMs,
          actor,
          existing.receipt,
          existing,
          context,
        );
    }
    if (entry?.cleanup) {
      return entry.cleanupStopId === claims.stop_id ? entry.cleanup : { reason: 'retry_conflict' };
    }
    if (!entry) return { reason: 'authority_refused' };
    if (this.cleanupReceipts.size >= MAX_OWNED_RUNS) return { reason: 'rate_limited' };
    const record: CleanupReceipt = {
      grant: frame.grant,
      registration,
      grantJti: claims.jti,
      receipt: null,
      expiresAtMs: deadlineMs,
      inFlight: null,
    };
    this.cleanupReceipts.set(key, record);
    entry.cleanupStopId = claims.stop_id;
    let resolveWork!: (outcome: CleanupOutcome) => void;
    const work = new Promise<CleanupOutcome>((resolve) => {
      resolveWork = resolve;
    });
    record.inFlight = work;
    entry.cleanup = work;
    void this.performCleanup(
      frame,
      claims,
      deadlineMs,
      actor,
      registration,
      context,
      entry,
      record,
    ).then(resolveWork, () => resolveWork({ reason: 'authority_refused' }));
    try {
      const outcome = await work;
      if ('receipt' in outcome && !this.canMutate(context, registration, deadlineMs)) {
        this.logCleanupDiagnostic('completion_fence', [
          ...this.cleanupCurrentnessPredicates(context, registration, deadlineMs),
        ]);
        return { reason: 'binding_changed' };
      }
      return outcome;
    } finally {
      if (entry.cleanup === work) {
        entry.cleanup = null;
        entry.cleanupStopId = null;
        if (entry.terminalAdmissionReceipt !== null) this.armTerminalTombstone(entry);
      }
      if (record.inFlight === work) record.inFlight = null;
    }
  }

  private async performCleanup(
    frame: LocalBrowserExecute,
    claims: Extract<LocalBrowserGrantClaims, { operation: 'cleanup' }>,
    deadlineMs: number,
    actor: PrivateExpectedActor,
    registration: Registration,
    context: number,
    entry: OwnedRun,
    record: CleanupReceipt,
  ): Promise<CleanupOutcome> {
    if (!sameRegistration(entry.registration, registration)) {
      this.logCleanupDiagnostic('entry_fence', ['entry_registration']);
      return { reason: 'authority_refused' };
    }
    if (entry?.admitted) await entry.admitted;
    const verified = await this.deps.verify({
      grant: frame.grant,
      proof: { operation: 'cleanup', stop_id: claims.stop_id, admission_id: claims.admission_id },
      expectedActor: actor,
      deadlineMs,
    });
    if (!verified.ok) {
      this.logCleanupDiagnostic('verify_failed', [
        `verify_${privateFailureDiagnosticLabel(verified.error)}`,
        ...this.cleanupCurrentnessPredicates(
          context,
          registration,
          deadlineMs,
          entry,
          record,
          claims,
        ),
      ]);
      return { reason: mapPrivateFailure(verified.error) };
    }
    if (verified.data.status !== 'accepted') {
      this.logCleanupDiagnostic('verify_not_accepted', [
        ...this.cleanupCurrentnessPredicates(
          context,
          registration,
          deadlineMs,
          entry,
          record,
          claims,
        ),
      ]);
      return { reason: 'authority_refused' };
    }
    const beforeRemove = this.cleanupCurrentnessPredicates(
      context,
      registration,
      deadlineMs,
      entry,
      record,
      claims,
    );
    if (beforeRemove.length) {
      this.logCleanupDiagnostic('fence_before_remove', beforeRemove);
      return { reason: 'binding_changed' };
    }
    if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
    let receipt: 'closed' | 'already_absent' | 'unconfirmed' = 'already_absent';
    if (entry.tabId !== null) {
      try {
        await this.deps.tabs.remove(entry.tabId);
        receipt = 'closed';
      } catch {
        receipt = 'unconfirmed';
      }
    }
    const afterRemove = this.cleanupCurrentnessPredicates(
      context,
      registration,
      deadlineMs,
      entry,
      record,
      claims,
    );
    if (afterRemove.length) {
      this.logCleanupDiagnostic('fence_after_remove', afterRemove);
      return { reason: 'binding_changed' };
    }
    record.receipt = receipt;
    entry.tabId = null;
    entry.leaseExpiresAtMs = null;
    entry.terminalAdmissionReceipt ??= 'cancelled';
    const outcome = await this.acknowledgeCleanup(
      frame,
      claims,
      deadlineMs,
      actor,
      receipt,
      record,
      context,
    );
    if ('reason' in outcome) return outcome;
    return outcome;
  }

  private async acknowledgeCleanup(
    frame: LocalBrowserExecute,
    claims: Extract<LocalBrowserGrantClaims, { operation: 'cleanup' }>,
    deadlineMs: number,
    actor: PrivateExpectedActor,
    receipt: 'closed' | 'already_absent' | 'unconfirmed',
    record: CleanupReceipt,
    context: number,
  ): Promise<
    { receipt: 'closed' | 'already_absent' | 'unconfirmed' } | { reason: LocalBrowserRefusalReason }
  > {
    const acknowledged = await this.deps.acknowledge({
      grant: frame.grant,
      operation: 'cleanup',
      receipt: { stop_id: claims.stop_id, status: receipt },
      expectedActor: actor,
      deadlineMs,
    });
    const acknowledgementFence = this.cleanupCurrentnessPredicates(
      context,
      record.registration,
      deadlineMs,
      undefined,
      record,
      claims,
    );
    if (acknowledgementFence.length) {
      this.logCleanupDiagnostic('ack_fence', acknowledgementFence);
      return { reason: 'binding_changed' };
    }
    if (!acknowledged.ok) {
      this.logCleanupDiagnostic('ack_failed', [
        `ack_${privateFailureDiagnosticLabel(acknowledged.error)}`,
        ...this.cleanupCurrentnessPredicates(
          context,
          record.registration,
          deadlineMs,
          undefined,
          record,
          claims,
        ),
      ]);
      return { reason: mapPrivateFailure(acknowledged.error) };
    }
    if (acknowledged.data.status !== 'accepted' || acknowledged.data.operation !== 'cleanup') {
      this.logCleanupDiagnostic('ack_not_accepted', [
        ...this.cleanupCurrentnessPredicates(
          context,
          record.registration,
          deadlineMs,
          undefined,
          record,
          claims,
        ),
      ]);
      return { reason: 'authority_refused' };
    }
    return { receipt: acknowledged.data.receipt.status };
  }

  private cleanupCurrentnessPredicates(
    context: number,
    registration: Registration,
    deadlineMs: number,
    entry?: OwnedRun,
    record?: CleanupReceipt,
    claims?: Extract<LocalBrowserGrantClaims, { operation: 'cleanup' }>,
  ): string[] {
    const predicates: string[] = [];
    if (context !== this.contextGeneration) predicates.push('context');
    if (registration.socketEpoch !== this.deps.getSocketEpoch()) predicates.push('socket');
    if (!sameRegistration(this.activeRegistration, registration)) predicates.push('registration');
    if (Date.now() >= deadlineMs) predicates.push('deadline_expired');
    if (entry && this.entries.get(entry.key) !== entry) predicates.push('entry');
    if (record && claims && this.cleanupReceipts.get(cleanupKey(claims)) !== record)
      predicates.push('cleanup_record');
    return predicates;
  }

  private logCleanupDiagnostic(stage: string, predicates: string[]): void {
    log.warn(
      'desktop',
      `local_browser_cleanup_${stage}:${predicates.length ? predicates.join(',') : 'none'}`,
    );
  }

  private purgeCleanupReceipts(): void {
    const now = Date.now();
    for (const [key, receipt] of this.cleanupReceipts) {
      if (receipt.expiresAtMs <= now) this.cleanupReceipts.delete(key);
    }
  }

  private purgeInspectReplays(): void {
    const now = Date.now();
    for (const [key, replay] of this.inspectReplays) {
      if (replay.deadlineMs <= now && replay.inFlight === null) this.inspectReplays.delete(key);
    }
  }

  private armExpiry(entry: OwnedRun): void {
    if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
    if (!entry.leaseExpiresAtMs) return;
    entry.expiryTimer = setTimeout(
      () => {
        if (this.entries.get(entry.key) !== entry || entry.tabId === null) return;
        this.terminalize(entry, 'cancelled');
      },
      Math.max(0, entry.leaseExpiresAtMs - Date.now()),
    );
  }

  private armDeadline(entry: OwnedRun): void {
    if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
    entry.expiryTimer = setTimeout(
      () => {
        if (this.entries.get(entry.key) !== entry || entry.tabId === null) return;
        this.terminalize(entry, 'cancelled');
      },
      Math.max(0, entry.grantDeadlineMs - Date.now()),
    );
  }

  private async respond(
    frame: LocalBrowserExecute,
    socketEpoch: string,
    outcome:
      | { receipt: unknown; document?: { url: string; document_id: string } }
      | { reason: LocalBrowserRefusalReason },
  ): Promise<void> {
    const payload =
      'reason' in outcome
        ? localBrowserResult({
            type: 'local_browser.result',
            version: 1,
            call_id: frame.call_id,
            operation: frame.operation,
            status: 'refused',
            reason: outcome.reason,
          })
        : frame.operation === 'approve'
          ? localBrowserResult({
              type: 'local_browser.result',
              version: 1,
              call_id: frame.call_id,
              operation: 'approve',
              status: 'acknowledged',
              terminal_receipt: outcome.receipt,
              ...(outcome.document ? { document: outcome.document } : {}),
            })
          : localBrowserResult({
              type: 'local_browser.result',
              version: 1,
              call_id: frame.call_id,
              operation: frame.operation,
              status: 'acknowledged',
              receipt: outcome.receipt,
            } as never);
    let delivered = false;
    try {
      delivered = await this.deps.send(socketEpoch, payload);
    } catch {
      // Socket epochs are one-shot. Lost result delivery is retried only by a
      // later identical server execution, using the existing private receipt.
    }
    if (!delivered) log.warn('desktop', 'local_browser_result_delivery_failed');
  }
}

let controller: LocalBrowserController | null = null;

/** Register the private lifecycle owner once during service-worker bootstrap. */
export function startLocalBrowserController(): void {
  controller ??= new LocalBrowserController();
  controller.start();
}
