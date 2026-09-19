import {
  type PrivateApiResult,
  type PrivateExpectedActor,
  getPrivateExpectedActor,
} from '@/lib/api/client';
import {
  type LocalBrowserAckResponse,
  type LocalVerifyResponse,
  acknowledgeLocalBrowser,
  verifyLocalBrowser,
} from '@/lib/api/routes/local-browser';
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
  tabId: number | null;
  leaseExpiresAtMs: number | null;
  admitted: Promise<'created' | 'cancelled' | 'failed'> | null;
  expiryTimer: ReturnType<typeof setTimeout> | null;
};

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
    onRemoved: (handler: (tabId: number) => void) => () => void;
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
      onRemoved: (handler) => {
        chrome.tabs.onRemoved.addListener(handler);
        return () => chrome.tabs.onRemoved.removeListener(handler);
      },
    },
  };
}

function deadlineFromClaims(claims: LocalBrowserGrantClaims): number | null {
  if (claims.exp > Math.floor(Number.MAX_SAFE_INTEGER / 1000)) return null;
  const deadline = claims.exp * 1000;
  return deadline > Date.now() ? deadline : null;
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

/** Private, background-only owner for tabs created by the lifecycle protocol. */
export class LocalBrowserController {
  private readonly entries = new Map<string, OwnedRun>();
  private pendingRegistration: Registration | null = null;
  private activeRegistration: Registration | null = null;
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
        void this.receive(payload, socketEpoch);
      }),
      this.deps.onEpochInvalidated(() => this.invalidate()),
      this.deps.onAuthChanged(() => this.invalidate()),
      this.deps.onOrganizationChanged(() => this.invalidate()),
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
    for (const entry of retired) {
      if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
      if (entry.tabId !== null) void this.closeTab(entry.tabId);
    }
  }

  private forgetRemovedTab(tabId: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.tabId !== tabId) continue;
      if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
      this.entries.delete(key);
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
    if (frame.type === 'local_browser.register_required') {
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
      !sent ||
      this.pendingRegistration !== registration ||
      socketEpoch !== this.deps.getSocketEpoch()
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

  private async run(
    frame: LocalBrowserExecute,
    claims: LocalBrowserGrantClaims,
    deadlineMs: number,
    actor: PrivateExpectedActor,
    registration: Registration,
    context: number,
  ): Promise<{ receipt: string } | { reason: LocalBrowserRefusalReason }> {
    switch (claims.operation) {
      case 'discover':
        return this.discover(frame, claims, deadlineMs, actor, registration, context);
      case 'admit':
        return this.admit(frame, claims, deadlineMs, actor, registration, context);
      case 'renew':
        return this.renew(frame, claims, deadlineMs, actor, registration, context);
      case 'cleanup':
        return this.cleanup(frame, claims, deadlineMs, actor, registration, context);
    }
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
    if (!this.isCurrent(context, registration, registration.socketEpoch))
      return { reason: 'binding_changed' };
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
      if (!sameRegistration(existing.registration, registration))
        return { reason: 'retry_conflict' };
      if (existing.admitted) return { receipt: await existing.admitted };
      return { receipt: existing.tabId === null ? 'cancelled' : 'created' };
    }
    if (this.entries.size >= MAX_OWNED_RUNS) return { reason: 'rate_limited' };
    const entry: OwnedRun = {
      key,
      registration,
      runId: claims.run_id,
      admissionId: claims.admission_id,
      tabId: null,
      leaseExpiresAtMs: null,
      admitted: null,
      expiryTimer: null,
    };
    this.entries.set(key, entry);
    entry.admitted = this.createAndAcknowledge(entry, frame, claims, deadlineMs, actor, context);
    const receipt = await entry.admitted;
    entry.admitted = null;
    return { receipt };
  }

  private async createAndAcknowledge(
    entry: OwnedRun,
    frame: LocalBrowserExecute,
    claims: Extract<LocalBrowserGrantClaims, { operation: 'admit' }>,
    deadlineMs: number,
    actor: PrivateExpectedActor,
    context: number,
  ): Promise<'created' | 'cancelled' | 'failed'> {
    const verified = await this.deps.verify({
      grant: frame.grant,
      proof: { operation: 'admit', admission_id: claims.admission_id },
      expectedActor: actor,
      deadlineMs,
    });
    if (
      !verified.ok ||
      !this.isCurrent(context, entry.registration, entry.registration.socketEpoch)
    ) {
      this.entries.delete(entry.key);
      return 'cancelled';
    }
    let tab: chrome.tabs.Tab;
    try {
      tab = await this.deps.tabs.create({ url: 'about:blank', active: false });
    } catch {
      this.entries.delete(entry.key);
      return 'failed';
    }
    if (typeof tab.id !== 'number') {
      this.entries.delete(entry.key);
      return 'failed';
    }
    if (!this.isCurrent(context, entry.registration, entry.registration.socketEpoch)) {
      this.entries.delete(entry.key);
      await this.closeTab(tab.id);
      return 'cancelled';
    }
    entry.tabId = tab.id;
    const acknowledged = await this.deps.acknowledge({
      grant: frame.grant,
      operation: 'admit',
      receipt: { admission_id: claims.admission_id, status: 'created' },
      expectedActor: actor,
      deadlineMs,
    });
    if (
      !acknowledged.ok ||
      !this.isCurrent(context, entry.registration, entry.registration.socketEpoch) ||
      acknowledged.data.status !== 'accepted' ||
      acknowledged.data.operation !== 'admit' ||
      acknowledged.data.receipt.status !== 'created' ||
      acknowledged.data.lease_expires_at_ms === null ||
      acknowledged.data.lease_expires_at_ms <= Date.now()
    ) {
      this.entries.delete(entry.key);
      await this.closeTab(tab.id);
      return 'cancelled';
    }
    entry.leaseExpiresAtMs = acknowledged.data.lease_expires_at_ms;
    this.armExpiry(entry);
    return 'created';
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
      this.entries.delete(entry.key);
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
      !this.isCurrent(context, registration, registration.socketEpoch) ||
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
  ): Promise<
    { receipt: 'closed' | 'already_absent' | 'unconfirmed' } | { reason: LocalBrowserRefusalReason }
  > {
    const entry = this.entries.get(runKey(claims));
    if (!entry || !sameRegistration(entry.registration, registration))
      return { reason: 'authority_refused' };
    const verified = await this.deps.verify({
      grant: frame.grant,
      proof: { operation: 'cleanup', stop_id: claims.stop_id, admission_id: claims.admission_id },
      expectedActor: actor,
      deadlineMs,
    });
    if (!verified.ok) return { reason: mapPrivateFailure(verified.error) };
    if (
      !this.isCurrent(context, registration, registration.socketEpoch) ||
      this.entries.get(entry.key) !== entry
    )
      return { reason: 'binding_changed' };
    this.entries.delete(entry.key);
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
    const acknowledged = await this.deps.acknowledge({
      grant: frame.grant,
      operation: 'cleanup',
      receipt: { stop_id: claims.stop_id, status: receipt },
      expectedActor: actor,
      deadlineMs,
    });
    if (!acknowledged.ok) return { reason: mapPrivateFailure(acknowledged.error) };
    if (acknowledged.data.status !== 'accepted' || acknowledged.data.operation !== 'cleanup')
      return { reason: 'authority_refused' };
    return { receipt: acknowledged.data.receipt.status };
  }

  private armExpiry(entry: OwnedRun): void {
    if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
    if (!entry.leaseExpiresAtMs) return;
    entry.expiryTimer = setTimeout(
      () => {
        if (this.entries.get(entry.key) !== entry || entry.tabId === null) return;
        this.entries.delete(entry.key);
        void this.closeTab(entry.tabId);
      },
      Math.max(0, entry.leaseExpiresAtMs - Date.now()),
    );
  }

  private async respond(
    frame: LocalBrowserExecute,
    socketEpoch: string,
    outcome: { receipt: string } | { reason: LocalBrowserRefusalReason },
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
        : localBrowserResult({
            type: 'local_browser.result',
            version: 1,
            call_id: frame.call_id,
            operation: frame.operation,
            status: 'acknowledged',
            receipt: outcome.receipt,
          } as never);
    try {
      await this.deps.send(socketEpoch, payload);
    } catch {
      // Socket epochs are one-shot. Lost result delivery is retried only by a
      // later identical server execution, using the existing private receipt.
    }
  }
}

let controller: LocalBrowserController | null = null;

/** Register the private lifecycle owner once during service-worker bootstrap. */
export function startLocalBrowserController(): void {
  controller ??= new LocalBrowserController();
  controller.start();
}
