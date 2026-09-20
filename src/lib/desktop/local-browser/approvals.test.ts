import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type LocalBrowserApprovalProposal,
  localBrowserApprovalWaiterCount,
  requestLocalBrowserApproval,
  setLocalBrowserApprovalPermissionReaderForTest,
} from './approvals';

// native.on also registers a runtime listener; the behavior under test is its
// same-context fan-out, so the runtime half can be inert.
const runtimeListeners = new Set<unknown>();
(globalThis.chrome as unknown as { runtime: unknown }).runtime = {
  onMessage: {
    addListener: (listener: unknown) => runtimeListeners.add(listener),
    removeListener: (listener: unknown) => runtimeListeners.delete(listener),
  },
  sendMessage: async () => undefined,
};

const proposal = (suffix: string): LocalBrowserApprovalProposal => ({
  binding: {
    actorId: `actor-${suffix}`,
    organizationId: `org-${suffix}`,
    deviceId: `device-${suffix}`,
    runId: `run-${suffix}`,
    profileId: `profile-${suffix}`,
    extensionGeneration: `generation-${suffix}`,
    connectionId: `connection-${suffix}`,
    controllerRevision: 1,
    admissionId: `admission-${suffix}`,
    commandSequence: 1,
    commandId: `command-${suffix}`,
    commandDigest: `digest-${suffix}`,
  },
  command: { operation: 'inspect_login' },
  ownedTabId: 7,
  deadlineMs: Date.now() + 10_000,
  isBindingCurrent: () => true,
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  setLocalBrowserApprovalPermissionReaderForTest(null);
  // Each test explicitly settles its waiter; this assertion catches a secret-bearing waiter leak.
  expect(localBrowserApprovalWaiterCount()).toBe(0);
});

describe('local browser private approvals', () => {
  it('does not let a mismatched opaque context answer another waiter', async () => {
    let contextId = '';
    const off = on<{ approvalContextId: string }, { ack: true }>(
      CHANNELS.LOCAL_BROWSER_APPROVAL_REQUEST,
      (request) => {
        contextId = request.approvalContextId;
        return { ack: true };
      },
    );
    const pending = requestLocalBrowserApproval(proposal('one'));
    await flush();
    expect(localBrowserApprovalWaiterCount()).toBe(1);
    broadcast(CHANNELS.LOCAL_BROWSER_APPROVAL_RESPONSE, {
      approvalContextId: 'wrong-context',
      decision: 'allow',
    });
    expect(localBrowserApprovalWaiterCount()).toBe(1);
    expect(contextId).not.toBe('');
    broadcast(CHANNELS.LOCAL_BROWSER_APPROVAL_CANCEL, { approvalContextId: contextId });
    await expect(pending).resolves.toMatchObject({ decision: 'cancel' });
    off();
  });

  it('refuses if binding changes while the final permission read is pending', async () => {
    let release!: (value: 'act') => void;
    setLocalBrowserApprovalPermissionReaderForTest(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    let current = true;
    const pending = requestLocalBrowserApproval({
      ...proposal('race'),
      isBindingCurrent: () => current,
    });
    await flush();
    current = false;
    release('act');
    await expect(pending).resolves.toMatchObject({ decision: 'refused' });
  });

  it('broadcasts canonical origin only and ignores malicious proposal metadata', async () => {
    let request: unknown;
    const off = on(CHANNELS.LOCAL_BROWSER_APPROVAL_REQUEST, (value) => {
      request = value;
      return { ack: true };
    });
    const pending = requestLocalBrowserApproval({
      ...proposal('privacy'),
      command: {
        operation: 'navigate',
        url: 'https://user:pass@example.com/private?token=secret#fragment',
      },
      origin: 'https://bad/path',
      fieldSummary: 'hunter2',
    } as unknown as LocalBrowserApprovalProposal);
    await flush();
    expect(request).toMatchObject({ origin: 'https://example.com' });
    expect(JSON.stringify(request)).not.toMatch(/user|pass|private|token|secret|hunter2/);
    broadcast(CHANNELS.LOCAL_BROWSER_APPROVAL_CANCEL, {
      approvalContextId: (request as { approvalContextId: string }).approvalContextId,
    });
    await pending;
    off();
  });

  it('keeps simultaneous waiters separate and allows only the echoed context', async () => {
    const contexts: string[] = [];
    const off = on<{ approvalContextId: string }, { ack: true }>(
      CHANNELS.LOCAL_BROWSER_APPROVAL_REQUEST,
      (request) => {
        contexts.push(request.approvalContextId);
        return { ack: true };
      },
    );
    const first = requestLocalBrowserApproval(proposal('first'));
    const second = requestLocalBrowserApproval(proposal('second'));
    await flush();
    expect(contexts).toHaveLength(2);
    broadcast(CHANNELS.LOCAL_BROWSER_APPROVAL_RESPONSE, {
      approvalContextId: contexts[1],
      decision: 'allow',
    });
    await expect(second).resolves.toMatchObject({
      decision: 'allow',
      policy: { toolName: 'credential_login' },
    });
    expect(localBrowserApprovalWaiterCount()).toBe(1);
    broadcast(CHANNELS.LOCAL_BROWSER_APPROVAL_VIEW_CLOSED, { approvalContextId: contexts[0] });
    await expect(first).resolves.toMatchObject({ decision: 'cancel', reason: 'view_closed' });
    off();
  });
});
