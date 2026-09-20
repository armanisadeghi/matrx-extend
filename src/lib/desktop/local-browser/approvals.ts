import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { readDefaultPermissionMode } from '@/lib/settings/persisted';
import {
  type LocalCommand,
  type PolicyResolution,
  resolveLocalCommandPolicy,
} from './command-policy';

export type LocalBrowserApprovalBinding = Readonly<{
  actorId: string;
  organizationId: string;
  deviceId: string;
  runId: string;
  profileId: string;
  extensionGeneration: string;
  connectionId: string;
  controllerRevision: number;
  admissionId: string;
  commandSequence: number;
  commandId: string;
  commandDigest: string;
}>;

export type LocalBrowserApprovalProposal = Readonly<{
  binding: LocalBrowserApprovalBinding;
  command: LocalCommand;
  ownedTabId: number;
  deadlineMs: number;
  /** Synchronous controller fence over the exact actor/device/run/tab binding. */
  isBindingCurrent: (binding: LocalBrowserApprovalBinding) => boolean;
}>;

export type LocalBrowserApprovalDecision = 'allow' | 'deny' | 'cancel';
export type LocalBrowserApprovalResult =
  | { decision: 'allow'; policy: PolicyResolution }
  | { decision: 'deny' | 'cancel' | 'refused'; reason: string };

export type LocalBrowserApprovalRequest = Readonly<{
  approvalContextId: string;
  operation: LocalCommand['operation'];
  origin?: string;
  fields?: Readonly<{ names: string[]; count: number }>;
  tier: PolicyResolution['tier'];
  deadlineMs: number;
}>;

type Waiter = {
  proposal: LocalBrowserApprovalProposal;
  policy: PolicyResolution;
  generation: number;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (result: LocalBrowserApprovalResult) => void;
};

const waiters = new Map<string, Waiter>();
let permissionGeneration = 0;
let installed = false;
let permissionReader = readDefaultPermissionMode;
const generationSubscribers = new Set<(generation: number) => void>();

/** The controller captures this before transport verification. */
export function localBrowserApprovalGeneration(): number {
  install();
  return permissionGeneration;
}

/** Invalidates command work without creating a second settings authority. */
export function onLocalBrowserApprovalGenerationChange(
  subscriber: (generation: number) => void,
): () => void {
  install();
  generationSubscribers.add(subscriber);
  return () => generationSubscribers.delete(subscriber);
}

export function setLocalBrowserApprovalPermissionReaderForTest(
  reader: (() => Promise<'ask' | 'act'>) | null,
): void {
  permissionReader = reader ?? readDefaultPermissionMode;
}

function finish(contextId: string, result: LocalBrowserApprovalResult): void {
  const waiter = waiters.get(contextId);
  if (!waiter) return;
  clearTimeout(waiter.timeout);
  waiters.delete(contextId);
  broadcast(CHANNELS.LOCAL_BROWSER_APPROVAL_CANCEL, { approvalContextId: contextId });
  waiter.resolve(result);
}

function install(): void {
  if (installed) return;
  installed = true;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !('matrx.settings.v1' in changes)) return;
    permissionGeneration += 1;
    for (const subscriber of generationSubscribers) subscriber(permissionGeneration);
    for (const contextId of [...waiters.keys()])
      finish(contextId, { decision: 'cancel', reason: 'permission_changed' });
  });
  on<{ approvalContextId: string; decision: 'allow' | 'deny' }, { ack: true }>(
    CHANNELS.LOCAL_BROWSER_APPROVAL_RESPONSE,
    (response) => {
      const waiter = waiters.get(response.approvalContextId);
      if (!waiter) return { ack: true };
      if (response.decision === 'deny')
        finish(response.approvalContextId, { decision: 'deny', reason: 'denied' });
      else void authorize(response.approvalContextId, waiter, true);
      return { ack: true };
    },
  );
  on<{ approvalContextId: string }, { ack: true }>(
    CHANNELS.LOCAL_BROWSER_APPROVAL_CANCEL,
    (payload) => {
      finish(payload.approvalContextId, { decision: 'cancel', reason: 'cancelled' });
      return { ack: true };
    },
  );
  on<{ approvalContextId: string }, { ack: true }>(
    CHANNELS.LOCAL_BROWSER_APPROVAL_VIEW_CLOSED,
    (payload) => {
      finish(payload.approvalContextId, { decision: 'cancel', reason: 'view_closed' });
      return { ack: true };
    },
  );
}

async function authorize(contextId: string, waiter: Waiter, userConfirmed: boolean): Promise<void> {
  // Re-resolve real handler args and real tier before allowing; no model-supplied tier.
  const current = resolveLocalCommandPolicy(waiter.proposal.command, waiter.proposal.ownedTabId);
  if (!current || !waiter.proposal.isBindingCurrent(waiter.proposal.binding)) {
    finish(contextId, { decision: 'refused', reason: 'binding_or_schema_changed' });
    return;
  }
  const mode = await permissionReader();
  // No await between this fence and transition: settings must not auto-allow stale act mode.
  if (waiter.generation !== permissionGeneration) {
    finish(contextId, { decision: 'cancel', reason: 'permission_changed' });
    return;
  }
  if (!waiter.proposal.isBindingCurrent(waiter.proposal.binding)) {
    finish(contextId, { decision: 'refused', reason: 'binding_or_schema_changed' });
    return;
  }
  if (Date.now() >= waiter.proposal.deadlineMs) {
    finish(contextId, { decision: 'cancel', reason: 'expired' });
    return;
  }
  const needsHuman =
    current.tier === 'privileged' ||
    current.tier === 'ask-user' ||
    (current.tier === 'action' && mode === 'ask');
  if (needsHuman && !userConfirmed) {
    broadcast(CHANNELS.LOCAL_BROWSER_APPROVAL_REQUEST, toRequest(contextId, waiter, current));
    return;
  }
  finish(contextId, { decision: 'allow', policy: current });
}

function toRequest(
  contextId: string,
  waiter: Waiter,
  policy: PolicyResolution,
): LocalBrowserApprovalRequest {
  const rawOrigin =
    waiter.proposal.command.operation === 'navigate' ? waiter.proposal.command.url : undefined;
  let origin: string | undefined;
  try {
    origin = rawOrigin ? new URL(rawOrigin).origin : undefined;
  } catch {
    origin = undefined;
  }
  const rawFields = (waiter.proposal.command as { fields?: unknown }).fields;
  const names = Array.isArray(rawFields)
    ? rawFields
        .map((field) =>
          typeof field === 'object' &&
          field !== null &&
          typeof (field as { field_key?: unknown }).field_key === 'string'
            ? (field as { field_key: string }).field_key
            : null,
        )
        .filter((field): field is string => field !== null)
        .slice(0, 12)
    : [];
  return {
    approvalContextId: contextId,
    operation: waiter.proposal.command.operation,
    ...(origin && { origin }),
    ...(names.length && { fields: { names: [...new Set(names)], count: names.length } }),
    tier: policy.tier,
    deadlineMs: waiter.proposal.deadlineMs,
  };
}

/**
 * Private SW seam for the owned-controller command collaborator. No data is
 * persisted; callers must use the returned decision only while their binding
 * remains current and repeat their own binding fence before claim/injection.
 */
export function requestLocalBrowserApproval(
  proposal: LocalBrowserApprovalProposal,
): Promise<LocalBrowserApprovalResult> {
  install();
  const policy = resolveLocalCommandPolicy(proposal.command, proposal.ownedTabId);
  if (!policy)
    return Promise.resolve({ decision: 'refused', reason: 'unknown_or_invalid_command' });
  if (Date.now() >= proposal.deadlineMs)
    return Promise.resolve({ decision: 'cancel', reason: 'expired' });
  const approvalContextId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timeout = setTimeout(
      () => finish(approvalContextId, { decision: 'cancel', reason: 'expired' }),
      Math.max(0, proposal.deadlineMs - Date.now()),
    );
    const waiter: Waiter = { proposal, policy, generation: permissionGeneration, timeout, resolve };
    waiters.set(approvalContextId, waiter);
    void authorize(approvalContextId, waiter, false);
  });
}

/** Test-only visibility; it exposes no command or binding material. */
export function localBrowserApprovalWaiterCount(): number {
  return waiters.size;
}
