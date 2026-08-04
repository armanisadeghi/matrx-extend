/**
 * Regression tests for the dispatcher durability layer
 * (docs/AUDIT_2026_06_10.md P0-4 / P0-5).
 *
 * Run metadata and pending confirmations persist to chrome.storage.session
 * so an MV3 service-worker restart can't orphan in-flight tool calls. The
 * suite's chrome stub aliases storage.session to the same map as
 * storage.local — fine for round-trip semantics.
 */

import {
  type PersistedPendingConfirm,
  listPendingConfirms,
  loadRunMeta,
  persistPendingConfirm,
  persistRunMeta,
  removePendingConfirm,
  takePendingConfirm,
} from '@/lib/tools/dispatch-persist';
import { describe, expect, it } from 'vitest';

function confirm(callId: string, overrides: Partial<PersistedPendingConfirm> = {}) {
  return {
    callId,
    toolName: 'navigate',
    args: { url: 'https://example.com' },
    conversationId: 'conv-1',
    runId: 'run-1',
    agentName: 'Test Agent',
    permissionMode: 'ask' as const,
    assignedTabId: 42,
    effectiveTier: 'action' as const,
    initiator: 'agent' as const,
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

describe('dispatch-persist: run metadata', () => {
  it('round-trips run meta (incl. the trust set as an array)', async () => {
    await persistRunMeta('run-rt', {
      conversationId: 'conv-9',
      requestId: 'req-9',
      permissionMode: 'act',
      agentName: 'A',
      trustedHosts: ['example.com', 'foo.dev'],
      assignedTabId: 7,
      updatedAt: Date.now(),
    });
    const loaded = await loadRunMeta('run-rt');
    expect(loaded?.conversationId).toBe('conv-9');
    expect(loaded?.permissionMode).toBe('act');
    expect(loaded?.trustedHosts).toEqual(['example.com', 'foo.dev']);
    expect(loaded?.assignedTabId).toBe(7);
  });

  it('returns null for unknown runs', async () => {
    expect(await loadRunMeta('run-never-existed')).toBeNull();
  });

  it('prunes runs past the TTL', async () => {
    await persistRunMeta('run-ancient', {
      conversationId: null,
      requestId: null,
      permissionMode: 'ask',
      agentName: null,
      trustedHosts: [],
      assignedTabId: null,
      updatedAt: Date.now() - 7 * 60 * 60 * 1000, // > 6h TTL
    });
    // Any subsequent persist triggers the prune pass.
    await persistRunMeta('run-fresh', {
      conversationId: null,
      requestId: null,
      permissionMode: 'ask',
      agentName: null,
      trustedHosts: [],
      assignedTabId: null,
      updatedAt: Date.now(),
    });
    expect(await loadRunMeta('run-ancient')).toBeNull();
    expect(await loadRunMeta('run-fresh')).not.toBeNull();
  });
});

describe('dispatch-persist: pending confirms', () => {
  it('persists, lists, and removes', async () => {
    await persistPendingConfirm(confirm('call-a'));
    await persistPendingConfirm(confirm('call-b'));
    const all = await listPendingConfirms();
    const ids = all.map((c) => c.callId);
    expect(ids).toContain('call-a');
    expect(ids).toContain('call-b');
    await removePendingConfirm('call-a');
    const after = (await listPendingConfirms()).map((c) => c.callId);
    expect(after).not.toContain('call-a');
    expect(after).toContain('call-b');
    await removePendingConfirm('call-b');
  });

  it('takePendingConfirm claims atomically — second take gets nothing', async () => {
    await persistPendingConfirm(confirm('call-claim'));
    const first = await takePendingConfirm('call-claim');
    expect(first?.toolName).toBe('navigate');
    expect(first?.args).toEqual({ url: 'https://example.com' });
    const second = await takePendingConfirm('call-claim');
    expect(second).toBeNull();
  });

  it('preserves everything needed to reconstruct the call context', async () => {
    await persistPendingConfirm(
      confirm('call-ctx', {
        effectiveTier: 'privileged',
        initiator: 'page',
        permissionMode: 'act',
      }),
    );
    const rec = await takePendingConfirm('call-ctx');
    expect(rec?.effectiveTier).toBe('privileged');
    expect(rec?.initiator).toBe('page');
    expect(rec?.permissionMode).toBe('act');
    expect(rec?.conversationId).toBe('conv-1');
    expect(rec?.runId).toBe('run-1');
    expect(rec?.assignedTabId).toBe(42);
  });
});
