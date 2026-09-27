import { beforeEach, expect, it, vi } from 'vitest';
import { executePreparedOperation } from '@/lib/tools/prepared-tool-operation';
import type { PersistedPendingConfirm } from '@/lib/tools/dispatch-persist';
let persisted: Record<string, unknown>;
beforeEach(() => {
  persisted = {};
  Object.assign(chrome.storage, { session: {
    get: vi.fn(async () => structuredClone(persisted)),
    set: vi.fn(async value => { Object.assign(persisted, structuredClone(value)); }),
  } });
});
const record = (): PersistedPendingConfirm => ({ callId: 'network-call', toolName: 'data_patterns', args: { action: 'run', pattern_id: 'saved-id' }, conversationId: 'conversation', runId: 'run', agentName: 'agent', permissionMode: 'act', assignedTabId: 37, effectiveTier: 'privileged', initiator: 'agent', expiresAt: Date.now() + 1000, preparedOperation: { snapshotKey: 'recipe-document-options', delivery: 'agent' } });
it('persisted actual operation survives module restart and duplicate responses claim it once', async () => {
  const store = await import('@/lib/tools/dispatch-persist'); await store.persistPendingConfirm(record());
  vi.resetModules();
  const restarted = await import('@/lib/tools/dispatch-persist');
  const claims = await Promise.all([restarted.takePendingConfirm('network-call'), restarted.takePendingConfirm('network-call')]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const rec = claims.find(Boolean)!;
  expect(rec.toolName).toBe('data_patterns'); expect(rec.args).toEqual(record().args);
  const run = vi.fn(async () => [{ venue: 'Brooklyn Bowl' }]);
  const check = vi.fn(async () => {}); const confirm = vi.fn(async () => true);
  const identity = { toolName: rec.toolName, callId: rec.callId, runId: rec.runId, assignedTabId: rec.assignedTabId!, snapshotKey: rec.preparedOperation!.snapshotKey };
  const rows = await executePreparedOperation({ permissionMode: rec.permissionMode, signal: new AbortController().signal,
    recovered: { identity, tier: rec.effectiveTier, delivery: rec.preparedOperation!.delivery, expiresAt: rec.expiresAt },
    prepare: async () => ({ identity, tier: 'privileged', checkRequirements: check, run }), confirm });
  expect(rows).toEqual([{ venue: 'Brooklyn Bowl' }]); expect(run).toHaveBeenCalledOnce();
  expect(confirm).not.toHaveBeenCalled(); expect(check).toHaveBeenCalledTimes(2);
});
it('claiming one approval concurrently with another write preserves the other operation', async () => {
  const store = await import('@/lib/tools/dispatch-persist'); await store.persistPendingConfirm(record());
  await Promise.all([store.takePendingConfirm('network-call'), store.persistPendingConfirm({ ...record(), callId: 'other-call' })]);
  expect(await store.takePendingConfirm('network-call')).toBeNull();
  expect((await store.takePendingConfirm('other-call'))?.callId).toBe('other-call');
});
